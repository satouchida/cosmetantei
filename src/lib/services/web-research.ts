import 'server-only';
import { Product } from '../types';
import { addProductToDynamicCache, rememberVerifiedProducts } from '../data/cosmetics-db';
import {
  cacheGetJSON,
  cachePutJSON,
  hashedCacheKey,
  runAfterResponse,
  runWebSearch,
  WebSearchItem,
  WebSearchProvider,
} from '../server/cloudflare';
import { buildAmazonAffiliateUrl } from './amazon-affiliate';
import { callGemini, isGeminiConfigured, parseJsonLoose } from './gemini-client';
import { isAcceptedBrand, judgeBrands } from './brand-check';

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

const SEARCH_PROVIDERS: WebSearchProvider[] = ['exa', 'linkup'];
const BARCODE_SEARCH_PROVIDERS: WebSearchProvider[] = ['linkup', 'exa'];
const SEARCH_RESULT_LIMIT = 5;
const MAX_PAGES_TO_READ = 3;
const READ_TIMEOUT_MS = 30_000;

/** ページから読み取った製品情報のキャッシュ（ページ由来の事実のみ。検索結果そのものは保存しない） */
const FACTS_TTL_SECONDS = 60 * 60 * 24 * 7;
const FACTS_MISS_TTL_SECONDS = 60 * 60;

const UNCONFIRMED_INGREDIENTS = '成分情報は確認できませんでした';
const MAX_NAME_LENGTH = 100;
const MIN_INGREDIENTS = 3;
const MAX_INGREDIENTS = 150;
const MAX_INGREDIENT_LENGTH = 80;

const PRODUCT_CATEGORIES: Product['category'][] = [
  'cleanser',
  'toner',
  'serum',
  'cream',
  'sunscreen',
  'mask',
  'lip',
  'other',
];

// ---------- 検索語 ----------

/** 検索の依頼文（「〜の成分を教えて」等）。商品名の後ろから取り除く */
const REQUEST_SUFFIX =
  /(?:の|について)?(?:全成分|成分表示?|成分|原材料)?(?:を|は|が)?(?:教えて(?:ください|下さい)?|調べて(?:ください|下さい)?|知りたい(?:です)?|検索して(?:ください|下さい)?|見せて(?:ください|下さい)?|ありますか|何ですか|なに)?[。．.!！?？\s]*$/;

/** 本人の肌・体調の話題や連絡先。商品名ではないので検索語にしない */
const PERSONAL_PATTERN = new RegExp(
  [
    // 本人・家族・知人
    // （「赤ちゃん」「子供用」「アトピー肌用」等は商品名にも使われるため、人を指す言い回しのときだけ）
    '私|わたし|僕|ぼく|俺|自分|うちの|娘|息子|妻|夫|彼氏|彼女|友達|友人|赤ちゃんが|赤ちゃんに|子供が|子どもが|子供に|子どもに',
    // 体調・症状・属性
    '肌荒れ|かゆ|痒|赤く|ヒリヒリ|症状|病院|皮膚科|治ら|治療|妊娠中|妊娠して|妊婦|授乳中|アトピーの|\\d+(?:歳|才|代)',
    // 文の言い回し（商品名には現れない）
    'です|ます|ました|でした|だった|てる|ている|使って|使った|たい|けど|ので',
  ].join('|')
);
// 区切り（空白・ハイフン・長音記号など）を挟んだ数字の並びも連絡先・番号とみなす
const CONTACT_PATTERN = /@|https?:|www\.|〒|\d(?:[\s\-ー−‐–.]*\d){4,}/;
const MAX_PRODUCT_QUERY_LENGTH = 40;
const MAX_PRODUCT_QUERY_WORDS = 8;

/**
 * 利用者の入力から、Web 検索に使ってよい「商品名」だけを取り出す。商品名と言えない入力は null（検索しない）
 * - 依頼の言い回しを除き、短い名詞句だけを残す
 * - 文になっているもの、本人の症状、連絡先・番号を含むものは送らない
 */
export function toProductSearchQuery(text: string): string | null {
  const whole = text.normalize('NFKC');
  if (CONTACT_PATTERN.test(whole)) return null;
  let q = whole.replace(/\s+/g, ' ').trim();
  q = q.replace(REQUEST_SUFFIX, '').trim();
  if (!q || q.length < 2 || q.length > MAX_PRODUCT_QUERY_LENGTH) return null;
  if (/[。!！?？\n、]/.test(q)) return null;
  if (q.split(' ').length > MAX_PRODUCT_QUERY_WORDS) return null;
  if (PERSONAL_PATTERN.test(q) || CONTACT_PATTERN.test(q)) return null;
  return q;
}

// ---------- 検索 ----------

/**
 * Web 検索（Exa → 失敗・0件なら Linkup）。両方だめなら null
 */
export async function webSearch(
  query: string,
  limit = SEARCH_RESULT_LIMIT
): Promise<{ provider: WebSearchProvider; items: WebSearchItem[] } | null> {
  for (const provider of SEARCH_PROVIDERS) {
    const items = await runWebSearch(query, provider, limit);
    // 読めるページが1件も無ければ（Amazon・SNS だけ等）次のプロバイダーを試す
    if (items && pickPagesToRead(items).length > 0) return { provider, items };
  }
  return null;
}

/** 読んでも製品の成分表示が得られないページ（検索結果一覧・SNS・動画・Amazon は読み込みを拒否されやすい） */
const SKIP_HOST_PATTERN =
  /(^|\.)(search\.kakaku\.com|instagram\.com|x\.com|twitter\.com|facebook\.com|tiktok\.com|youtube\.com|youtu\.be|amazon\.[a-z.]+|pinterest\.[a-z.]+)$/;

/** URL を比較用に正規化する（フラグメント・末尾のスラッシュ・ホストの大文字小文字の違いを無視） */
export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.hash = '';
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return null;
  }
}

/** 検索結果から読むページを選ぶ（検索順を保ち、読めないページと重複を除く） */
export function pickPagesToRead(items: WebSearchItem[], max = MAX_PAGES_TO_READ): string[] {
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const norm = normalizeUrl(item.url);
    if (!norm || seen.has(norm)) continue;
    const host = new URL(item.url).hostname.toLowerCase();
    if (SKIP_HOST_PATTERN.test(host)) continue;
    // 正規化した URL を使う（空白・制御文字はエンコードされ、プロンプトに余計な文字が入らない）
    const href = new URL(item.url).href;
    if (/\s/.test(href)) continue;
    seen.add(norm);
    picked.push(href);
    if (picked.length >= max) break;
  }
  return picked;
}

// ---------- ページの読み取り ----------

/** ページから読み取った製品情報（出典確認済み） */
export interface PageProduct {
  sourceUrl: string;
  brand: string;
  name: string;
  category: Product['category'];
  /** ページに全成分表示があった場合のみ。無ければ空 */
  ingredients: string[];
  /** ページに書かれていた JAN/EAN/UPC（数字のみ）。無ければ undefined */
  barcode?: string;
}

function buildReadPrompt(urls: string[], target: string): string {
  return `次のURLのページだけを読み、各ページに掲載されている化粧品のうち「${target}」に該当する製品について、ページに書かれている内容のみを抽出してください。
ページに書かれていない情報は推測せず、空にしてください。該当する製品が無いページは出力に含めないでください。
${urls.map((u, i) => `${i + 1}. ${u}`).join('\n')}

JSON配列のみを出力（1ページにつき最大2製品）:
[{"sourceUrl": "読んだページのURL（上の一覧のいずれか）", "brand": "ブランド名・メーカー名", "name": "製品名", "category": "cleanser | toner | serum | cream | sunscreen | mask | lip | other", "ingredients": ["ページの全成分表示の順番どおり。全成分表示が無ければ空配列"], "ingredientsFoundOnPage": true または false, "barcode": "ページに書かれたJAN/EANコード（数字のみ）。無ければ空文字"}]`;
}

/**
 * Gemini の URL context でページを読み、出典を確かめた製品情報を返す。Gemini の呼び出しに失敗したら null
 * 出典 URL が「読むよう指示したページ」かつ「読み込みに成功したページ」でない項目は捨てる
 */
export async function readProductPages(urls: string[], target: string): Promise<PageProduct[] | null> {
  if (urls.length === 0) return [];
  const result = await callGemini({
    prompt: buildReadPrompt(urls, target),
    urlContext: true,
    // 3ページ×2製品の全成分が入るよう余裕を持たせる（思考は既定の low）
    generationConfig: { temperature: 0, maxOutputTokens: 8192 },
    timeoutMs: READ_TIMEOUT_MS,
  });
  if (!result || result.truncated) return null;

  const parsed = parseJsonLoose<unknown>(result.text);
  if (!Array.isArray(parsed)) return null;

  const requested = new Map<string, string>();
  for (const u of urls) {
    const norm = normalizeUrl(u);
    if (norm) requested.set(norm, u);
  }
  const retrieved = new Set((result.retrievedUrls ?? []).map(normalizeUrl).filter((u): u is string => !!u));
  // どのページも読み込めなかった（一時的な失敗の可能性）。「該当製品なし」とは区別する
  if (retrieved.size === 0) return null;

  const products: PageProduct[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.sourceUrl !== 'string' || typeof item.name !== 'string' || typeof item.brand !== 'string') continue;

    const source = normalizeUrl(item.sourceUrl);
    // 出典の確認：指示したページで、実際に読み込めたものだけ
    if (!source || !requested.has(source) || !retrieved.has(source)) continue;

    const name = item.name.trim();
    const brand = item.brand.trim();
    if (!name || !brand || name.length > MAX_NAME_LENGTH || brand.length > MAX_NAME_LENGTH) continue;

    // ページの文章は信頼できない入力なので、成分表示として不自然な長さ・件数なら「成分未確認」として扱う
    const rawIngredients =
      item.ingredientsFoundOnPage === true && Array.isArray(item.ingredients)
        ? item.ingredients
            .filter((i): i is string => typeof i === 'string')
            .map((i) => i.trim())
            .filter((i) => i.length > 0)
        : [];
    const plausible =
      rawIngredients.length >= MIN_INGREDIENTS &&
      rawIngredients.length <= MAX_INGREDIENTS &&
      rawIngredients.every((i) => i.length <= MAX_INGREDIENT_LENGTH);
    const ingredients = plausible ? [...new Set(rawIngredients)] : [];
    const barcode =
      typeof item.barcode === 'string' && /^[0-9]{8,14}$/.test(item.barcode.trim()) ? item.barcode.trim() : undefined;

    products.push({
      sourceUrl: requested.get(source)!,
      brand,
      name,
      category: PRODUCT_CATEGORIES.includes(item.category as Product['category'])
        ? (item.category as Product['category'])
        : 'other',
      ingredients,
      barcode,
    });
  }
  return products;
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
    ingredients: hasIngredients ? p.ingredients : [UNCONFIRMED_INGREDIENTS],
    descriptionJa: `${p.brand} - ${p.name}`,
    amazonSearchUrl: buildAmazonAffiliateUrl(p.brand, p.name),
    isEstimatedFromMarketplaces: false,
    ingredientSource: hasIngredients ? 'web_page' : undefined,
    sourceUrl: p.sourceUrl,
  };
}

/** ブランド表記の会社名部分（「ちふれ化粧品」「〇〇株式会社」等） */
const COMPANY_SUFFIX = /(株式会社|化粧品|コスメティックス?|cosmetics?|inc|co|ltd)$/;

/**
 * ページごとに表記が違う同じ製品を同一視するためのキー
 * 例: 「ちふれ・CHIFURE / 美白化粧水 Ｗ」と「ちふれ化粧品 / ちふれ美白化粧水 W」は同じキーになる
 */
export function productIdentityKey(brand: string, name: string): string {
  const compact = (t: string) => t.normalize('NFKC').toLowerCase().replace(/[\s・･.,、。()（）\[\]【】'"’-]/g, '');
  const brandTokens = brand
    .normalize('NFKC')
    .toLowerCase()
    .split(/[\s・･/()（）,、]+/)
    .map((t) => compact(t).replace(COMPANY_SUFFIX, ''))
    .filter((t) => t.length >= 2);
  // 容量（150ml・つめかえ用の 130ml 等）は成分が同じなので区別しない
  let key = compact(name).replace(/\d+(\.\d+)?(ml|g|l)\b/g, '');
  for (const token of brandTokens) key = key.split(token).join('');
  return key || compact(name);
}

/** 一般名詞がブランド欄に入った製品を除く（語彙チェック → キャッシュ → Clef。Gemini の追加呼び出しなし） */
async function keepRealBrands(products: Product[], query: string): Promise<Product[]> {
  if (products.length === 0) return [];
  const decisions = await judgeBrands(
    products.map((p) => ({ brand: p.brand, productName: p.name })),
    query
  );
  return products.filter((_, i) => isAcceptedBrand(decisions[i]));
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

/**
 * 商品名で Web を調べ、出典ページから製品名と全成分を取り出す（T1）
 * productQuery は toProductSearchQuery() を通した商品名であること
 */
export async function researchProducts(productQuery: string, limit = 4): Promise<Product[]> {
  if (!isGeminiConfigured()) return [];

  const cacheKey = await hashedCacheKey('webfacts:v1', productQuery.normalize('NFKC').toLowerCase());
  const cached = await cacheGetJSON<Product[]>(cacheKey);
  if (cached) return registerProducts(cached.slice(0, limit), { fresh: false });

  const search = await webSearch(`${productQuery} 全成分`);
  if (!search) return [];

  const pages = await readProductPages(pickPagesToRead(search.items), productQuery);
  // 一時的な失敗（Gemini のエラー等）は「見つからなかった」としてキャッシュしない
  if (!pages) return [];
  const candidates = await Promise.all(pages.map(toProduct));
  const products = await keepRealBrands(candidates, productQuery);

  // 同じ製品が複数ページにある場合は、全成分が取れたもの（同順なら検索順の上位）を1件だけ残す
  const unique: Product[] = [];
  const seen = new Set<string>();
  for (const p of [...products].sort((a, b) => Number(!!b.ingredientSource) - Number(!!a.ingredientSource))) {
    const key = productIdentityKey(p.brand, p.name);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }

  if (unique.length > 0) {
    await cachePutJSON(cacheKey, unique, FACTS_TTL_SECONDS);
  } else if (candidates.length === 0) {
    // ページを読んで該当製品が無かったときだけ「見つからない」を短期間保持する。
    // ブランド判定で全て外れた場合は Clef の一時的な不調もありうるので保存しない
    await cachePutJSON(cacheKey, unique, FACTS_MISS_TTL_SECONDS);
  }
  return registerProducts(unique.slice(0, limit), { fresh: true });
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

  const pages = await readProductPages(pickPagesToRead(items), `JAN/EANコード ${barcode} の製品`);
  if (!pages) return undefined;
  const sameCode = (code?: string) => !!code && code.replace(/^0+/, '') === barcode.replace(/^0+/, '');
  const matches = pages.filter((p) => sameCode(p.barcode));
  if (matches.length === 0) return null;

  // 全成分が取れたページを優先
  matches.sort((a, b) => b.ingredients.length - a.ingredients.length);
  const [product] = await keepRealBrands([await toProduct({ ...matches[0], barcode })], barcode);
  if (!product) return null;

  // バーコードのページに全成分が無ければ、特定できた商品名で調べ、同じ製品の成分表示を使う
  if (!product.ingredientSource) {
    const withLabel = await findLabelByName(product);
    if (withLabel) {
      product.ingredients = withLabel.ingredients;
      product.ingredientSource = 'web_page';
      product.sourceUrl = withLabel.sourceUrl;
    }
  }

  const [registered] = await registerProducts([product], { fresh: true });
  return registered;
}

/** 同じ製品（表記ゆれ・容量違いを同一視）の、全成分付きの調査結果を探す */
async function findLabelByName(product: Product): Promise<Product | null> {
  const name = product.name.normalize('NFKC').replace(/\d+(\.\d+)?\s*(ml|g|l)\b/gi, '').trim();
  const query = toProductSearchQuery(name.includes(product.brand) ? name : `${product.brand} ${name}`);
  if (!query) return null;
  const key = productIdentityKey(product.brand, product.name);
  const related = await researchProducts(query);
  return related.find((r) => r.ingredientSource === 'web_page' && productIdentityKey(r.brand, r.name) === key) ?? null;
}
