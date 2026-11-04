import 'server-only';
import { isRakuten24, readShopConfig, ShopId, shopOfUrl } from './shops';
import { reserveSpend } from '../server/spend-cap';

/**
 * お店の公式 API で価格を調べる（楽天市場・Yahoo!ショッピング）。手順: docs/plans/shop-prices.md
 * - キーが設定されたお店だけ。未設定なら undefined（そのお店は調べない）
 * - 失敗（通信・429・形式違い）は null。「価格が無い」とは区別する
 * - 結果は保存しない。キーはログ・エラーに出さない
 */

export interface ShopOfferCandidate {
  shopId: ShopId;
  /** 販売している店（楽天・Yahoo! の出店者） */
  shop: string;
  brand: string;
  productName: string;
  priceYen: unknown;
  taxIncluded: boolean | null;
  /** 商品ページ（対象のお店の URL と確かめ済み） */
  sourceUrl: string;
}

const API_TIMEOUT_MS = 8_000;
const RAKUTEN_ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
const YAHOO_ENDPOINT = 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch';
const RAKUTEN_HITS = 30;
const YAHOO_RESULTS = 30;

export function isRakutenApiConfigured(): boolean {
  return !!readShopConfig('RAKUTEN_APPLICATION_ID') && !!readShopConfig('RAKUTEN_ACCESS_KEY');
}

export function isYahooApiConfigured(): boolean {
  return !!readShopConfig('YAHOO_CLIENT_ID');
}

/** 楽天のアプリに登録したサイト（[vars] の RAKUTEN_API_ORIGIN） */
const DEFAULT_RAKUTEN_API_ORIGIN = 'https://cosmetantei.app';

/**
 * 楽天の API のヘッダー。Origin が無いと 403（REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING）、
 * アプリに登録していないサイトなら 403（HTTP_REFERRER_NOT_ALLOWED）になる
 */
function rakutenHeaders(): Record<string, string> {
  return { accessKey: readShopConfig('RAKUTEN_ACCESS_KEY'), Origin: rakutenOrigin() };
}

/** Origin はスキームとホストだけ（設定の末尾の / やパスは外す。形が違えば既定のサイト） */
function rakutenOrigin(): string {
  try {
    const url = new URL(readShopConfig('RAKUTEN_API_ORIGIN') || DEFAULT_RAKUTEN_API_ORIGIN);
    // 「localhost:3000」のようにスキームが無いと、例外にならず origin が "null" になる
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : DEFAULT_RAKUTEN_API_ORIGIN;
  } catch {
    return DEFAULT_RAKUTEN_API_ORIGIN;
  }
}

/** 同じアプリ ID の呼び出しの間隔（楽天・Yahoo! とも 1秒に1回まで） */
const API_INTERVAL_MS = 1_100;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ShopApi = 'rakuten_api' | 'yahoo_api';

/** 要求に入れた値（検索語・アプリ ID・ヘッダーの accessKey）。お店の応答の文をログに出す前に伏せる。URL が読めなければ null */
function requestValues(url: string, headers: Record<string, string>): string[] | null {
  const values = [...Object.values(headers)];
  try {
    values.push(...new URL(url).searchParams.values());
  } catch {
    return null;
  }
  // 長い値から伏せる（短い値が長い値の一部でも、長い方が残らないように）
  return [...new Set(values.map((v) => v.replace(/\s+/g, ' ')).filter((v) => v.length >= 3))].sort((a, b) => b.length - a.length);
}

const UNEXPECTED_BODY_SCAN_CHARS = 4096;

const HTML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** 人が読む形にする：段落などのタグは区切り、文中のタグ（<b> <wbr> など）は消してつなぐ。文字参照を戻し、空白をまとめる */
function readableText(html: string): string {
  return html
    .replace(/<\/?(?:br|p|h\d|div|li|tr|td|th|pre|title|body|head|html)\b[^>]{0,300}>/gi, ' ')
    .replace(/<[^>]{0,300}>/g, '')
    .replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(amp|lt|gt|quot|apos|nbsp));/gi, (m, d, h, n) => {
      if (n) return HTML_ENTITIES[n.toLowerCase()];
      const cp = d ? parseInt(d, 10) : parseInt(h, 16);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    })
    .replace(/\s+/g, ' ');
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 値をそのまま・URL の形（%xx、空白の +、URLSearchParams の形）・HTML の形で探し、大文字小文字を問わず伏せる。値が無ければ全部伏せる */
function redact(text: string, values: string[] | null): string {
  if (!values) return '';
  let out = text;
  for (const v of values) {
    const encoded = encodeURIComponent(v);
    // URLSearchParams は ' ( ) ~ ! なども %xx にするので、その形も探す
    const formEncoded = new URLSearchParams({ v }).toString().slice(2);
    const forms = [v, encoded, encoded.replace(/%20/g, '+'), formEncoded, v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')];
    for (const f of new Set(forms)) out = out.replace(new RegExp(escapeRegExp(f), 'gi'), '…');
  }
  return out;
}

/**
 * 理由の読めない失敗の応答を、断ったのがどこか分かる程度にログ用に縮める：種類・server ヘッダー・長さ・本文の頭。
 * 頭の 4KB だけを見る（長い本文で正規表現が重くならないように）。タグと文字参照を外してから要求の値を伏せ
 * （タグで分けた値も伏せるため）、英数字と記号だけを 80 文字まで
 */
function unexpectedBody(res: Response, text: string, values: string[] | null): string {
  const head = redact(readableText(text.slice(0, UNEXPECTED_BODY_SCAN_CHARS)), values)
    .replace(/[^\x20-\x7e…]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  const type = (res.headers.get('content-type') ?? '').replace(/[^\x20-\x7e]/g, '').slice(0, 40);
  const server = (res.headers.get('server') ?? '').replace(/[^\x20-\x7e]/g, '').slice(0, 40);
  return JSON.stringify({ type, server, length: text.length, head });
}

async function getJson(
  url: string,
  headers: Record<string, string>,
  label: string,
  api: ShopApi,
  retried = false
): Promise<unknown | null> {
  // 呼び出しの回数を全体で数える（1秒に1回までの規約。金額は 0）。上限なら呼ばない
  if (!(await reserveSpend(api, 0))) {
    console.warn(`${label} skipped: rate limit reached`);
    return null;
  }
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    // 回数の上限に当たったら、1回だけ間をおいてやり直す（他の利用者と同じアプリ ID を使うため）
    if (res.status === 429 && !retried) {
      await res.body?.cancel().catch(() => {});
      await wait(API_INTERVAL_MS);
      return getJson(url, headers, label, api, true);
    }
    if (!res.ok) {
      // 404 は「該当なし」（楽天）
      if (res.status === 404) return {};
      // お店が返す理由も出す（楽天 error_description、Yahoo! Error.Message。例：keyword parameter is not valid）。検索語は出さない
      const text = await res.text().catch(() => '');
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        // JSON でない（お店の API の前の仕組みが断った、など）
      }
      const body =
        parsed && typeof parsed === 'object'
          ? (parsed as { error_description?: unknown; error?: unknown; Error?: { Message?: unknown } | null })
          : null;
      const reason = [body?.error_description, body?.Error?.Message, body?.error].find((r): r is string => typeof r === 'string') ?? '';
      const values = requestValues(url, headers);
      console.error(
        `${label} failed: ${res.status}${
          reason ? ` (${redact(reason, values).replace(/[^\x20-\x7e…]/g, '').slice(0, 120)})` : ` ${unexpectedBody(res, text, values)}`
        }`
      );
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`${label} failed:`, err instanceof Error ? err.name : 'error');
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// ---------- 楽天市場 ----------

/** 楽天の商品（formatVersion=2 は items 直下、1 は items[].item） */
function rakutenItems(body: unknown): Record<string, unknown>[] {
  const b = body as { items?: unknown; Items?: unknown } | null;
  const list = b?.items ?? b?.Items;
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => ((x as { item?: unknown; Item?: unknown })?.item ?? (x as { Item?: unknown })?.Item ?? x))
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
}

async function rakutenSearch(query: string, shopCode?: string): Promise<ShopOfferCandidate[] | null> {
  const params = new URLSearchParams({
    applicationId: readShopConfig('RAKUTEN_APPLICATION_ID'),
    keyword: query,
    hits: String(RAKUTEN_HITS),
    availability: '1',
    formatVersion: '2',
    imageFlag: '0',
  });
  if (shopCode) params.set('shopCode', shopCode);
  const body = await getJson(
    `${RAKUTEN_ENDPOINT}?${params}`,
    rakutenHeaders(),
    'Rakuten item search',
    'rakuten_api'
  );
  if (body === null) return null;
  const offers: ShopOfferCandidate[] = [];
  for (const item of rakutenItems(body)) {
    const url = str(item.itemUrl);
    if (shopOfUrl(url) !== 'rakuten' || item.availability === 0) continue;
    offers.push({
      shopId: 'rakuten',
      shop: isRakuten24(url) ? '楽天24' : str(item.shopName),
      brand: '',
      productName: str(item.itemName),
      priceYen: item.itemPrice,
      // taxFlag 0: 税込、1: 税別
      taxIncluded: item.taxFlag === 0 ? true : item.taxFlag === 1 ? false : null,
      sourceUrl: url,
    });
  }
  return offers;
}

/**
 * 楽天市場の商品検索 API。楽天市場全体と楽天24（shopCode=rakuten24）を調べる。
 * 同じアプリ ID の呼び出しは1秒に1回までなので、間をあけて順番に呼ぶ
 */
export async function rakutenOffers(query: string): Promise<ShopOfferCandidate[] | null | undefined> {
  if (!isRakutenApiConfigured()) return undefined;
  // 楽天の語の決まり（1文字のかな・半角の語は 400 になる）。送れる語が無ければ探さない
  const keyword = toRakutenKeyword(query);
  if (!keyword) return [];
  const all = await rakutenSearch(keyword);
  await wait(API_INTERVAL_MS);
  const r24 = await rakutenSearch(keyword, 'rakuten24');
  if (all === null && r24 === null) return null;
  return [...(r24 ?? []), ...(all ?? [])];
}

// ---------- Yahoo!ショッピング ----------

export async function yahooOffers(query: string): Promise<ShopOfferCandidate[] | null | undefined> {
  if (!isYahooApiConfigured()) return undefined;
  const params = new URLSearchParams({
    appid: readShopConfig('YAHOO_CLIENT_ID'),
    query,
    results: String(YAHOO_RESULTS),
    in_stock: 'true',
    condition: 'new',
    sort: '-score',
  });
  const body = await getJson(`${YAHOO_ENDPOINT}?${params}`, {}, 'Yahoo item search', 'yahoo_api');
  if (body === null) return null;
  const hits = (body as { hits?: unknown })?.hits;
  if (!Array.isArray(hits)) return [];
  const offers: ShopOfferCandidate[] = [];
  for (const raw of hits) {
    if (!raw || typeof raw !== 'object') continue;
    const hit = raw as Record<string, unknown>;
    const url = str(hit.url);
    if (shopOfUrl(url) !== 'yahoo' || hit.inStock === false || hit.condition === 'used') continue;
    const label = hit.priceLabel as { taxable?: unknown } | undefined;
    const price = hit.price;
    const taxExclude = hit.taxExcludePrice;
    // taxable は「税込み価格かどうか」。無ければ、税抜価格が別にあり価格より安いときは税込とみなす
    const taxIncluded =
      typeof label?.taxable === 'boolean'
        ? label.taxable
        : typeof price === 'number' && typeof taxExclude === 'number' && taxExclude < price
          ? true
          : null;
    offers.push({
      shopId: 'yahoo',
      shop: str((hit.seller as { name?: unknown } | undefined)?.name),
      brand: str((hit.brand as { name?: unknown } | undefined)?.name),
      productName: str(hit.name),
      priceYen: price,
      taxIncluded,
      sourceUrl: url,
    });
  }
  return offers;
}

// ---------- ブランドの製品一覧（入力途中の候補。docs/walkthroughs/2026-10-15-shop-lineups.md） ----------

/** お店の API の商品（名前は API が返したまま。楽天の規約で、取得した商品情報は改変しない） */
export interface ShopItem {
  shopId: 'rakuten' | 'yahoo';
  /** お店の商品コード（楽天 itemCode、Yahoo! code） */
  code: string;
  name: string;
  /** Yahoo! のブランド名（親ブランドを含む）。楽天には無い */
  brands: string[];
  /** Yahoo! の JAN コード */
  janCode?: string;
  url: string;
  /** 商品の写真（楽天 128×128、Yahoo! 146×146）。お店の画像サーバーの https の URL だけ */
  imageUrl?: string;
  /** 価格（円、API が返したまま）と、税込か（分からなければ null） */
  priceYen?: number;
  taxIncluded: boolean | null;
  /**
   * 商品説明。楽天は itemCaption、Yahoo! は description。成分を読むとき（caption: true）だけ取る。ブラウザには送らない。
   * 楽天の説明はその返答にだけ使い、保存しない（第10条 (9)）。Yahoo! の説明から読んだ成分は、自動の保存で保存する
   * （オーナーの判断 2026-10-26。src/lib/services/seeding.ts）
   */
  caption?: string;
}

/** 写真の URL：https で、楽天・Yahoo! の画像サーバーのものだけを使う（ほかのサイトを利用者のブラウザから読ませない） */
const SHOP_IMAGE_HOSTS: Record<ShopItem['shopId'], RegExp> = {
  rakuten: /(^|\.)rakuten\.co\.jp$/,
  yahoo: /(^|\.)yimg\.jp$/,
};

function shopImageUrl(raw: unknown, shopId: ShopItem['shopId']): string | undefined {
  try {
    const u = new URL(str(raw));
    const plain = u.protocol === 'https:' && !u.username && !u.password && !u.port;
    return plain && SHOP_IMAGE_HOSTS[shopId].test(u.hostname) ? u.href : undefined;
  } catch {
    return undefined;
  }
}

const yen = (v: unknown) => (Number.isSafeInteger(v) && (v as number) > 0 ? (v as number) : undefined);

const LINEUP_HITS = 30;

/** 商品説明の上限（文字数）。これより長い説明は先頭だけを読む */
const MAX_CAPTION_LENGTH = 20_000;

/**
 * 楽天の検索語の決まり：空白で区切った語はどれも、半角2文字以上か全角1文字以上。ただし、ひらがな・カタカナ・記号の語は
 * 2文字以上（1文字の語があると 400「keyword parameter is not valid」）。決まりに合わない語は外す
 * （「ラ ロッシュ ポゼ」は「ロッシュ ポゼ」で探す。2026-11-01 のログ）。全体は半角 128 文字まで
 */
export function toRakutenKeyword(keyword: string): string {
  const words = keyword.split(/\s+/).filter((w) => [...w].length >= 2 || /^\p{Script=Han}$/u.test(w));
  // 128 文字（半角）を超えるなら、後ろの語から外す（全角は2文字分）
  const width = (t: string) => [...t].reduce((n, c) => n + (c.charCodeAt(0) < 0x80 ? 1 : 2), 0);
  while (words.length > 1 && width(words.join(' ')) > 128) words.pop();
  const result = words.join(' ');
  return width(result) <= 128 ? result : '';
}

/**
 * 楽天市場の商品検索（https://webservice.rakuten.co.jp/documentation/ichiba-item-search）。
 * 検索語はブランド名（と、アプリが決めた種類の語）だけ（利用者が入力した文は送らない）。キー未設定なら undefined、失敗は null。
 * caption: 商品説明も取る（成分を読むときだけ）
 */
export async function rakutenItemSearch(
  keyword: string,
  { caption = false, genreId }: { caption?: boolean; genreId?: number } = {}
): Promise<ShopItem[] | null | undefined> {
  if (!isRakutenApiConfigured()) return undefined;
  const rakutenKeyword = toRakutenKeyword(keyword);
  // 楽天が受け付ける語が残らず、ジャンルも無ければ呼ばない（400 になる）。失敗ではなく「該当なし」
  if (!rakutenKeyword && !genreId) return [];
  const params = new URLSearchParams({
    applicationId: readShopConfig('RAKUTEN_APPLICATION_ID'),
    ...(rakutenKeyword && { keyword: rakutenKeyword }),
    hits: String(LINEUP_HITS),
    availability: '1',
    formatVersion: '2',
    // 必要な項目だけを返させる
    elements: `itemName,itemCode,itemUrl,availability,itemPrice,taxFlag,mediumImageUrls${caption ? ',itemCaption' : ''}`,
    // 種類のジャンル（代わりの商品探し。docs/plans/alternative-recommendations.md の step 2 で確かめた ID）
    ...(genreId && { genreId: String(genreId) }),
  });
  const body = await getJson(
    `${RAKUTEN_ENDPOINT}?${params}`,
    rakutenHeaders(),
    'Rakuten item search',
    'rakuten_api'
  );
  if (body === null) return null;
  const items: ShopItem[] = [];
  for (const item of rakutenItems(body)) {
    const url = str(item.itemUrl);
    const code = str(item.itemCode);
    const name = str(item.itemName);
    if (!code || !name || shopOfUrl(url) !== 'rakuten' || item.availability === 0) continue;
    // formatVersion=2 は URL の配列、1 は {imageUrl} の配列
    const images = Array.isArray(item.mediumImageUrls) ? item.mediumImageUrls : [];
    const first = images[0] as unknown;
    const imageUrl = shopImageUrl(typeof first === 'string' ? first : (first as { imageUrl?: unknown } | undefined)?.imageUrl, 'rakuten');
    items.push({
      shopId: 'rakuten',
      code,
      name,
      brands: [],
      url,
      ...(imageUrl && { imageUrl }),
      ...(yen(item.itemPrice) && { priceYen: yen(item.itemPrice) }),
      // taxFlag 0: 税込、1: 税別
      taxIncluded: item.taxFlag === 0 ? true : item.taxFlag === 1 ? false : null,
      ...(caption && str(item.itemCaption) && { caption: str(item.itemCaption).slice(0, MAX_CAPTION_LENGTH) }),
    });
  }
  return items;
}

/**
 * Yahoo!ショッピングの商品検索 v3（https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html）。
 * 検索語はブランド名だけ。キー未設定なら undefined、失敗は null
 */
export async function yahooItemSearch(
  query: string,
  { genreCategoryId, caption = false }: { genreCategoryId?: number; caption?: boolean } = {}
): Promise<ShopItem[] | null | undefined> {
  if (!isYahooApiConfigured()) return undefined;
  const params = new URLSearchParams({
    appid: readShopConfig('YAHOO_CLIENT_ID'),
    query,
    results: String(LINEUP_HITS),
    in_stock: 'true',
    condition: 'new',
    sort: '-score',
    ...(genreCategoryId && { genre_category_id: String(genreCategoryId) }),
  });
  const body = await getJson(`${YAHOO_ENDPOINT}?${params}`, {}, 'Yahoo item search', 'yahoo_api');
  if (body === null) return null;
  const hits = (body as { hits?: unknown })?.hits;
  if (!Array.isArray(hits)) return [];
  const items: ShopItem[] = [];
  for (const raw of hits) {
    if (!raw || typeof raw !== 'object') continue;
    const hit = raw as Record<string, unknown>;
    const url = str(hit.url);
    const code = str(hit.code);
    const name = str(hit.name);
    if (!code || !name || shopOfUrl(url) !== 'yahoo' || hit.inStock === false || hit.condition === 'used') continue;
    const brandNames = [hit.brand, ...(Array.isArray(hit.parentBrands) ? hit.parentBrands : [])]
      .map((b) => str((b as { name?: unknown } | undefined)?.name))
      .filter(Boolean);
    const jan = str(hit.janCode);
    const imageUrl = shopImageUrl((hit.image as { medium?: unknown } | undefined)?.medium, 'yahoo');
    const taxable = (hit.priceLabel as { taxable?: unknown } | undefined)?.taxable;
    items.push({
      shopId: 'yahoo',
      code,
      name,
      brands: brandNames,
      ...(/^[0-9]{8,14}$/.test(jan) && { janCode: jan }),
      url,
      ...(imageUrl && { imageUrl }),
      ...(yen(hit.price) && { priceYen: yen(hit.price) }),
      taxIncluded: typeof taxable === 'boolean' ? taxable : null,
      ...(caption && str(hit.description) && { caption: str(hit.description).slice(0, MAX_CAPTION_LENGTH) }),
    });
  }
  return items;
}
