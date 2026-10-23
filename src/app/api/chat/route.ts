import { NextRequest, NextResponse } from 'next/server';
import {
  searchCosmeticsLive,
  lookupByBarcode,
  getServicePurposeExplanation,
  BARCODE_PATTERN,
} from '@/lib/services/search-barcode-service';
import {
  analyzeProduct,
  checkCurrentUse,
  hasVerifiedIngredients,
  isPlaceholderIngredient,
  performDifferentialAnalysis,
} from '@/lib/analyzer/ingredient-analyzer';
import { Product, UserRoutineState } from '@/lib/types';
import {
  answerIngredientQuestion,
  explainCulprits,
  findIngredientsInText,
  summarizeProductAnalysis,
  summarizeProductResults,
} from '@/lib/services/chat-replies';
import { alternativeButtonLabel, classifyChatMessage, GATE_REPLIES } from '@/lib/services/chat-gate';
import {
  alternativeRequest,
  alternativeRequestFromProduct,
  findAlternatives,
  summarizeAlternatives,
} from '@/lib/services/alternatives-service';
import { researchPrices, summarizePriceResult, toPriceSearchQuery } from '@/lib/services/price-service';
import { productSearchQuery } from '@/lib/services/web-research';
import { getClientIp, isRateLimited, RATE_LIMIT_MESSAGE_JA } from '@/lib/server/cloudflare';
import { isValidProduct, isValidRoutine, MAX_MESSAGE_LENGTH } from '@/lib/server/validation';
import { resolveClientProduct, resolveClientRoutine } from '@/lib/server/client-products';
import { COSMETICS_DATABASE, hydrateVerifiedProducts } from '@/lib/data/cosmetics-db';
import { MAX_LABEL_NAME_LENGTH, MAX_LABEL_TEXT_LENGTH, productFromLabel } from '@/lib/services/label-reader';
import { brandLineup, shopProductQuery } from '@/lib/services/shop-lineup';
import { buildBrandIndex, findBrand } from '@/lib/services/brand-suggest';
import { apiRoute, readJsonBody, TOO_LARGE } from '@/lib/server/api-route';
import { isShopListingProduct, isUserLabelProduct } from '@/lib/product-source';

/** 成分表示の入力（本文は必須、商品名・ブランドは任意） */
function isValidLabelInput(label: unknown): boolean {
  if (!label || typeof label !== 'object') return false;
  const { text, name, brand } = label as Record<string, unknown>;
  const optional = (v: unknown) => v === undefined || (typeof v === 'string' && v.length <= MAX_LABEL_NAME_LENGTH);
  return typeof text === 'string' && text.trim().length > 0 && text.length <= MAX_LABEL_TEXT_LENGTH && optional(name) && optional(brand);
}

/** 価格を調べて返す（T4）。query は商品名だけ。商品名が無ければ入力を案内する */
async function priceReply(query: string | null, clientIp: string) {
  // 価格の検索は1回で Web 検索と Gemini を何回も使うので、ほかの操作より少ない回数に制限する
  if (await isRateLimited('price', clientIp)) {
    return NextResponse.json({ reply: RATE_LIMIT_MESSAGE_JA }, { status: 429 });
  }
  if (!query) {
    return NextResponse.json({
      reply: '価格を調べたい商品の名前（ブランド名＋商品名）を入力してください。例：「キュレル 潤浸保湿 化粧水 の価格」',
      quickReplies: ['🔍 商品名で検索する'],
    });
  }
  const priceResult = await researchPrices(query);
  return NextResponse.json({
    reply: summarizePriceResult(priceResult),
    priceResult,
    quickReplies: ['🔍 別のコスメを調べる', '📸 バーコードをスキャンする'],
  });
}

const SINGLE_ANALYSIS_REPLIES = [
  '🚨 このアイテムで肌荒れした（原因をさがす）',
  '✅ 普段問題なく使えている（リストに追加）',
  '💴 この商品の価格を調べる',
];

/** 成分が分からなかった製品の分析のあと。比べるリストに入れても使えないので、成分を調べ直す方法を出す */
const NO_INGREDIENTS_REPLIES = ['🔎 Webで成分を調べ直す', '📸 バーコードをスキャンする', '📝 成分表示を入力する'];

/** 成分が1つも分からない製品（「成分情報は確認できませんでした」だけの製品も） */
const hasNoIngredients = (product: Product): boolean => product.ingredients.every(isPlaceholderIngredient);

/** 1つの製品の分析のあとのボタン。成分が分からなかった製品（入力した成分表示を除く）は調べ直す方法 */
function singleAnalysisReplies(product: Product, more: string): string[] {
  return hasNoIngredients(product) && !isUserLabelProduct(product)
    ? [...NO_INGREDIENTS_REPLIES, more]
    : [...SINGLE_ANALYSIS_REPLIES, more];
}

/**
 * 本文の上限。3つの比較リスト（各 20 件）の製品を送ってもふつうは 100KB に届かない。
 * 何十 MB もの本文でアイソレートのメモリ（128MB）を使い切らせないように、それより大きい本文は読まない
 */
const MAX_CHAT_BODY_BYTES = 512 * 1024;

const INVALID_REQUEST_REPLY = 'リクエストの形式が正しくありません。ページを再読み込みしてもう一度お試しください。';

async function handlePost(request: NextRequest) {
  try {
    // レート制限チェック（Cloudflare Rate Limiting バインディング、無ければインメモリ）
    if (await isRateLimited('ai', getClientIp(request.headers))) {
      return NextResponse.json({ reply: RATE_LIMIT_MESSAGE_JA }, { status: 429 });
    }

    const body = await readJsonBody(request, MAX_CHAT_BODY_BYTES);
    if (body === TOO_LARGE) return NextResponse.json({ reply: INVALID_REQUEST_REPLY }, { status: 413 });
    if (!body || typeof body !== 'object') return NextResponse.json({ reply: INVALID_REQUEST_REPLY }, { status: 400 });
    const {
      message,
      routine: sentRoutine,
      action,
      selectedProduct: sentProduct,
      barcode,
      label,
    } = body as {
      message: string;
      routine: UserRoutineState;
      action?:
        | 'analyze_single'
        | 'differential'
        | 'barcode_lookup'
        | 'search'
        | 'analyze_label'
        | 'price_lookup'
        | 'check_current_use'
        | 'lookup_product'
        | 'research_product'
        | 'find_alternatives';
      selectedProduct?: Product;
      barcode?: string;
      label?: { text?: unknown; name?: unknown; brand?: unknown };
    };

    // 入力の形式・サイズを検証（分析処理と Gemini プロンプトに渡す前に）
    if (
      (message !== undefined && (typeof message !== 'string' || message.length > MAX_MESSAGE_LENGTH)) ||
      (sentRoutine !== undefined && !isValidRoutine(sentRoutine)) ||
      (sentProduct !== undefined && !isValidProduct(sentProduct)) ||
      (barcode !== undefined && typeof barcode !== 'string') ||
      (label !== undefined && !isValidLabelInput(label))
    ) {
      return NextResponse.json({ reply: INVALID_REQUEST_REPLY }, { status: 400 });
    }

    // KV に保存された成分確認済みの製品を読み込み、おすすめ代替品の候補にする
    await hydrateVerifiedProducts();
    // サーバーが持っている製品は、ブラウザから送られた内容ではなくサーバーの内容を使う
    const routine = sentRoutine && (await resolveClientRoutine(sentRoutine));
    const selectedProduct = sentProduct && (await resolveClientProduct(sentProduct));

    const userText = (message || '').trim();
    const cleanNumeric = userText.replace(/[\s\-_]/g, '');
    const cleanBarcode = (barcode || '').replace(/[\s\-_]/g, '');
    const targetBarcode =
      action === 'barcode_lookup' && BARCODE_PATTERN.test(cleanBarcode)
        ? cleanBarcode
        : BARCODE_PATTERN.test(cleanNumeric)
        ? cleanNumeric
        : null;

    // 1. バーコード指定または数字直接入力の場合
    if (targetBarcode) {
      const product = await lookupByBarcode(targetBarcode);
      if (!product) {
        // Open Beauty Facts にも、同じバーコードが書かれた Web ページにも無かった。Gemini に推測させない
        return NextResponse.json({
          reply: `バーコード（${targetBarcode}）の製品は見つかりませんでした。ブランド名と商品名で検索するか、パッケージの成分表示を入力してください。`,
          quickReplies: ['🔍 商品名で検索する', '📝 成分表示を入力する', '📸 別のバーコードをスキャン'],
        });
      }

      // 結果はカードに出るので、返答は定型のまとめ（Gemini は使わない）
      const analysis = analyzeProduct(product);
      return NextResponse.json({
        reply: summarizeProductAnalysis(analysis, targetBarcode),
        singleAnalysis: analysis,
        quickReplies: singleAnalysisReplies(product, '🔍 他のコスメも調べる'),
      });
    }

    // 1b. 入力された成分表示の分析。文章は Gemini・Clef・検索に送らず、パーサーと成分DBだけで分析する
    if (action === 'analyze_label' && label) {
      const built = await productFromLabel({
        text: label.text as string,
        name: label.name as string | undefined,
        brand: label.brand as string | undefined,
      });
      if ('error' in built) {
        return NextResponse.json({
          reply:
            built.error === 'empty'
              ? '成分を読み取れませんでした。パッケージの「全成分」の部分を入力してください。'
              : '成分の区切りが見つかりませんでした。成分の間を「、」で区切って入力してください。',
          quickReplies: ['📝 成分表示を入力する'],
        });
      }
      const analysis = analyzeProduct(built.product);
      return NextResponse.json({
        reply: summarizeProductAnalysis(analysis),
        singleAnalysis: analysis,
        quickReplies: [
          '🚨 このアイテムで肌荒れした（原因をさがす）',
          '✅ 普段問題なく使えている（リストに追加）',
          '📝 別の成分表示を入力する',
        ],
      });
    }

    // 2. 単一製品解析指定の場合
    if (action === 'analyze_single' && selectedProduct) {
      const analysis = analyzeProduct(selectedProduct);
      return NextResponse.json({
        reply: summarizeProductAnalysis(analysis),
        singleAnalysis: analysis,
        quickReplies: singleAnalysisReplies(selectedProduct, '🔍 別のコスメを調べる'),
      });
    }

    // 2-2. 成分が分からなかった製品を、ブランド名と商品名で Web で調べ直す（ボタン操作。有料・予算内）。
    //      前に調べて全成分が無かった結果のキャッシュは使わない。全成分が見つかった製品だけを候補に出す
    if (action === 'research_product' && selectedProduct) {
      // 入力した成分表示は Web では調べない（ボタンも出さない）
      if (isUserLabelProduct(selectedProduct)) {
        return NextResponse.json({
          reply: '入力した成分表示の商品は Web では調べません。',
          quickReplies: ['📝 成分表示を入力する', '🔍 別のコスメを調べる'],
        });
      }
      // 別の人が調べて、サーバーにもう全成分がある製品なら、その分析を返す
      if (!hasNoIngredients(selectedProduct)) {
        const analysis = analyzeProduct(selectedProduct);
        return NextResponse.json({
          reply: summarizeProductAnalysis(analysis),
          singleAnalysis: analysis,
          quickReplies: singleAnalysisReplies(selectedProduct, '🔍 別のコスメを調べる'),
        });
      }
      const query = productSearchQuery(selectedProduct);
      const found = query
        ? (await searchCosmeticsLive(query, 6, { webResearch: true, retryEmpty: true })).filter(
            (p) => hasVerifiedIngredients(p) || (isShopListingProduct(p) && p.ingredients.length > 0)
          )
        : [];
      if (found.length === 0) {
        return NextResponse.json({
          reply: 'Web でも、この商品の全成分表示は見つかりませんでした。パッケージのバーコードを読み取るか、成分表示を入力してください。',
          quickReplies: ['📸 バーコードをスキャンする', '📝 成分表示を入力する', '🔍 別のコスメを調べる'],
        });
      }
      return NextResponse.json({
        reply: summarizeProductResults(found),
        productSuggestions: found,
        quickReplies: ['🚨 この中のアイテムで肌荒れした', '✅ この中のアイテムは問題なく使えた', '🔍 別のキーワードで調べる'],
      });
    }

    // 2a. お店の商品検索の製品（入力途中の候補）の成分を調べる（ボタン操作）。JAN コードがあれば、まずバーコードで。
    //     見つからなければ商品名で：検索語はブランド名と、飾りを外した商品名だけ。保存済みの製品に無ければ
    //     Web リサーチ（有料・予算内）
    if (action === 'lookup_product' && selectedProduct && selectedProduct.id.startsWith('shop_')) {
      // バーコードは、数字を入力したときと同じ照合（個人の文章ではない）。お店に確かめる前に調べてよい
      // （送られた製品の barcode 欄は検証していないので、文字列のときだけ使う）
      const sentBarcode: unknown = selectedProduct.barcode;
      const shopBarcode = typeof sentBarcode === 'string' ? sentBarcode.replace(/[\s\-_]/g, '') : '';
      const triedBarcode = BARCODE_PATTERN.test(shopBarcode);
      const fromBarcode = triedBarcode ? await lookupByBarcode(shopBarcode) : null;
      // 全成分の無い結果（Open Beauty Facts に JAN だけある）は使わず、商品名で調べる
      const byBarcode = fromBarcode && !hasNoIngredients(fromBarcode) ? fromBarcode : null;
      if (byBarcode) {
        const analysis = analyzeProduct(byBarcode);
        return NextResponse.json({
          reply: summarizeProductAnalysis(analysis, shopBarcode),
          singleAnalysis: analysis,
          quickReplies: singleAnalysisReplies(byBarcode, '🔍 他のコスメも調べる'),
        });
      }
      // ブラウザから届いた名前は使わない。一覧のブランドの製品として、お店がいま返す製品だけを認め、
      // その名前（サーバーが取り直したもの）で調べる。お店の API は無料（呼び出しは全体で数える）
      const brand = findBrand(selectedProduct.brand, buildBrandIndex(COSMETICS_DATABASE));
      const lineup = brand ? await brandLineup(brand) : null;
      const listed = lineup?.products.find((p) => p.id === selectedProduct.id);
      if (!listed) {
        return NextResponse.json({
          reply: lineup?.incomplete
            ? 'お店の商品情報を確認できませんでした。少し時間をおいて、もう一度お試しください。'
            : 'この商品の情報を確認できませんでした。もう一度候補から選ぶか、商品名で検索してください。',
          quickReplies: ['🔍 別のコスメを調べる', '📸 バーコードをスキャンする'],
        });
      }
      const query = shopProductQuery(listed);
      const found = query ? await searchCosmeticsLive(query, 6, { webResearch: true }) : [];
      if (found.length === 0) {
        // バーコードで調べた後なら、バーコードの読み取りは勧めない
        return NextResponse.json({
          reply: triedBarcode
            ? 'この商品の成分表示は、バーコードでも商品名でも見つかりませんでした。パッケージの成分表示を入力してください。'
            : 'この商品の成分表示は見つかりませんでした。パッケージのバーコードを読み取るか、成分表示を入力してください。',
          quickReplies: triedBarcode
            ? ['📝 成分表示を入力する', '🔍 別のコスメを調べる']
            : ['📸 バーコードをスキャンする', '📝 成分表示を入力する', '🔍 別のコスメを調べる'],
        });
      }
      return NextResponse.json({
        reply: summarizeProductResults(found),
        productSuggestions: found,
        quickReplies: ['🚨 この中のアイテムで肌荒れした', '✅ この中のアイテムは問題なく使えた', '🔍 別のキーワードで調べる'],
      });
    }

    // 2a-2. 分析した商品の「同じ種類で原因成分を含まない商品を探す」（ボタン操作）。サーバーで分析をやり直し、
    //       種類と避ける成分を決める。お店に送るのは種類の名前と決まった語だけ（商品名・成分表示は送らない）
    if (action === 'find_alternatives' && selectedProduct) {
      // サーバーが持っていない製品（送られた内容のまま。入力した成分表示など）は、有料の調べものをしない
      const req = { ...alternativeRequestFromProduct(selectedProduct), allowPaidLookups: selectedProduct !== sentProduct };
      const { products, credits } = await findAlternatives(req);
      return NextResponse.json({
        reply: summarizeAlternatives(req, products),
        ...(products.length > 0 && { productSuggestions: products, suggestionKind: 'alternatives', alternativeCredits: credits }),
        quickReplies: ['🔍 別のコスメを調べる', '📸 バーコードをスキャンする'],
      });
    }

    // 2b. 分析した商品の価格（ボタン操作）。検索語はブランド名と商品名だけ
    // サーバーが持っている製品（調べて確かめた商品）だけ。送られた名前で費用のかかる検索をしない
    if (action === 'price_lookup' && sentProduct) {
      let priced = selectedProduct;
      // 別のアイソレートで見つけたばかりの製品は、このメモリにまだ無い。KV を早めに読み直して探す
      if (priced === sentProduct && !isUserLabelProduct(sentProduct)) {
        await hydrateVerifiedProducts({ recheck: true });
        priced = await resolveClientProduct(sentProduct);
      }
      if (!priced || priced === sentProduct) {
        return NextResponse.json({
          reply: 'この商品は価格を調べられません。「（ブランド名）（商品名） の価格」と送ってください。',
          quickReplies: ['🔍 別のコスメを調べる'],
        });
      }
      return priceReply(productSearchQuery(priced), getClientIp(request.headers));
    }

    // 2c. 今使っているコスメの組み合わせチェック（ボタン操作。ルールだけで判定し、Gemini は呼ばない）
    if (action === 'check_current_use') {
      const products = routine?.currentlyUsing ?? [];
      if (new Set(products.map((p) => p.id)).size < 2) {
        return NextResponse.json({
          reply: '組み合わせを調べるには、「今使っているコスメ」を2点以上追加してください。',
          quickReplies: ['🔍 商品名で検索する', '📸 バーコードをスキャン'],
        });
      }
      const check = checkCurrentUse(products);
      return NextResponse.json({
        reply:
          check.findings.length > 0
            ? `今使っている${check.productNames.length}点のコスメに、一緒に使うときに注意したい組み合わせが${check.findings.length}件ありました。`
            : `今使っている${check.productNames.length}点のコスメに、このアプリが調べている組み合わせ（レチノール類とサリチル酸など、角質に働く成分の重なり、香料の重なり）は見つかりませんでした。`,
        currentUseCheck: check,
      });
    }

    // 3. 自由入力メッセージの判定（チャットゲート）。雑談・指示の書き換え・本人の医療相談は、
    //    商品検索・Gemini を呼ばずに定型文で返す。ボタン操作（文章を含まない）は判定しない
    //    差分分析ボタンは文章を使わない。それ以外は action に関係なく、文章があれば必ず判定する
    const gate = action === 'differential' || !userText ? null : await classifyChatMessage(userText);
    if (gate && gate.scope !== 'in_scope') {
      return NextResponse.json(GATE_REPLIES[gate.scope]);
    }
    // 文章のないボタン操作で、上の分岐で処理できなかったもの（読み取れないバーコード等）
    if (!gate && action !== 'differential') {
      return NextResponse.json({
        reply: 'バーコードまたは商品を読み取れませんでした。商品名を入力するか、もう一度スキャンしてください。',
        quickReplies: ['📸 別のバーコードをスキャン', '🔍 商品名で検索する'],
      });
    }

    // 4. 差分分析（あぶり出し）実行の場合
    // 比較するコスメがまだ無ければ、肌荒れしたコスメの追加を案内する（Gemini は相談に答えない）
    const hasBadProducts = !!routine && routine.badProducts.length > 0;
    if (action === 'differential' || gate?.intent === 'find_cause') {
      if (!routine || !hasBadProducts) {
        return NextResponse.json({
          reply:
            '原因になりうる成分の候補を絞り込むには、まず「肌荒れしたコスメ」を1点以上追加してください。さらに「普段問題なく使えているコスメ」もあると、共通の成分を除外して、原因になりうる成分の候補を絞り込めます。',
          quickReplies: ['🔍 肌荒れしたコスメを検索', '📸 バーコードをスキャン'],
        });
      }

      const diffResult = performDifferentialAnalysis(routine.badProducts, routine.safeProducts || []);
      // 候補成分が刺激になりやすい理由だけを Gemini に説明させる（商品名・ユーザーの文章は渡さない）
      return NextResponse.json({
        reply: await explainCulprits(diffResult),
        differentialAnalysis: diffResult,
        quickReplies: ['💡 原因候補を含まないアイテムは？', '🔍 別のコスメを追加する', '🔄 リセットする'],
      });
    }

    // 5. 一般テキスト入力（分岐先はチャットゲートの意図判定）
    // A. 挨拶・使い方の質問：定型の説明のみ（商品検索や Gemini は呼ばない）
    if (gate?.intent === 'greeting_or_help') {
      return NextResponse.json({
        reply: getServicePurposeExplanation(),
        quickReplies: [
          '🧴 肌荒れしたコスメを入力する',
          '✅ 普段使えているコスメを入力する',
          '📸 バーコードをスキャンする',
          '🔍 キュレルの泡洗顔を調べる',
        ],
      });
    }

    // B. 成分に関する質問：一般的な成分知識の短い解説（関連商品の検索と並行して作る）
    if (gate?.intent === 'ingredient_question') {
      const [matchedProducts, reply] = await Promise.all([
        searchCosmeticsLive(userText, 6),
        answerIngredientQuestion(userText),
      ]);
      // 成分DBの成分なら、その成分を含まない商品を探すボタンを出す
      const [mentioned] = findIngredientsInText(userText);
      return NextResponse.json({
        reply,
        productSuggestions: matchedProducts,
        quickReplies: [...(mentioned ? [alternativeButtonLabel(mentioned)] : []), '📸 バーコードをスキャンする'],
      });
    }

    // C. 代わりの商品探し（T3）。避ける成分は成分DBの名前か比較の候補成分だけで、検索語に文章を使わない
    if (gate?.intent === 'find_alternative') {
      const req = alternativeRequest(userText, routine);
      if (!req) {
        return NextResponse.json({
          reply:
            '避けたい成分（例：香料、エタノール）か、商品の種類（例：化粧水）を入力してください。肌荒れしたコスメを登録して原因候補の成分を絞り込むと、その成分を含まない商品を探せます。',
          quickReplies: ['🧴 肌荒れしたコスメを入力する', '🔍 商品名で検索する'],
        });
      }
      const { products, credits } = await findAlternatives(req);
      return NextResponse.json({
        reply: summarizeAlternatives(req, products),
        ...(products.length > 0 && { productSuggestions: products, suggestionKind: 'alternatives', alternativeCredits: credits }),
        quickReplies: ['🔍 別のコスメを調べる', '📸 バーコードをスキャンする'],
      });
    }

    // D. 価格（T4）。検索語は文章から取り出した商品名だけ。商品ページから読んだ価格だけ15分間使い回す
    if (gate?.intent === 'price_inquiry') {
      return priceReply(toPriceSearchQuery(userText), getClientIp(request.headers));
    }

    // E. 全入力に対する動的コスメ探索（肌トラブル・カテゴリ・成分・ブランド・製品名など）
    // Web リサーチ（有料）は商品を調べる依頼のときだけ。検索語は商品名だけを取り出して使い、チャット文は送らない
    const webResearch = gate?.intent === 'product_lookup';
    const matchedProducts = await searchCosmeticsLive(userText, 6, { webResearch });

    // F. 商品名の入力など。該当する商品が無い場合は Gemini に自由に答えさせず、定型文で返す
    if (matchedProducts.length === 0) {
      return NextResponse.json({
        reply:
          '該当する化粧品が見つかりませんでした。ブランド名と商品名を入力するか、パッケージのバーコードを読み取るか、成分表示を入力してください。',
        quickReplies: ['🔍 具体的な商品名で再検索', '📸 バーコードをスキャンする', '📝 成分表示を入力する'],
      });
    }
    const quickReplies = [
      '🚨 この中のアイテムで肌荒れした',
      '✅ この中のアイテムは問題なく使えた',
      '📸 バーコードで読み取る',
      '🔍 別のキーワードで調べる',
    ];

    return NextResponse.json({
      reply: summarizeProductResults(matchedProducts),
      productSuggestions: matchedProducts,
      quickReplies,
    });
  } catch (err) {
    console.error('Chat error:', err);
    return NextResponse.json(
      {
        reply: '申し訳ありません、応答の生成中にエラーが発生しました。もう一度お試しください。',
      },
      { status: 500 }
    );
  }
}

/** ほかのサイトからの呼び出しを断り、有料の呼び出しにルート名と利用者を付ける（src/lib/server/api-route.ts） */
export const POST = apiRoute('chat', handlePost);
