import { NextResponse } from 'next/server';
import { searchCosmeticsLive, lookupByBarcode, BARCODE_PATTERN } from '@/lib/services/search-barcode-service';
import {
  analyzeProduct,
  checkCurrentUse,
  hasVerifiedIngredients,
  isPlaceholderIngredient,
  performDifferentialAnalysis,
} from '@/lib/analyzer/ingredient-analyzer';
import { Product } from '@/lib/types';
import { explainCulprits, summarizeProductAnalysis, summarizeProductResults } from '@/lib/services/chat-replies';
import { alternativeRequestFromProduct, findAlternatives, summarizeAlternatives } from '@/lib/services/alternatives-service';
import { productSearchQuery } from '@/lib/services/web-research';
import { getClientIp } from '@/lib/server/cloudflare';
import { resolveClientProduct } from '@/lib/server/client-products';
import { COSMETICS_DATABASE, hydrateVerifiedProducts } from '@/lib/data/cosmetics-db';
import { productFromLabel } from '@/lib/services/label-reader';
import { brandLineup, shopProductQuery } from '@/lib/services/shop-lineup';
import { buildBrandIndex, findBrand } from '@/lib/services/brand-suggest';
import { currentSpendLimit } from '@/lib/server/usage';
import { spendLimitMessage } from '@/lib/spend-limit';
import { isSellerTextProduct, isUserLabelProduct } from '@/lib/product-source';
import { ChatContext, IntentContext, priceReply, RESEARCH_BUCKETS } from './shared';

const SINGLE_ANALYSIS_REPLIES = [
  '🚨 このアイテムで肌荒れした（原因をさがす）',
  '✅ 使えている（リストに追加）',
  '💴 この商品の価格を調べる',
];

/** 成分が分からなかった製品の分析のあと。比べるリストに入れても使えないので、成分を調べ直す方法を出す */
const NO_INGREDIENTS_REPLIES = ['🔎 Webで成分を調べ直す', '📸 バーコードをスキャンする', '📝 成分表示を入力する'];

/** 成分が1つも分からない製品（「成分情報は確認できませんでした」だけの製品も） */
const hasNoIngredients = (product: Product): boolean => product.ingredients.every(isPlaceholderIngredient);

/** 調べ直し・お店の製品の検索で、候補に出してよい製品（全成分を確認した製品か、お店の説明から成分を読んだ製品） */
const hasUsableIngredients = (product: Product): boolean =>
  hasVerifiedIngredients(product) || (isSellerTextProduct(product) && product.ingredients.length > 0);

/** 1つの製品の分析のあとのボタン。成分が分からなかった製品（入力した成分表示を除く）は調べ直す方法 */
function singleAnalysisReplies(product: Product, more: string): string[] {
  return hasNoIngredients(product) && !isUserLabelProduct(product)
    ? [...NO_INGREDIENTS_REPLIES, more]
    : [...SINGLE_ANALYSIS_REPLIES, more];
}

/** 1. バーコード指定または数字直接入力の場合 */
export async function barcodeReply({ action, barcode, userText, registered }: ChatContext) {
  const cleanNumeric = userText.replace(/[\s\-_]/g, '');
  const cleanBarcode = (barcode || '').replace(/[\s\-_]/g, '');
  const targetBarcode =
    action === 'barcode_lookup' && BARCODE_PATTERN.test(cleanBarcode)
      ? cleanBarcode
      : BARCODE_PATTERN.test(cleanNumeric)
      ? cleanNumeric
      : null;
  if (!targetBarcode) return null;

  const product = await lookupByBarcode(targetBarcode);
  if (!product) {
    // Open Beauty Facts にも、同じバーコードが書かれた Web ページにも無かった。Gemini に推測させない
    return NextResponse.json({
      reply: `バーコード（${targetBarcode}）の製品は見つかりませんでした。ブランド名と商品名で検索するか、パッケージの成分表示を入力してください。`,
      quickReplies: ['🔍 商品名で検索する', '📝 成分表示を入力する', '📸 別のバーコードをスキャン'],
    });
  }

  // 結果はカードに出るので、返答は定型のまとめ（Gemini は使わない）
  const analysis = analyzeProduct(product, undefined, registered);
  return NextResponse.json({
    reply: summarizeProductAnalysis(analysis, targetBarcode),
    singleAnalysis: analysis,
    quickReplies: singleAnalysisReplies(product, '🔍 他のコスメも調べる'),
  });
}

/** 1b. 入力された成分表示の分析。文章は Gemini・Clef・検索に送らず、パーサーと成分DBだけで分析する */
export async function labelReply({ action, label, registered }: ChatContext) {
  if (!(action === 'analyze_label' && label)) return null;
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
          : built.error === 'too_many'
            ? '成分の数が多すぎて、成分表示として読み取れませんでした。パッケージの「全成分」の部分だけを入力してください。'
            : '成分の区切りが見つかりませんでした。成分の間を「、」で区切って入力してください。',
      quickReplies: ['📝 成分表示を入力する'],
    });
  }
  const analysis = analyzeProduct(built.product, undefined, registered);
  return NextResponse.json({
    reply: summarizeProductAnalysis(analysis),
    singleAnalysis: analysis,
    quickReplies: [
      '🚨 このアイテムで肌荒れした（原因をさがす）',
      '✅ 使えている（リストに追加）',
      '📝 別の成分表示を入力する',
    ],
  });
}

/** 2. 単一製品解析指定の場合 */
export async function singleProductReply({ action, selectedProduct, registered }: ChatContext) {
  if (!(action === 'analyze_single' && selectedProduct)) return null;
  const analysis = analyzeProduct(selectedProduct, undefined, registered);
  return NextResponse.json({
    reply: summarizeProductAnalysis(analysis),
    singleAnalysis: analysis,
    quickReplies: singleAnalysisReplies(selectedProduct, '🔍 別のコスメを調べる'),
  });
}

/**
 * 2-2. 成分が分からなかった製品を、ブランド名と商品名で Web で調べ直す（ボタン操作。有料・予算内）。
 *      前に調べて全成分が無かった結果のキャッシュは使わない。全成分が見つかった製品だけを候補に出す
 */
export async function researchProductReply({ action, selectedProduct, registered }: ChatContext) {
  if (!(action === 'research_product' && selectedProduct)) return null;
  // 入力した成分表示は Web では調べない（ボタンも出さない）
  if (isUserLabelProduct(selectedProduct)) {
    return NextResponse.json({
      reply: '入力した成分表示の商品は Web では調べません。',
      quickReplies: ['📝 成分表示を入力する', '🔍 別のコスメを調べる'],
    });
  }
  // 別の人が調べて、サーバーにもう全成分がある製品なら、その分析を返す
  if (!hasNoIngredients(selectedProduct)) {
    const analysis = analyzeProduct(selectedProduct, undefined, registered);
    return NextResponse.json({
      reply: summarizeProductAnalysis(analysis),
      singleAnalysis: analysis,
      quickReplies: singleAnalysisReplies(selectedProduct, '🔍 別のコスメを調べる'),
    });
  }
  const query = productSearchQuery(selectedProduct);
  const found = query
    ? (await searchCosmeticsLive(query, 6, { webResearch: true, retryEmpty: true })).filter(hasUsableIngredients)
    : [];
  if (found.length === 0) {
    // 上限で Web を調べられなかったときは「見つからなかった」と言わない
    const limit = currentSpendLimit(RESEARCH_BUCKETS);
    return NextResponse.json({
      reply: limit
        ? spendLimitMessage(limit)
        : 'Web でも、この商品の全成分表示は見つかりませんでした。パッケージのバーコードを読み取るか、成分表示を入力してください。',
      quickReplies: ['📸 バーコードをスキャンする', '📝 成分表示を入力する', '🔍 別のコスメを調べる'],
    });
  }
  return NextResponse.json({
    reply: summarizeProductResults(found),
    productSuggestions: found,
    quickReplies: ['🚨 この中のアイテムで肌荒れした', '✅ この中のアイテムは問題なく使えた', '🔍 別のキーワードで調べる'],
  });
}

/**
 * 2a. お店の商品検索の製品（入力途中の候補）の成分を調べる（ボタン操作）。JAN コードがあれば、まずバーコードで。
 *     見つからなければ商品名で：検索語はブランド名と、飾りを外した商品名だけ。保存済みの製品に無ければ
 *     Web リサーチ（有料・予算内）
 */
export async function lookupProductReply({ action, selectedProduct, registered }: ChatContext) {
  if (!(action === 'lookup_product' && selectedProduct && selectedProduct.id.startsWith('shop_'))) return null;
  // バーコードは、数字を入力したときと同じ照合（個人の文章ではない）。お店に確かめる前に調べてよい
  // （送られた製品の barcode 欄は検証していないので、文字列のときだけ使う）
  const sentBarcode: unknown = selectedProduct.barcode;
  const shopBarcode = typeof sentBarcode === 'string' ? sentBarcode.replace(/[\s\-_]/g, '') : '';
  const triedBarcode = BARCODE_PATTERN.test(shopBarcode);
  const fromBarcode = triedBarcode ? await lookupByBarcode(shopBarcode) : null;
  // 全成分の無い結果（Open Beauty Facts に JAN だけある）は使わず、商品名で調べる
  const byBarcode = fromBarcode && !hasNoIngredients(fromBarcode) ? fromBarcode : null;
  if (byBarcode) {
    const analysis = analyzeProduct(byBarcode, undefined, registered);
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
  // 成分の分からない製品は候補に出さない（選んでも「成分データ不足」になるだけ）
  const found = query ? (await searchCosmeticsLive(query, 6, { webResearch: true })).filter(hasUsableIngredients) : [];
  if (found.length === 0) {
    const limit = currentSpendLimit(RESEARCH_BUCKETS);
    // バーコードで調べた後なら、バーコードの読み取りは勧めない
    return NextResponse.json({
      reply: limit
        ? spendLimitMessage(limit)
        : triedBarcode
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

/**
 * 2a-2. 分析した商品の「同じ種類で原因成分を含まない商品を探す」（ボタン操作）。サーバーで分析をやり直し、
 *       種類と避ける成分を決める。お店に送るのは種類の名前と決まった語だけ（商品名・成分表示は送らない）
 */
export async function findAlternativesReply({ action, selectedProduct, sentProduct }: ChatContext) {
  if (!(action === 'find_alternatives' && selectedProduct)) return null;
  // サーバーが持っていない製品（送られた内容のまま。入力した成分表示など）は、有料の調べものをしない
  const req = { ...alternativeRequestFromProduct(selectedProduct), allowPaidLookups: selectedProduct !== sentProduct };
  const { products, credits } = await findAlternatives(req);
  return NextResponse.json({
    reply: summarizeAlternatives(req, products),
    ...(products.length > 0 && { productSuggestions: products, suggestionKind: 'alternatives', alternativeCredits: credits }),
    quickReplies: ['🔍 別のコスメを調べる', '📸 バーコードをスキャンする'],
  });
}

/**
 * 2b. 分析した商品の価格（ボタン操作）。検索語はブランド名と商品名だけ
 * サーバーが持っている製品（調べて確かめた商品）だけ。送られた名前で費用のかかる検索をしない
 */
export async function priceLookupReply({ action, selectedProduct, sentProduct, request }: ChatContext) {
  if (!(action === 'price_lookup' && sentProduct)) return null;
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

/** 2c. 使えるコスメのうち、今も使っている製品の組み合わせチェック（ボタン操作。ルールだけで判定し、Gemini は呼ばない） */
export async function checkCurrentUseReply({ action, routine }: ChatContext) {
  if (action !== 'check_current_use') return null;
  const products = routine?.currentlyUsing ?? [];
  if (new Set(products.map((p) => p.id)).size < 2) {
    return NextResponse.json({
      reply: '組み合わせを調べるには、今も使っている「使えるコスメ」を2点以上にしてください。',
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

/**
 * 4. 差分分析（あぶり出し）実行の場合（ボタン、または原因をさがす文章）。チャットゲートの判定の後に試す
 * 比較するコスメがまだ無ければ、肌荒れしたコスメの追加を案内する（Gemini は相談に答えない）
 */
export async function differentialReply({ action, gate, routine }: IntentContext) {
  const hasBadProducts = !!routine && routine.badProducts.length > 0;
  if (!(action === 'differential' || gate?.intent === 'find_cause')) return null;
  if (!routine || !hasBadProducts) {
    return NextResponse.json({
      reply:
        '原因になりうる成分の候補を絞り込むには、まず「肌荒れしたコスメ」を1点以上追加してください。さらに「使えるコスメ」もあると、共通の成分を除外して、原因になりうる成分の候補を絞り込めます。',
      quickReplies: ['🔍 肌荒れしたコスメを検索', '📸 バーコードをスキャン'],
    });
  }

  const diffResult = performDifferentialAnalysis(routine.badProducts, routine.safeProducts || [], routine.currentlyUsing ?? []);
  // 候補成分が刺激になりやすい理由だけを Gemini に説明させる（商品名・ユーザーの文章は渡さない）
  return NextResponse.json({
    reply: await explainCulprits(diffResult),
    differentialAnalysis: diffResult,
    quickReplies: ['💡 原因候補を含まないアイテムは？', '🔍 別のコスメを追加する', '🔄 リセットする'],
  });
}
