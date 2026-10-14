import { NextRequest, NextResponse } from 'next/server';
import {
  searchCosmeticsLive,
  lookupByBarcode,
  getServicePurposeExplanation,
  BARCODE_PATTERN,
} from '@/lib/services/search-barcode-service';
import { analyzeProduct, checkCurrentUse, performDifferentialAnalysis } from '@/lib/analyzer/ingredient-analyzer';
import { Product, UserRoutineState } from '@/lib/types';
import {
  answerIngredientQuestion,
  explainCulprits,
  findIngredientsInText,
  summarizeProductAnalysis,
  summarizeProductResults,
} from '@/lib/services/chat-replies';
import { alternativeButtonLabel, classifyChatMessage, GATE_REPLIES } from '@/lib/services/chat-gate';
import { alternativeRequest, findAlternatives, summarizeAlternatives } from '@/lib/services/alternatives-service';
import { researchPrices, summarizePriceResult, toPriceSearchQuery } from '@/lib/services/price-service';
import { productSearchQuery } from '@/lib/services/web-research';
import { getClientIp, isRateLimited, RATE_LIMIT_MESSAGE_JA } from '@/lib/server/cloudflare';
import { isValidProduct, isValidRoutine, MAX_MESSAGE_LENGTH } from '@/lib/server/validation';
import { resolveClientProduct, resolveClientRoutine } from '@/lib/server/client-products';
import { hydrateVerifiedProducts } from '@/lib/data/cosmetics-db';
import { MAX_LABEL_NAME_LENGTH, MAX_LABEL_TEXT_LENGTH, productFromLabel } from '@/lib/services/label-reader';
import { withUsageRoute } from '@/lib/server/usage';

/** 成分表示の入力（本文は必須、商品名・ブランドは任意） */
function isValidLabelInput(label: unknown): boolean {
  if (!label || typeof label !== 'object') return false;
  const { text, name, brand } = label as Record<string, unknown>;
  const optional = (v: unknown) => v === undefined || (typeof v === 'string' && v.length <= MAX_LABEL_NAME_LENGTH);
  return typeof text === 'string' && text.trim().length > 0 && text.length <= MAX_LABEL_TEXT_LENGTH && optional(name) && optional(brand);
}

/** 価格を調べて返す（T4）。query は商品名だけ。商品名が無ければ入力を案内する */
async function priceReply(query: string | null) {
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
  '🚨 このアイテムで肌荒れした（原因を特定）',
  '✅ 普段安全に使えている（安全リストに追加）',
  '💴 この商品の価格を調べる',
];

const INVALID_REQUEST_REPLY = 'リクエストの形式が正しくありません。ページを再読み込みしてもう一度お試しください。';

async function handlePost(request: NextRequest) {
  try {
    // レート制限チェック（Cloudflare Rate Limiting バインディング、無ければインメモリ）
    if (await isRateLimited('ai', getClientIp(request.headers))) {
      return NextResponse.json({ reply: RATE_LIMIT_MESSAGE_JA }, { status: 429 });
    }

    const body = await request.json();
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
        | 'check_current_use';
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
        quickReplies: [...SINGLE_ANALYSIS_REPLIES, '🔍 他のコスメも調べる'],
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
          '🚨 このアイテムで肌荒れした（原因を特定）',
          '✅ 普段安全に使えている（安全リストに追加）',
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
        quickReplies: [...SINGLE_ANALYSIS_REPLIES, '🔍 別のコスメを調べる'],
      });
    }

    // 2b. 分析した商品の価格（ボタン操作）。検索語はブランド名と商品名だけ
    if (action === 'price_lookup' && selectedProduct) {
      return priceReply(productSearchQuery(selectedProduct));
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
            '肌荒れ原因をあぶり出すには、まず「肌荒れしたコスメ」を1点以上追加してください。さらに「普段問題なく使えている安全なコスメ」もあると、共通の安全成分を除外して犯人成分を高精度に特定できます！',
          quickReplies: ['🔍 肌荒れしたコスメを検索', '📸 バーコードをスキャン'],
        });
      }

      const diffResult = performDifferentialAnalysis(routine.badProducts, routine.safeProducts || []);
      // 候補成分が刺激になりやすい理由だけを Gemini に説明させる（商品名・ユーザーの文章は渡さない）
      return NextResponse.json({
        reply: await explainCulprits(diffResult),
        differentialAnalysis: diffResult,
        quickReplies: ['💡 おすすめの低刺激アイテムは？', '🔍 別のコスメを追加する', '🔄 リセットする'],
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
            '避けたい成分（例：香料、エタノール）か、商品の種類（例：化粧水）を入力してください。肌荒れしたコスメを登録して原因成分をあぶり出すと、その成分を含まない商品を探せます。',
          quickReplies: ['🧴 肌荒れしたコスメを入力する', '🔍 商品名で検索する'],
        });
      }
      const { products } = await findAlternatives(req);
      return NextResponse.json({
        reply: summarizeAlternatives(req, products),
        ...(products.length > 0 && { productSuggestions: products, suggestionKind: 'alternatives' }),
        quickReplies: ['🔍 別のコスメを調べる', '📸 バーコードをスキャンする'],
      });
    }

    // D. 価格（T4）。検索語は文章から取り出した商品名だけ。価格はキャッシュしない
    if (gate?.intent === 'price_inquiry') {
      return priceReply(toPriceSearchQuery(userText));
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
      '✅ この中のアイテムは安全に使えた',
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

/** 有料の呼び出しの利用量を、このルートの分として記録する（src/lib/server/usage.ts） */
export const POST = withUsageRoute('chat', handlePost);
