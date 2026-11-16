import { Product } from '../types';
import { COSMETICS_DATABASE } from '../data/cosmetics-db';
import { researchProducts, sharedResearchFor, toProductSearchQuery } from './web-research';
import { shopIngredientProducts } from './shop-ingredients';
import { withoutListingNoise } from '../search/listing-name';
import { isShopListingProduct } from '../product-source';
import { runAfterResponse } from '../server/cloudflare';
import { filterSearchResults } from './search-filter';
import { onePerBarcode, queryNamesBrand, rankProducts, searchKey } from '../search/product-match';
import { isGreetingOrConsultation, isNonCosmeticSearchQuery } from './query-check';
import { hasVerifiedIngredientList, isActualCosmeticProduct } from './product-filter';
import { searchOpenBeautyFacts } from './open-beauty-facts';
import { namesProduct, namesSearchedProduct } from './searched-name';

/**
 * 3. 代表コスメ・トレンドコスメを生成AIおよび外部APIから動的取得
 * 固定の配列を持たず、リアルタイムに実在する市販コスメを探索・動的キャッシュ
 */
export async function fetchDynamicTrendingCosmetics(
  categoryOrConcern = '低刺激 スキンケア',
  limit = 6
): Promise<Product[]> {
  const clean = categoryOrConcern.trim();
  const collected: Product[] = [];

  // 1. 動的ランタイムキャッシュ（過去に取得された実在コスメ）から優先抽出
  const cached = COSMETICS_DATABASE.filter(isActualCosmeticProduct);
  for (const c of cached) {
    if (collected.length >= limit) break;
    if (!collected.some((p) => p.id === c.id || p.name === c.name)) {
      collected.push(c);
    }
  }

  if (collected.length >= limit) {
    return collected.slice(0, limit);
  }

  // 2. Open Beauty Facts API から動的探索（有料の Web 検索・Gemini は使わない）
  // 外へ送るのは商品名として読める語だけ（今の呼び出し元は決まった語を渡す）
  const obfResults = await searchOpenBeautyFacts(toProductSearchQuery(clean) ?? 'スキンケア', limit);
  for (const o of obfResults) {
    if (collected.length >= limit) break;
    if (isActualCosmeticProduct(o) && !collected.some((p) => p.id === o.id || p.name === o.name)) {
      collected.push(o);
    }
  }

  // 件数が足りなくても架空の候補は合成しない
  return collected.filter(isActualCosmeticProduct).slice(0, limit);
}

/**
 * 4. 実在するコスメ候補のみを検索・特定して返却するメインエンジン
 * 固定カタログを持たず、動的キャッシュ・Open Beauty Facts・Web リサーチから実在商品のみを返却
 *
 * openBeautyFacts: false なら Open Beauty Facts に問い合わせない（ブランド名を入力している途中など）
 * webResearch: 見つからない場合に Web 検索と出典ページの読み取り（有料）まで行うか。
 * 入力途中の候補表示（/api/products/search）では使わず、チャットで商品名が送られたときだけ使う
 */
type LiveSearchOptions = { webResearch?: boolean; openBeautyFacts?: boolean; retryEmpty?: boolean };

export async function searchCosmeticsLive(
  query: string,
  limit = 6,
  // retryEmpty: Web リサーチで、前に全成分が見つからなかった結果のキャッシュを使わない（利用者が調べ直しを頼んだとき）
  options: LiveSearchOptions = {}
): Promise<Product[]> {
  return (await searchCosmeticsLiveWithCloseMatches(query, limit, options)).products;
}

/** 近い候補の件数の上限 */
const MAX_CLOSE_MATCHES = 4;

/**
 * searchCosmeticsLive と同じ検索。チャットで商品名を調べて合う製品が無かったときは、closeMatches に近い候補を返す：
 * 検索語にあるブランドの、全成分を確認した製品（答えではなく「近い製品」として見せる。docs/plans/search-flexibility.md）
 */
export async function searchCosmeticsLiveWithCloseMatches(
  query: string,
  limit = 6,
  options: LiveSearchOptions = {}
): Promise<{ products: Product[]; closeMatches: Product[] }> {
  const clean = query ? query.replace(/\u3000/g, ' ').trim() : '';

  const collected: Product[] = [];
  // Web リサーチで見つけた製品（合う製品が無かったときのログ用）
  let researched: Product[] = [];

  // 1. 空入力または挨拶・相談の場合：外部APIから動的に実在人気コスメを取得
  if (!clean || isGreetingOrConsultation(clean)) {
    await addTrending(collected, limit);
    if (collected.length >= limit) return { products: collected.slice(0, limit), closeMatches: [] };
  }

  // 2. 通常の検索語の場合
  // A. 動的ランタイムキャッシュ（過去に取得した実在データ。KV の成分確認済み製品を含む）から、よく合う順に探索。
  //    ひらがな・カタカナ・半角カナの揺れと、空白で区切った複数の語に対応（src/lib/search/product-match.ts）
  addCachedMatches(collected, clean);

  // B. Open Beauty Facts API（世界規模の実在コスメデータベース。無料）。1文字の入力では問い合わせない。
  //    送るのは商品名として読める語だけ（連絡先・本人の事情・文章は送らない。プライバシーポリシー第5条）
  await addOpenBeautyFacts(collected, clean, limit, options);

  // C. Web リサーチ（Web 検索 → 出典ページの読み取り）。
  //    検索語を製品名に含む、全成分付きの候補が既にあれば行わない（同じブランドの別製品だけでは行う）
  const productQuery = options.webResearch ? toProductSearchQuery(clean) : null;
  if (
    productQuery &&
    !collected.some((p) => hasVerifiedIngredientList(p) && namesProduct(p, productQuery)) &&
    !isNonCosmeticSearchQuery(clean)
  ) {
    researched = await addResearched(collected, productQuery, limit, options);
  }

  // 件数が足りなくても架空の候補は合成しない（0件ならUI側で再検索・バーコードを案内）

  // D. 厳格フィルター（実在コスメのみを確実に保証）
  const { validProducts, closeMatches } = pickAnswers(collected, clean, limit, options, researched);

  // E. Clef による検索語との照合（SEARCH_FILTER_MODE。既定は off）。空の検索・挨拶は照合しない
  const products = await filterSearchResults(clean && !isGreetingOrConsultation(clean) ? clean : '', validProducts);
  return { products, closeMatches };
}

/** 1. 人気の実在コスメを足す（空入力・挨拶・相談のとき） */
async function addTrending(collected: Product[], limit: number): Promise<void> {
  const trending = await fetchDynamicTrendingCosmetics('敏感肌 低刺激 スキンケア', limit);
  for (const t of trending) {
    if (collected.length >= limit) break;
    collected.push(t);
  }
}

/** A. メモリの製品から、検索語によく合う順に足す */
function addCachedMatches(collected: Product[], clean: string): void {
  const cachedMatches = rankProducts(COSMETICS_DATABASE.filter(isActualCosmeticProduct), clean, hasVerifiedIngredientList);

  for (const m of cachedMatches) {
    if (!collected.some((c) => c.id === m.id || c.name === m.name)) {
      collected.push(m);
    }
  }
}

/** B. Open Beauty Facts で見つけた製品を足す */
async function addOpenBeautyFacts(collected: Product[], clean: string, limit: number, options: LiveSearchOptions): Promise<void> {
  const obfQuery = toProductSearchQuery(clean);
  if (obfQuery && collected.length < limit && searchKey(obfQuery).length >= 2 && options.openBeautyFacts !== false) {
    const obfResults = await searchOpenBeautyFacts(obfQuery, limit);
    for (const o of obfResults) {
      if (isActualCosmeticProduct(o) && !collected.some((c) => c.id === o.id || c.name === o.name)) {
        collected.push(o);
      }
    }
  }
}

/** C. お店の API か Web リサーチで調べた製品を先頭に足す。Web リサーチで見つけた製品を返す（お店で見つかったときは空） */
async function addResearched(
  collected: Product[],
  productQuery: string,
  limit: number,
  options: LiveSearchOptions
): Promise<Product[]> {
  // まずお店の API（Yahoo! の JAN コードで保存済みの製品、楽天の商品説明の全成分。費用はほぼ無し）。
  // 見つかれば、すぐに返す。楽天の説明から読んだ成分は保存できないので、全員で共有する結果は、返答の後に
  // 信頼するサイトを調べて作る（保存済みの確かめた製品が見つかったときは調べない）
  // ただし、前に調べた確かめた結果がキャッシュにあれば、それを使う（費用なし。お店の説明文より確か）
  // 探している製品（名前に検索語を含み、全成分つき）がそこにあるときだけ。別の製品だけなら、お店も調べる
  const cachedAnswer = (await sharedResearchFor(productQuery)).some(
    (p) => hasVerifiedIngredientList(p) && namesProduct(p, productQuery)
  );
  const fromShops = cachedAnswer
    ? []
    : await shopIngredientProducts(productQuery).catch((err) => {
        console.error('Shop ingredient lookup failed:', err instanceof Error ? err.message : err);
        return [] as Product[];
      });
  if (fromShops.length > 0) {
    collected.unshift(...fromShops.filter((s) => !collected.some((c) => c.id === s.id)));
    if (!fromShops.some(hasVerifiedIngredientList)) {
      await runAfterResponse(researchProducts(productQuery, Math.min(limit, 4), { retryEmpty: options.retryEmpty }));
    }
    return [];
  }
  const webResults = await researchProducts(productQuery, Math.min(limit, 4), { retryEmpty: options.retryEmpty });
  // 調べた製品を先に置く（Web リサーチは、検索語を名前に含む確認済みの候補が無いときだけ行うので、
  // ここまでの候補より合っている。後ろに置くと、同じブランドの候補で件数が埋まり切り捨てられる）
  putResearchedFirst(collected, webResults);
  return webResults;
}

/** Web リサーチの結果を先頭に置く。同じ製品で成分の無い候補は、全成分つきの結果で置き換える */
function putResearchedFirst(collected: Product[], webResults: Product[]): void {
  const found: Product[] = [];
  for (const w of webResults.filter(isActualCosmeticProduct)) {
    const i = collected.findIndex((c) => c.id === w.id || c.name === w.name);
    if (i >= 0) {
      // 同じ製品で成分が無い候補（前に調べて全成分が無かった等）は、全成分が見つかった結果で置き換える
      if (hasVerifiedIngredientList(collected[i]) || !hasVerifiedIngredientList(w)) continue;
      collected.splice(i, 1);
    }
    found.push(w);
  }
  collected.unshift(...found);
}

/** D. 実在コスメだけにして、答えと近い候補を分ける（チャットで商品名を調べたときは、検索語そのものに合う製品だけが答え） */
function pickAnswers(
  collected: Product[],
  clean: string,
  limit: number,
  options: LiveSearchOptions,
  researched: Product[]
): { validProducts: Product[]; closeMatches: Product[] } {
  // お店の商品名は変えずに表示するので、【公式】・送料無料などの飾りを外した名前で、コスメかどうかを確かめる
  const isCosmetic = (p: Product) =>
    isActualCosmeticProduct(isShopListingProduct(p) ? { ...p, name: withoutListingNoise(p.name) } : p);
  // 別のサイトで調べた同じ JAN の製品は1つにする（全成分を確認したものを残す）
  const valid = onePerBarcode(collected, hasVerifiedIngredientList).filter(isCosmetic);
  // 商品名を調べたとき（チャット）は、検索語そのものに合う製品だけを答えにする。同じブランドの別の製品
  // （ブランド名だけの一致・Web で読んだ別の製品）は出さない（「…リキッド」を調べてルージュを出さない。2026-11-03 のログ）
  const strict = options.webResearch && clean && !isGreetingOrConsultation(clean);
  const validProducts = (strict ? valid.filter((p) => namesSearchedProduct(p, clean)) : valid).slice(0, limit);

  // 合う製品が無いとき：検索語にあるブランドの、全成分を確認した製品を近い候補にする（答えとしては出さない）
  const closeMatches =
    strict && validProducts.length === 0
      ? valid.filter((p) => hasVerifiedIngredientList(p) && queryNamesBrand(p, clean)).slice(0, MAX_CLOSE_MATCHES)
      : [];
  if (strict && validProducts.length === 0) logSearchMiss(researched, valid, closeMatches.length);
  return { validProducts, closeMatches };
}

/**
 * チャットで商品名を調べて、合う製品が1つも無かったときのログ（[search-miss]）。足りない書き方・略し方を見つけるため
 * （src/lib/data/brands-jp.ts・name-aliases.ts に足す）。調べた製品のブランド名・製品名と、どこで外れたかだけ。
 * 利用者の検索語は出さない
 */
function logSearchMiss(researched: Product[], valid: Product[], closeMatches: number): void {
  if (researched.length === 0) return;
  const label = (p: Product) => `${p.brand} / ${p.name}`.replace(/[\u0000-\u001f]/g, ' ').slice(0, 80);
  const notCosmetic = researched.filter((p) => !valid.some((v) => v.id === p.id));
  const notNamed = researched.filter((p) => valid.some((v) => v.id === p.id));
  console.log(
    `[search-miss] ${JSON.stringify({
      researched: researched.length,
      notCosmetic: notCosmetic.slice(0, 3).map(label),
      notNamed: notNamed.slice(0, 3).map(label),
      closeMatches,
    })}`
  );
}
