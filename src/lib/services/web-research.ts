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
import { labelProductFields, parseIngredientLabel } from '../analyzer/label-parser';
import { callGemini, isGeminiConfigured, parseJsonLoose } from './gemini-client';
import { isAcceptedBrand, judgeBrands } from './brand-check';
import { translateEnglishLabels } from './ingredient-translate';

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
const MAX_ACTIVE_INGREDIENTS = 10;
/** 製品に持たせる出典 URL の長さの上限（validation.ts の MAX_URL_LENGTH と同じ） */
const MAX_SOURCE_URL_LENGTH = 2048;

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
 * accept を渡すと、それに合うページだけを残す（合うページが無ければ次のプロバイダーを試す）
 */
export async function webSearch(
  query: string,
  limit = SEARCH_RESULT_LIMIT,
  accept?: (url: string) => boolean,
  providers: WebSearchProvider[] = SEARCH_PROVIDERS
): Promise<{ provider: WebSearchProvider; items: WebSearchItem[] } | null> {
  let searched = false;
  for (const provider of providers) {
    const found = await runWebSearch(query, provider, limit);
    if (found) searched = true;
    const items = found && accept ? found.filter((i) => accept(i.url)) : found;
    // 読めるページが1件も無ければ（Amazon・SNS だけ等）次のプロバイダーを試す
    if (items && pickPagesToRead(items).length > 0) return { provider, items };
  }
  // accept に合うページが無かっただけなら、検索の失敗ではない
  return accept && searched ? { provider: providers[0], items: [] } : null;
}

/** 検索結果一覧のページ（複数の店・商品が混ざり、店名・商品名を取り違えやすい） */
const SKIP_PATH_PATTERN = /^\/search(\/|$)|\/search(\.php|\.html?)?$/i;
/** 読んでも製品の成分表示が得られないページ（検索結果一覧・SNS・動画・Amazon は読み込みを拒否されやすい） */
const SKIP_HOST_PATTERN =
  /(^|\.)(search\.kakaku\.com|search\.rakuten\.co\.jp|instagram\.com|x\.com|twitter\.com|facebook\.com|tiktok\.com|youtube\.com|youtu\.be|amazon\.[a-z.]+|pinterest\.[a-z.]+)$/;

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
    const { hostname, pathname } = new URL(item.url);
    if (SKIP_HOST_PATTERN.test(hostname.toLowerCase()) || SKIP_PATH_PATTERN.test(pathname)) continue;
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
  /** ページに全成分表示があった場合のみ。無ければ空。医薬部外品は「その他の成分」 */
  ingredients: string[];
  /** 医薬部外品の有効成分（全成分表示があった場合のみ） */
  activeIngredients: string[];
  /** ページに医薬部外品と書かれていた、または有効成分が分けて書かれていた */
  isQuasiDrug: boolean;
  /** 「他 n成分」の n */
  undisclosedCount: number;
  /** ページに書かれていた JAN/EAN/UPC（数字のみ）。無ければ undefined */
  barcode?: string;
}

function buildReadPrompt(urls: string[], target: string): string {
  return `次のURLのページだけを読み、各ページに掲載されている化粧品のうち「${target}」に該当する製品について、ページに書かれている内容のみを抽出してください。
ページに書かれていない情報は推測せず、空にしてください。該当する製品が無いページは出力に含めないでください。
${urls.map((u, i) => `${i + 1}. ${u}`).join('\n')}

JSON配列のみを出力（1ページにつき最大2製品）:
[{"sourceUrl": "読んだページのURL（上の一覧のいずれか）", "brand": "ブランド名・メーカー名", "name": "製品名", "category": "cleanser | toner | serum | cream | sunscreen | mask | lip | other", "ingredients": ["ページの全成分表示の順番どおり。有効成分として分けて書かれた成分は除く。「他3成分」のような記載もそのまま1項目にする。全成分表示が無ければ空配列"], "activeIngredients": ["「有効成分」として分けて書かれた成分、または※印などで有効成分と示された成分。無ければ空配列"], "quasiDrug": ページに「医薬部外品」と書かれていれば true、無ければ false, "ingredientsFoundOnPage": true または false, "barcode": "ページに書かれたJAN/EANコード（数字のみ）。無ければ空文字"}]`;
}

type ConfirmedItem = { item: Record<string, unknown>; sourceUrl: string };

/**
 * ページの読み取りの結果
 * - blockedUrls: 成分表示などの書き写しが著作物の引用に似ているとして Gemini に止められたページ
 * - failedUrls: 読み直しで失敗したページ（エラー・予算超過など一時的なもの。「該当なし」とは言えない）
 */
export interface PageReadResult {
  items: ConfirmedItem[];
  blockedUrls: string[];
  failedUrls: string[];
}

/**
 * Gemini の URL context でページを読み、出典を確かめた項目だけを返す。Gemini の呼び出しに失敗したら null
 * 出典 URL（各項目の sourceUrl）が「読むよう指示したページ」かつ「読み込みに成功したページ」でない項目は捨てる
 *
 * 複数ページをまとめて読んだ応答が RECITATION（著作物の引用に似ている）で止められたら、1ページずつ読み直す。
 * 止められるのはページ単位のことが多く、1ページのせいで他のページの成分表示まで失わないように。
 * 読み直しは AI Gateway のキャッシュを使わない（止められた空の応答がキャッシュから返らないように）
 */
export async function readPagesWithSources(
  urls: string[],
  buildPrompt: (urls: string[]) => string,
  maxOutputTokens: number,
  { skipCache = false } = {}
): Promise<PageReadResult | null> {
  if (urls.length === 0) return { items: [], blockedUrls: [], failedUrls: [] };
  const together = await readPagesOnce(urls, buildPrompt(urls), maxOutputTokens, skipCache);
  if (together !== 'recitation') return together && { items: together, blockedUrls: [], failedUrls: [] };
  if (urls.length === 1) return { items: [], blockedUrls: urls, failedUrls: [] };

  const one = await Promise.all(urls.map((u) => readPagesOnce([u], buildPrompt([u]), maxOutputTokens, true)));
  // どのページも読めなかった（一時的な失敗）なら null。止められたページは「該当なし」と区別して返す
  if (one.every((r) => r === null)) return null;
  return {
    items: one.flatMap((r) => (Array.isArray(r) ? r : [])),
    blockedUrls: urls.filter((_, i) => one[i] === 'recitation'),
    failedUrls: urls.filter((_, i) => one[i] === null),
  };
}

/** 1回の Gemini 呼び出しでページを読む。RECITATION で止められたら 'recitation' */
async function readPagesOnce(
  urls: string[],
  prompt: string,
  maxOutputTokens: number,
  skipCache: boolean
): Promise<ConfirmedItem[] | 'recitation' | null> {
  const result = await callGemini({
    task: 'page_read',
    prompt,
    urlContext: true,
    generationConfig: { temperature: 0, maxOutputTokens },
    timeoutMs: READ_TIMEOUT_MS,
    skipCache,
  });
  if (result?.recitation) return 'recitation';
  if (!result || result.truncated) return null;

  const parsed = parseJsonLoose<unknown>(result.text);
  if (!Array.isArray(parsed)) return null;

  const requested = new Map<string, string>();
  for (const u of urls) {
    const norm = normalizeUrl(u);
    if (norm) requested.set(norm, u);
  }
  const retrieved = new Set((result.retrievedUrls ?? []).map(normalizeUrl).filter((u): u is string => !!u));
  // どのページも読み込めなかった（一時的な失敗の可能性）。「該当なし」とは区別する
  if (retrieved.size === 0) return null;

  const confirmed: ConfirmedItem[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.sourceUrl !== 'string') continue;
    const source = normalizeUrl(item.sourceUrl);
    // 出典の確認：指示したページで、実際に読み込めたものだけ
    if (!source || !requested.has(source) || !retrieved.has(source)) continue;
    confirmed.push({ item, sourceUrl: requested.get(source)! });
  }
  return confirmed;
}

/**
 * Gemini の URL context でページを読み、出典を確かめた製品情報を返す。Gemini の呼び出しに失敗したら null
 * allBlocked: 読んだ全ページで、書き写しが Gemini に止められた（別の検索結果のページなら読めることがある）
 * incomplete: 一部のページの読み直しが一時的に失敗した（製品が無くても「該当なし」とは言えない）
 */
export async function readProductPages(
  urls: string[],
  target: string
): Promise<{ products: PageProduct[]; allBlocked: boolean; incomplete: boolean } | null> {
  // 3ページ×2製品の全成分が入るよう余裕を持たせる（思考は既定の low）
  const read = await readPagesWithSources(urls, (u) => buildReadPrompt(u, target), 8192);
  if (!read) return null;
  const allBlocked = urls.length > 0 && read.blockedUrls.length === urls.length;
  const incomplete = read.failedUrls.length > 0;

  const products: PageProduct[] = [];
  for (const { item, sourceUrl } of read.items) {
    if (typeof item.name !== 'string' || typeof item.brand !== 'string') continue;

    const name = item.name.trim();
    const brand = item.brand.trim();
    if (!name || !brand || name.length > MAX_NAME_LENGTH || brand.length > MAX_NAME_LENGTH) continue;

    // ページの文章は信頼できない入力なので、成分表示として不自然な長さ・件数なら「成分未確認」として扱う
    const found = item.ingredientsFoundOnPage === true;
    const strings = (v: unknown): string[] =>
      found && Array.isArray(v) ? v.filter((i): i is string => typeof i === 'string') : [];
    // 1行1成分にして読み直す（項目に残った「有効成分：」「※」「他3成分」を処理する）
    const label = parseIngredientLabel(strings(item.ingredients).join('\n'));
    // 有効成分の欄も同じ読み取りを通す（「※」「有効成分：」が名前に残らないように）
    const activeLabel = parseIngredientLabel(strings(item.activeIngredients).join('\n'));
    const actives = [
      ...new Set([...activeLabel.activeIngredients, ...activeLabel.ingredients, ...label.activeIngredients]),
    ];
    const plausible =
      label.ingredients.length >= MIN_INGREDIENTS &&
      label.ingredients.length <= MAX_INGREDIENTS &&
      actives.length <= MAX_ACTIVE_INGREDIENTS &&
      [...label.ingredients, ...actives].every((i) => i.length <= MAX_INGREDIENT_LENGTH);
    const ingredients = plausible ? [...new Set(label.ingredients)] : [];
    const barcode =
      typeof item.barcode === 'string' && /^[0-9]{8,14}$/.test(item.barcode.trim()) ? item.barcode.trim() : undefined;

    products.push({
      sourceUrl,
      brand,
      name,
      category: PRODUCT_CATEGORIES.includes(item.category as Product['category'])
        ? (item.category as Product['category'])
        : 'other',
      ingredients,
      activeIngredients: plausible ? actives : [],
      isQuasiDrug: item.quasiDrug === true || (plausible && (label.isQuasiDrug || actives.length > 0)),
      undisclosedCount: plausible ? label.undisclosedCount : 0,
      barcode,
    });
  }
  return { products, allBlocked, incomplete };
}

/** 探し直しで読むページ数の上限（止められたときの Gemini の呼び出し回数を抑える） */
const MAX_RETRY_PAGES = 2;

/**
 * Web で検索し、上位のページを読む。全ページが RECITATION で止められたら、まだ使っていない検索サービス
 * （Exa で見つけたなら Linkup）で探し直し、まだ読んでいないページを読む（別のお店のページなら止められないことがある）。
 * - 戻り値の [] は確定した「該当なし」（ページを読んで該当製品が無い、または読めるページが全て止められた）
 * - 検索・読み取りの一時的な失敗は null（呼び出し側は「見つからない」として保存しない）
 */
async function searchAndReadProducts(query: string, target: string): Promise<PageProduct[] | null> {
  const search = await webSearch(query);
  if (!search) return null;
  const urls = pickPagesToRead(search.items);
  const read = await readProductPages(urls, target);
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
  const reread = await readProductPages(fresh, target);
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

/** 同じ製品が複数ページにある場合は、全成分が取れたもの（同順なら検索順の上位）を1件だけ残す */
function uniqueProducts(products: Product[]): Product[] {
  const unique: Product[] = [];
  const seen = new Set<string>();
  for (const p of [...products].sort((a, b) => Number(!!b.ingredientSource) - Number(!!a.ingredientSource))) {
    const key = productIdentityKey(p.brand, p.name);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  return unique;
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

  // v2: 医薬部外品の有効成分・「他 n成分」を読み取るようにした
  const cacheKey = await hashedCacheKey('webfacts:v2', productQuery.normalize('NFKC').toLowerCase());
  const cached = await cacheGetJSON<Product[]>(cacheKey);
  // 前回訳せなかった英語の全成分表示は、ここで訳し直す（訳せても KV は書き直さない）
  if (cached) return registerProducts(await translateEnglishLabels(cached.slice(0, limit)), { fresh: false });

  const pages = await searchAndReadProducts(`${productQuery} 全成分`, productQuery);
  // 一時的な失敗（検索・Gemini のエラー等）は「見つからなかった」としてキャッシュしない
  if (!pages) return [];
  const candidates = await Promise.all(pages.map(toProduct));
  // 英語の全成分表示は、ブランドを確かめた製品だけ日本語の名前にする（訳した結果をキャッシュする）
  const unique = await translateEnglishLabels(uniqueProducts(await keepRealBrands(candidates, productQuery)));

  if (unique.length > 0) {
    await cachePutJSON(cacheKey, unique, FACTS_TTL_SECONDS);
  } else if (candidates.length === 0) {
    // ページを読んで該当製品が無かったときだけ「見つからない」を短期間保持する。
    // ブランド判定で全て外れた場合は Clef の一時的な不調もありうるので保存しない
    await cachePutJSON(cacheKey, unique, FACTS_MISS_TTL_SECONDS);
  }
  return registerProducts(unique.slice(0, limit), { fresh: true });
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
  if (cached) return registerProducts(await translateEnglishLabels(cached), { fresh: false });

  const pages = await searchAndReadProducts(query, target);
  if (!pages) return [];

  const candidates = await Promise.all(pages.filter((p) => p.ingredients.length > 0).map(toProduct));
  const products = await translateEnglishLabels(uniqueProducts(await keepRealBrands(candidates, target)));
  if (products.length > 0) {
    await cachePutJSON(cacheKey, products, FACTS_TTL_SECONDS);
  } else if (candidates.length === 0) {
    // ページを読んで全成分つきの製品が無かった。ブランド判定で全て外れた場合は Clef の一時的な不調もありうるので保存しない
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
  if (matches.length === 0) return null;

  // 全成分が取れたページを優先
  matches.sort((a, b) => b.ingredients.length - a.ingredients.length);
  const [real] = await keepRealBrands([await toProduct({ ...matches[0], barcode })], barcode);
  if (!real) return null;
  const [product] = await translateEnglishLabels([real]);

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

  const [registered] = await registerProducts([product], { fresh: true });
  return registered;
}

/** 製品を Web で調べるときの商品名（ブランド＋商品名、容量を除く）。商品名と言えなければ null */
export function productSearchQuery(product: Pick<Product, 'brand' | 'name'>): string | null {
  const name = product.name.normalize('NFKC').replace(/\d+(\.\d+)?\s*(ml|g|l)\b/gi, '').trim();
  // 「ちふれ・CHIFURE」「ちふれ化粧品 / ちふれ」のような複数の表記は、最初の表記だけ
  const brand = product.brand.normalize('NFKC').split(/[・･/／]/)[0].trim();
  const full = !brand || name.includes(brand) ? name : `${brand} ${name}`;
  // 長い商品名は先頭の語だけにする（検索結果の製品の確認は呼び出し側で行う）
  return toProductSearchQuery(full) ?? toProductSearchQuery(full.split(/\s+/).slice(0, 4).join(' '));
}

/** 同じ製品（表記ゆれ・容量違いを同一視）の、全成分付きの調査結果を探す */
async function findLabelByName(product: Product): Promise<Product | null> {
  const query = productSearchQuery(product);
  if (!query) return null;
  const key = productIdentityKey(product.brand, product.name);
  const related = await researchProducts(query);
  return related.find((r) => r.ingredientSource === 'web_page' && productIdentityKey(r.brand, r.name) === key) ?? null;
}
