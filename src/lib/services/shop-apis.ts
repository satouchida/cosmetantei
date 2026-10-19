import 'server-only';
import { isRakuten24, readShopConfig, ShopId, shopOfUrl } from './shops';
import { reserveSpend } from '../server/spend-cap';

/**
 * お店の公式 API で価格を調べる（楽天市場・Yahoo!ショッピング）。手順: docs/plans/shop-prices.md
 * - キーが設定されたお店だけ。未設定なら undefined（呼び出し側は商品ページの読み取りで代わりに調べる）
 * - 失敗（通信・429・形式違い）は null。「価格が無い」とは区別する
 * - 結果は保存しない。キーはログ・エラーに出さない
 */

export interface ShopOfferCandidate {
  shopId: ShopId;
  /** 販売している店（楽天・Yahoo! の出店者、または @cosme SHOPPING） */
  shop: string;
  brand: string;
  productName: string;
  priceYen: unknown;
  taxIncluded: boolean | null;
  /** 商品ページ（対象のお店の URL と確かめ済み） */
  sourceUrl: string;
  via: 'api' | 'page';
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
      await wait(API_INTERVAL_MS);
      return getJson(url, headers, label, api, true);
    }
    if (!res.ok) {
      // 404 は「該当なし」（楽天）
      if (res.status === 404) return {};
      console.error(`${label} failed: ${res.status}`);
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
      via: 'api',
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
  const all = await rakutenSearch(query);
  await wait(API_INTERVAL_MS);
  const r24 = await rakutenSearch(query, 'rakuten24');
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
      via: 'api',
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
   * 楽天の商品説明（itemCaption）。成分を読むとき（caption: true）だけ取る。その返答にだけ使い、保存しない
   * （第10条 (9)）。ブラウザには送らない
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
 * 楽天市場の商品検索（https://webservice.rakuten.co.jp/documentation/ichiba-item-search）。
 * 検索語はブランド名（と、アプリが決めた種類の語）だけ（利用者が入力した文は送らない）。キー未設定なら undefined、失敗は null。
 * caption: 商品説明も取る（成分を読むときだけ）
 */
export async function rakutenItemSearch(
  keyword: string,
  { caption = false }: { caption?: boolean } = {}
): Promise<ShopItem[] | null | undefined> {
  if (!isRakutenApiConfigured()) return undefined;
  const params = new URLSearchParams({
    applicationId: readShopConfig('RAKUTEN_APPLICATION_ID'),
    keyword,
    hits: String(LINEUP_HITS),
    availability: '1',
    formatVersion: '2',
    // 必要な項目だけを返させる
    elements: `itemName,itemCode,itemUrl,availability,itemPrice,taxFlag,mediumImageUrls${caption ? ',itemCaption' : ''}`,
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
export async function yahooItemSearch(query: string): Promise<ShopItem[] | null | undefined> {
  if (!isYahooApiConfigured()) return undefined;
  const params = new URLSearchParams({
    appid: readShopConfig('YAHOO_CLIENT_ID'),
    query,
    results: String(LINEUP_HITS),
    in_stock: 'true',
    condition: 'new',
    sort: '-score',
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
    });
  }
  return items;
}
