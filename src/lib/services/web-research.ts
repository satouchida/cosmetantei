import 'server-only';
import { Product } from '../types';
import { productIdentityKey } from '../search/product-identity';
import { addProductToDynamicCache, isVerifiedSource, rememberVerifiedProducts } from '../data/cosmetics-db';
import { cacheGetJSON, cachePutJSON, hashedCacheKey } from '../server/cache';
import { runAfterResponse } from '../server/cloudflare';
import { runWebSearch, WebSearchItem, WebSearchProvider } from '../server/web-search';
import { buildAmazonAffiliateUrl } from './amazon-affiliate';
import { labelProductFields } from '../analyzer/label-parser';
import { isGeminiConfigured } from './gemini-client';
import { isAcceptedBrand, judgeBrands } from './brand-check';
import { translateEnglishLabels } from './ingredient-translate';
import { mayRememberFailure } from '../server/usage';
import { logSourceTrust, mayShareWebProduct } from '../data/trusted-sites';
import { isSiteReadable } from './site-readers';
import { normalizeUrl, pickPagesToRead, productSearchQuery, SEARCH_PROVIDERS, SEARCH_RESULT_LIMIT, webSearch } from './page-search';
import { PageProduct, readProductPages } from './page-reader';

/**
 * Web リサーチ（docs/plans/gemini-role-redesign.md の Phase 2）
 * 1. Cloudflare Web Search で検索する（Exa → 失敗・0件なら Linkup）
 * 2. 上位のページを Gemini の URL context で読み、ページに書かれた製品名・全成分だけを取り出す
 * 3. 出典 URL が「検索結果に含まれ、かつ読み込みに成功したページ」かをコードで確かめる
 *
 * 守ること:
 * - 検索語はアプリが商品名・バーコードから組み立てる。利用者のチャット文はそのまま送らない（Exa は検索語を保持する）
 * - 検索結果（Exa・Linkup の出力）はキャッシュしない。キャッシュするのはページから読み取った製品情報のみ
 * - Google 検索グラウンディングは使わない
 */

const BARCODE_SEARCH_PROVIDERS: WebSearchProvider[] = ['linkup', 'exa'];

/** ページから読み取った製品情報のキャッシュ（ページ由来の事実のみ。検索結果そのものは保存しない） */
const FACTS_TTL_SECONDS = 60 * 60 * 24 * 7;
const FACTS_MISS_TTL_SECONDS = 60 * 60;
/**
 * 一時的な失敗（検索・Gemini のエラー、予算の上限、止められた応答）のあと、同じ検索をしない期間。
 * 「見つからない」とは保存しないが、失敗する検索に何度も費用をかけないように
 */
export const RESEARCH_FAIL_TTL_SECONDS = 10 * 60;

const UNCONFIRMED_INGREDIENTS = '成分情報は確認できませんでした';
/** 製品に持たせる出典 URL の長さの上限（validation.ts の MAX_URL_LENGTH と同じ） */
const MAX_SOURCE_URL_LENGTH = 2048;

/** 探し直しで読むページ数の上限（止められたときの Gemini の呼び出し回数を抑える） */
const MAX_RETRY_PAGES = 2;

/**
 * Web で検索し、上位のページを読む。全ページが RECITATION で止められたら、まだ使っていない検索サービス
 * （Exa で見つけたなら Linkup）で探し直し、まだ読んでいないページを読む（別のお店のページなら止められないことがある）。
 * - 戻り値の [] は確定した「該当なし」（ページを読んで該当製品が無い、または読めるページが全て止められた）
 * - 検索・読み取りの一時的な失敗は null（呼び出し側は「見つからない」として保存しない）
 */
async function searchAndReadProducts(
  query: string,
  target: string,
  options: { matchTarget?: boolean } = {}
): Promise<PageProduct[] | null> {
  const search = await webSearch(query);
  if (!search) return null;
  const urls = pickPagesToRead(search.items);
  const read = await readProductPages(urls, target, options);
  if (!read) return null;
  if (!read.allBlocked) return conclusive(read);

  // webSearch は前から順に試すので、見つけたサービスより後ろのものだけがまだ使われていない
  const untried = SEARCH_PROVIDERS.slice(SEARCH_PROVIDERS.indexOf(search.provider) + 1);
  if (untried.length === 0) return [];
  const retry = await webSearch(query, undefined, undefined, untried);
  if (!retry) return null;
  const tried = new Set(urls.map(normalizeUrl));
  const fresh = pickPagesToRead(
    retry.items.filter((i) => !tried.has(normalizeUrl(i.url))),
    MAX_RETRY_PAGES
  );
  if (fresh.length === 0) return [];
  const reread = await readProductPages(fresh, target, options);
  return reread ? conclusive(reread) : null;
}

/** 一部のページを読めずに製品が無いときは、確定した「該当なし」ではない */
function conclusive(read: { products: PageProduct[]; incomplete: boolean }): PageProduct[] | null {
  return read.incomplete && read.products.length === 0 ? null : read.products;
}

// ---------- 製品への変換 ----------

/** 出典 URL と製品名から決まる ID（同じページの同じ製品は同じ ID にする） */
async function pageProductId(p: PageProduct): Promise<string> {
  const key = await hashedCacheKey('web', `${p.sourceUrl}|${p.brand}|${p.name}`);
  return `web_${key.slice(4, 20)}`;
}

/**
 * ページの製品情報を Product にする。全成分がページに無ければ「成分未確認」（分析では判定不能になる）
 */
export async function toProduct(p: PageProduct): Promise<Product> {
  const hasIngredients = p.ingredients.length > 0;
  return {
    id: await pageProductId(p),
    name: p.name,
    brand: p.brand,
    country: 'JP',
    category: p.category,
    barcode: p.barcode,
    ...labelProductFields({
      ingredients: hasIngredients ? p.ingredients : [UNCONFIRMED_INGREDIENTS],
      activeIngredients: p.activeIngredients,
      isQuasiDrug: p.isQuasiDrug,
      undisclosedCount: p.undisclosedCount,
    }),
    descriptionJa: `${p.brand} - ${p.name}`,
    amazonSearchUrl: buildAmazonAffiliateUrl(p.brand, p.name),
    isEstimatedFromMarketplaces: false,
    ingredientSource: hasIngredients ? 'web_page' : undefined,
    // 長すぎる URL は持たない（製品を送り返したときの検証で、比較リスト全体が拒否されないように）
    sourceUrl: p.sourceUrl.length <= MAX_SOURCE_URL_LENGTH ? p.sourceUrl : undefined,
  };
}

/** 一般名詞がブランド欄に入った製品を除く（語彙チェック → キャッシュ → Clef。Gemini の追加呼び出しなし） */
async function keepRealBrands(products: Product[]): Promise<Product[]> {
  if (products.length === 0) return [];
  const decisions = await judgeBrands(products.map((p) => ({ brand: p.brand, productName: p.name })));
  return products.filter((_, i) => isAcceptedBrand(decisions[i]));
}

/** 同じ製品が複数ページにある場合は、全成分が取れたもの（同順なら検索順の上位）を1件だけ残す */
function uniqueProducts(products: Product[]): Product[] {
  const unique: Product[] = [];
  const seen = new Set<string>();
  // 全成分のある方を先に。同じなら共有してよいページ（信頼するサイト）の方を残す
  const rank = (p: Product) => Number(!!p.ingredientSource) * 2 + Number(mayShareWebProduct(p));
  for (const p of [...products].sort((a, b) => rank(b) - rank(a))) {
    const key = productIdentityKey(p.brand, p.name);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  return unique;
}

/**
 * キャッシュから返す製品のうち、前回訳せなかった英語の全成分表示を訳し直す。
 * 訳せたら KV も書き直す（次に読んだときにまた訳さない）
 */
async function translateCachedLabels(cacheKey: string, cached: Product[], limit: number): Promise<Product[]> {
  const head = cached.slice(0, limit);
  const translated = await translateEnglishLabels(head);
  if (translated.some((p, i) => p !== head[i])) {
    await cachePutJSON(cacheKey, [...translated, ...cached.slice(limit)], FACTS_TTL_SECONDS);
  }
  return translated;
}

/** 全成分が取れた製品があるか（取れなかった製品は出典が無く、「成分情報は確認できませんでした」だけを持つ） */
const hasAnyIngredients = (products: Product[]): boolean => products.some(isVerifiedSource);

/** 同じ検索語の調べ直し（retryEmpty）でキャッシュを使わないのは、この時間に1回まで（全員で数える） */
const RETRY_COOLDOWN_SECONDS = 10 * 60;

/** 一時的な失敗の印（この利用者が自分の1日の上限に達して失敗したときは付けない） */
async function rememberResearchFailure(cacheKey: string): Promise<void> {
  if (mayRememberFailure()) await cachePutJSON(`${cacheKey}:fail`, true, RESEARCH_FAIL_TTL_SECONDS);
}

/**
 * 信頼しないサイトの製品に印を付ける（調べた本人にだけ返し、画面に「ほかのサイトの情報」と出す）。
 * force: 出典の URL に関係なく印を付ける（製品を特定したページが信頼しないサイトだったとき）
 */
function markUnshared(products: Product[], force = false): Product[] {
  return products.map((p) => (!force && mayShareWebProduct(p) ? p : { ...p, sharedSource: false }));
}

/**
 * 信頼しないサイトの製品しか見つからなかった印の長さ。その間は同じ検索語・バーコードを調べ直さない
 * （保存できない結果のために、聞かれるたびに有料の調べものをしない）。その間に聞いた人には「見つからない」と返る
 */
export const UNTRUSTED_ONLY_TTL_SECONDS = 10 * 60;

/**
 * キャッシュの結果のうち、共有してよい製品。TRUSTED_SITES_MODE=enforce の前に保存した、信頼しないサイトだけの
 * 結果は null（使わずに調べ直す）
 */
function sharedCached(cached: Product[]): Product[] | null {
  const shared = cached.filter(mayShareWebProduct);
  return shared.length > 0 || cached.length === 0 ? shared : null;
}

/**
 * 結果をメモリのキャッシュに登録する。新しく調べた結果なら、成分確認済みのものを KV の確認済み一覧にも追加する
 * （KV キャッシュから返すときは登録済みなので書かない。同じキーへの頻繁な書き込みを避ける）
 */
async function registerProducts(products: Product[], { fresh }: { fresh: boolean }): Promise<Product[]> {
  const registered = products.map(addProductToDynamicCache);
  if (fresh) await runAfterResponse(rememberVerifiedProducts(registered));
  return registered;
}

// ---------- T1: 商品の調査 ----------

/** 商品の調べものの結果のキャッシュのキー（v2: 医薬部外品の有効成分・「他 n成分」を読み取るようにした） */
function researchCacheKey(productQuery: string): Promise<string> {
  return hashedCacheKey('webfacts:v2', productQuery.normalize('NFKC').toLowerCase());
}

/**
 * この検索語の、全員で共有してよい調べた結果（キャッシュ。費用なし。書き込まない）。無ければ []。
 * 探している製品が入っているかは、呼び出し側が確かめる（同じ検索語で別の製品だけが見つかっていることがある）
 */
export async function sharedResearchFor(productQuery: string): Promise<Product[]> {
  const cached = await cacheGetJSON<Product[]>(await researchCacheKey(productQuery));
  return cached ? (sharedCached(cached) ?? []) : [];
}

/**
 * 商品名で Web を調べ、出典ページから製品名と全成分を取り出す（T1）
 * productQuery は toProductSearchQuery() を通した商品名であること
 */
export async function researchProducts(
  productQuery: string,
  limit = 4,
  { retryEmpty = false }: { retryEmpty?: boolean } = {}
): Promise<Product[]> {
  if (!isGeminiConfigured()) return [];

  const cacheKey = await researchCacheKey(productQuery);
  const cached = await cacheGetJSON<Product[]>(cacheKey);
  // 調べ直しを頼まれたときは、全成分が1つも無かった結果のキャッシュを使わない。
  // 同じ検索語では RETRY_COOLDOWN_SECONDS に1回まで（何度押しても、有料の調べものは増えない）
  let usable = !!cached;
  if (cached && retryEmpty && !hasAnyIngredients(cached) && !(await cacheGetJSON<boolean>(`${cacheKey}:retry`))) {
    await cachePutJSON(`${cacheKey}:retry`, true, RETRY_COOLDOWN_SECONDS);
    usable = false;
  }
  const shared = cached && usable ? sharedCached(cached) : null;
  if (shared) return registerProducts(await translateCachedLabels(cacheKey, shared, limit), { fresh: false });
  if (await cacheGetJSON<boolean>(`${cacheKey}:fail`)) return [];
  if (await cacheGetJSON<boolean>(`${cacheKey}:untrusted`)) return [];

  const pages = await searchAndReadProducts(`${productQuery} 全成分`, productQuery, { matchTarget: true });
  // 一時的な失敗（検索・Gemini のエラー等）は「見つからなかった」としてキャッシュしない。しばらく同じ検索をしない印だけ付ける
  if (!pages) {
    await rememberResearchFailure(cacheKey);
    return [];
  }
  const candidates = await Promise.all(pages.map(toProduct));
  // 英語の全成分表示は、ブランドを確かめた製品だけ日本語の名前にする（訳した結果をキャッシュする）
  const unique = await translateEnglishLabels(uniqueProducts(await keepRealBrands(candidates)));
  logSourceTrust(unique, 'research');
  // 全員で共有するキャッシュには、信頼するサイトの製品だけ（enforce のとき）。それ以外は調べた本人にだけ返す。
  // 信頼しないサイトの製品しか無ければ何も保存しない（調べものは失敗していないので、失敗の印も付けない）
  const toShare = unique.filter(mayShareWebProduct);

  if (toShare.length > 0) {
    // 全成分が1つも取れなかった結果は短く（ページが更新されたり、別のページが見つかったりする）
    await cachePutJSON(cacheKey, toShare, hasAnyIngredients(toShare) ? FACTS_TTL_SECONDS : FACTS_MISS_TTL_SECONDS);
  } else if (candidates.length === 0) {
    // ページを読んで該当製品が無かったときだけ「見つからない」を短期間保持する。
    // ブランド判定で全て外れた場合は Clef の一時的な不調もありうるので保存しない
    await cachePutJSON(cacheKey, unique, FACTS_MISS_TTL_SECONDS);
  } else if (unique.length > 0) {
    await cachePutJSON(`${cacheKey}:untrusted`, true, UNTRUSTED_ONLY_TTL_SECONDS);
  }
  return registerProducts(markUnshared(unique.slice(0, limit)), { fresh: true });
}

// ---------- T3: 代わりの商品の候補 ----------

/**
 * 代わりの商品の候補を Web で探し、全成分がページで確認できた製品だけを登録して返す（T3）。
 * 原因成分を含まないかの確認は呼び出し側（findSafeAlternatives）が行う。
 * query はアプリが成分DBの名前と決まった語だけで組み立てたもの（利用者の文章を含めない）
 */
export async function researchAlternativeCandidates(query: string, target: string): Promise<Product[]> {
  if (!isGeminiConfigured()) return [];

  // ページから読み取った製品情報だけをキャッシュする（検索結果そのものは保存しない）
  const cacheKey = await hashedCacheKey('altfacts:v1', query.normalize('NFKC'));
  const cached = await cacheGetJSON<Product[]>(cacheKey);
  const shared = cached && sharedCached(cached);
  if (shared) return registerProducts(await translateCachedLabels(cacheKey, shared, shared.length), { fresh: false });
  if (await cacheGetJSON<boolean>(`${cacheKey}:fail`)) return [];

  const pages = await searchAndReadProducts(query, target);
  if (!pages) {
    await rememberResearchFailure(cacheKey);
    return [];
  }

  const candidates = await Promise.all(pages.filter((p) => p.ingredients.length > 0).map(toProduct));
  const found = await translateEnglishLabels(uniqueProducts(await keepRealBrands(candidates)));
  logSourceTrust(found, 'alternatives');
  // 代わりの商品は、信頼するサイトの製品だけ（検索語はアプリが作るので全員で同じ。狙ったページを紛れ込ませない）
  const products = found.filter(mayShareWebProduct);
  if (products.length > 0) {
    await cachePutJSON(cacheKey, products, FACTS_TTL_SECONDS);
  } else if (candidates.length === 0 || found.length > 0) {
    // ページを読んで全成分つきの製品が無かった。ブランド判定で全て外れた場合は Clef の一時的な不調もありうるので保存しない。
    // 見つかった製品がどれも信頼しないサイトのものなら、空の結果がだれにとっても同じ答えなので保存する
    await cachePutJSON(cacheKey, products, FACTS_MISS_TTL_SECONDS);
  }
  return registerProducts(products, { fresh: true });
}

/**
 * 番号の完全一致は Linkup の方が強い（Exa は意味で検索するため数字を無視しやすい。2026-10-12 に確認）。
 * Linkup → Exa の順に、結果のどこかに同じバーコードが書かれたものだけを返す
 */
async function searchForBarcode(barcode: string): Promise<WebSearchItem[] | null> {
  // 0 だけのコードは、先頭の 0 を除くと空になり何にでも一致するため調べない
  if (!/[1-9]/.test(barcode)) return [];
  // 数字の一部ではなく、前後に数字の無い同じコード（先頭の 0 の有無は同一視）
  const codePattern = new RegExp(`(?<!\\d)0*${barcode.replace(/^0+/, '')}(?!\\d)`);
  let anySucceeded = false;
  for (const provider of BARCODE_SEARCH_PROVIDERS) {
    const items = await runWebSearch(`JAN ${barcode}`, provider, SEARCH_RESULT_LIMIT);
    if (items) anySucceeded = true;
    const matching = (items ?? []).filter((i) => codePattern.test(`${i.url} ${i.title} ${i.description}`));
    if (matching.length > 0) return matching;
  }
  // 全プロバイダーが失敗したときは null（一時的な失敗。「見つからない」とは区別する）
  return anySucceeded ? [] : null;
}

/**
 * バーコードで Web を調べる。ページに同じバーコードが書かれている製品だけを返す（AI の推測で対応付けない）
 * 見つからなければ null、検索・Gemini の一時的な失敗や設定不足なら undefined（呼び出し側は「見つからない」を保存しない）
 */
export async function researchBarcode(barcode: string): Promise<Product | null | undefined> {
  if (!isGeminiConfigured() || !/^[0-9]{8,14}$/.test(barcode)) return undefined;

  // バーコードの数字そのものが書かれた検索結果だけを読む（関係のないページに Gemini のトークンを使わない）
  const items = await searchForBarcode(barcode);
  if (!items) return undefined;
  if (items.length === 0) return null;

  const read = await readProductPages(pickPagesToRead(items), `JAN/EANコード ${barcode} の製品`);
  if (!read) return undefined;
  const pages = read.products;
  const sameCode = (code?: string) => !!code && code.replace(/^0+/, '') === barcode.replace(/^0+/, '');
  const matches = pages.filter((p) => sameCode(p.barcode));
  // 読めなかったページがあれば「見つからない」とは言えない（全員に「見つからない」を保存させない）
  if (matches.length === 0) return read.incomplete ? undefined : null;

  // 全成分が取れたページを優先
  matches.sort((a, b) => b.ingredients.length - a.ingredients.length);
  const [real] = await keepRealBrands([await toProduct({ ...matches[0], barcode })]);
  // ブランドの確認（Clef）は断られた・失敗したときも除くので、除かれても「見つからない」とは言えない
  // （researchProducts と同じく、見つからない印を全員分には付けない）
  if (!real) return undefined;
  const [product] = await translateEnglishLabels([real]);
  // バーコードと製品を結びつけたのは、このページ。成分を別のページから取っても、このページの信頼で決める
  const identityShareable = mayShareWebProduct(product);

  // バーコードのページに全成分が無ければ、特定できた商品名で調べ、同じ製品の成分表示を使う
  if (!product.ingredientSource) {
    const withLabel = await findLabelByName(product);
    if (withLabel) {
      product.ingredients = withLabel.ingredients;
      product.ingredientsEn = withLabel.ingredientsEn;
      product.activeIngredientsJa = withLabel.activeIngredientsJa;
      product.isQuasiDrug = product.isQuasiDrug || withLabel.isQuasiDrug;
      product.undisclosedIngredientCount = withLabel.undisclosedIngredientCount;
      product.ingredientSource = 'web_page';
      product.sourceUrl = withLabel.sourceUrl;
    }
  }

  logSourceTrust([product], 'barcode');
  const [registered] = await registerProducts(markUnshared([product], !identityShareable), { fresh: true });
  return registered;
}

/** 同じ製品（表記ゆれ・容量違いを同一視）の、全成分付きの調査結果を探す */
async function findLabelByName(product: Product): Promise<Product | null> {
  const query = productSearchQuery(product);
  if (!query) return null;
  const key = productIdentityKey(product.brand, product.name);
  const related = await researchProducts(query);
  return related.find((r) => r.ingredientSource === 'web_page' && productIdentityKey(r.brand, r.name) === key) ?? null;
}

/**
 * 保存した Web のページの製品を、同じページから読み直す（毎日の調べ直し。src/lib/services/seeding.ts）。
 * 有料（Gemini でページを1つ読む）。調べものの結果のキャッシュ・AI Gateway のキャッシュは使わない（古い写しを読まない）。
 * 同じ id（同じページ・ブランド・商品名）で全成分が読めた製品を返す。ページに無ければ null、読めなければ undefined
 */
export async function refreshPageProduct(stored: Product): Promise<Product | null | undefined> {
  const target = productSearchQuery(stored);
  // コードで読むページ（site-readers.ts）は Gemini が無くても読める
  if (!stored.sourceUrl || !target || (!isGeminiConfigured() && !isSiteReadable(stored.sourceUrl))) return null;
  const read = await readProductPages([stored.sourceUrl], target, { skipCache: true });
  if (!read) return undefined;
  for (const page of read.products) {
    // 保存したときの URL で ID を作る（コードで読むページは問い合わせの部分を外した URL を出典にするが、
    // その前に保存した製品の ID は元の URL から作ってある。読んだのはこの1ページだけ）
    const product = await toProduct({ ...page, sourceUrl: stored.sourceUrl });
    if (product.id !== stored.id || product.ingredientSource !== 'web_page') continue;
    // 前に保存したときと同じく、英語の全成分表示は日本語の名前にする（訳した版と英語の版を「違う内容」としない）
    const [translated] = await translateEnglishLabels([product]);
    return translated;
  }
  return read.incomplete ? undefined : null;
}

/** 同じ製品のキー（src/lib/search/product-identity.ts。今までの import のため） */
export { productIdentityKey };
