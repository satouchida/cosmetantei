import 'server-only';
import { isRakuten24, readShopConfig, ShopId, shopOfUrl } from './shops';

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

/** 同じアプリ ID の呼び出しの間隔（楽天・Yahoo! とも 1秒に1回まで） */
const API_INTERVAL_MS = 1_100;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url: string, headers: Record<string, string>, label: string, retried = false): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    // 回数の上限に当たったら、1回だけ間をおいてやり直す（他の利用者と同じアプリ ID を使うため）
    if (res.status === 429 && !retried) {
      await wait(API_INTERVAL_MS);
      return getJson(url, headers, label, true);
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
    { accessKey: readShopConfig('RAKUTEN_ACCESS_KEY') },
    'Rakuten item search'
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
  const body = await getJson(`${YAHOO_ENDPOINT}?${params}`, {}, 'Yahoo item search');
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
