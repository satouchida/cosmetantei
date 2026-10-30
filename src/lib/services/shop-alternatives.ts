import 'server-only';
import { CulpritIngredient, PriceApiCredit, Product } from '../types';
import { COSMETICS_DATABASE, isShareable } from '../data/cosmetics-db';
import { alternativeGate } from '../analyzer/ingredient-analyzer';
import { AlternativeCategory, CATEGORY_LABELS_JA, categoryFromText } from '../analyzer/product-category';
import { CATEGORY_SYNONYMS, searchKey } from '../search/product-match';
import { buildBrandIndex, IndexedBrand, textHasBrand } from './brand-suggest';
import { NOT_SINGLE_ITEM } from './price-service';
import { findSavedByBarcode, lookupByBarcode } from './search-barcode-service';
import { isRakutenApiConfigured, isYahooApiConfigured, rakutenItemSearch, ShopItem, yahooItemSearch } from './shop-apis';
import { ingredientsFromCaption, shopListingProduct } from './shop-ingredients';
import { withoutListingNoise } from '../search/listing-name';
import { shopLink } from './shops';

/**
 * 代わりの商品を、楽天市場・Yahoo!ショッピングの商品検索から探す（docs/plans/alternative-recommendations.md の step 3）
 * - 検索語は種類の名前と決まった語（「無香料」「ノンケミカル」など）だけ。利用者が入力した文・成分表示は送らない。
 *   種類はお店のジャンル（step 2 で確かめた ID）でも絞る
 * - 成分は安い順に確かめる：
 *   1. Yahoo! の JAN コードで、保存済みの確かめた製品（費用なし）
 *   2. 楽天の商品説明の全成分（shop-ingredients.ts。その返答にだけ使う。楽天の規約 第10条 (9)）
 *   3. まだ確かめられない上位の Yahoo! の商品だけ、JAN コードで製品を調べる（Open Beauty Facts、無ければ Web。
 *      有料の調べものは1回の要求の予算の範囲で。見つけた製品は今までどおり保存される）
 * - 確かめるのは今までと同じ（含まない・強い刺激成分を含まない・同じ種類）。お店の説明から読んだ一覧は、
 *   8割以上の成分を評価できたものだけ（読めない名前が多い一覧は「原因成分フリー」の根拠にならない）
 * - 結果は保存しない（共有のキャッシュに入れない）。商品名は API が返したまま。リンクはアフィリエイトのリンク
 */

/** 種類ごとのお店のジャンル（2026-10-18 に確かめた、結果の多い ID） */
const GENRES: Record<AlternativeCategory, { rakuten: number; yahoo: number }> = {
  sunscreen: { rakuten: 503054, yahoo: 46427 },
  toner: { rakuten: 216307, yahoo: 1764 },
  serum: { rakuten: 216348, yahoo: 1769 },
  cream: { rakuten: 216424, yahoo: 1753 },
  cleanser: { rakuten: 405130, yahoo: 48903 },
  mask: { rakuten: 503020, yahoo: 1767 },
  lip: { rakuten: 405206, yahoo: 5005 },
};

/** 確かめる候補の数の上限（お店の商品の数） */
const MAX_CANDIDATES = 30;
/** JAN コードで製品を調べる（有料のことがある）候補の数 */
const MAX_BARCODE_LOOKUPS = 2;
/** お店の説明から読んだ一覧で、評価できた成分の割合の下限 */
const MIN_RATED_SHARE = 0.8;

export interface ShopAlternativeInput {
  category: AlternativeCategory;
  avoid: (CulpritIngredient | { nameJa: string; nameEn?: string })[];
  /** 検索語に足す決まった語（「無香料」「アルコールフリー」「ノンケミカル」など） */
  terms: string[];
  /** 勧めない製品（分析した製品・肌荒れしたコスメ） */
  exclude: (Pick<Product, 'id' | 'name'> & Partial<Pick<Product, 'barcode'>>)[];
  limit: number;
  /**
   * 足りないときに JAN コードで製品を調べてよいか（有料のことがある）。サーバーが持っている製品から探すときだけ。
   * ブラウザから送られただけの製品（入力した成分表示・お店の説明から読んだ製品）では調べない
   */
  allowPaidLookups?: boolean;
}

export interface ShopAlternativeResult {
  /** unavailable: お店のキーが無い・両方のお店の検索が失敗した（呼び出し側は Web で探す） */
  status: 'ok' | 'unavailable';
  products: Product[];
  /** 表示するクレジット（使った API） */
  credits: PriceApiCredit[];
}

/** お店の商品のブランド名（Yahoo! はブランドの欄、楽天は商品名にある一覧のブランド） */
function brandOf(item: ShopItem, brands: IndexedBrand[]): string {
  return item.brands[0] ?? brands.find((b) => textHasBrand(item.name, b))?.entry.name ?? '';
}

/** 表示用に、お店の写真・価格・リンクを付ける（その返答にだけ使う。保存しない） */
function withShopInfo(product: Product, item: ShopItem): Product {
  const link = shopLink(item.shopId, item.url);
  return {
    ...product,
    ...(!product.imageUrl && item.imageUrl && { imageUrl: item.imageUrl }),
    ...(item.priceYen && { shopPrice: { yen: item.priceYen, taxIncluded: item.taxIncluded } }),
    // 楽天の商品ページへのリンクは、楽天アフィリエイトのリンクのときだけ
    ...((item.shopId !== 'rakuten' || link.sponsored) && { shopLink: link }),
  };
}

/** 容量・枚数（「150ml」「5枚」）。同じ製品の容量違いを1つにする */
const SIZE = /\d+(?:\.\d+)?\s*(?:ml|g|kg|l|枚|個|本)/gi;
/** 種類の語（「化粧水」「UV」など）。製品の系列のキーから外す */
const CATEGORY_KEYS = Object.values(CATEGORY_SYNONYMS)
  .flat()
  .map(searchKey)
  .filter((w) => w.length > 0)
  .sort((a, b) => b.length - a.length);
/** 調べる製品の時間の上限（JAN コードでの調べもの。超えたら、その製品は使わない） */
const LOOKUP_DEADLINE_MS = 15_000;

/** JAN コードの比べ方（先頭の 0 の数をそろえる） */
const normalJan = (code: string | undefined): string => (code ? code.replace(/\D/g, '').replace(/^0+/, '') : '');

/** 製品の系列のキー（飾り・容量・種類の語を外す。「化粧水」だけの名前が、すべての化粧水に合わないように） */
function seriesKey(name: string): string {
  let key = searchKey(withoutListingNoise(name).replace(SIZE, ''));
  for (const w of CATEGORY_KEYS) key = key.split(w).join('');
  return key;
}

/** JAN コードで見つけた製品が、お店の商品と同じものか（出品者の書いた JAN コードは間違えていることがある） */
function sameListing(product: Pick<Product, 'name'>, item: ShopItem): boolean {
  const itemKey = seriesKey(item.name);
  const nameKey = seriesKey(product.name);
  return nameKey.length >= 3 && itemKey.length >= 3 && (itemKey.includes(nameKey) || nameKey.includes(itemKey));
}

function withDeadline<T>(promise: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), LOOKUP_DEADLINE_MS);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export async function findShopAlternatives(input: ShopAlternativeInput): Promise<ShopAlternativeResult> {
  if (!isRakutenApiConfigured() && !isYahooApiConfigured()) return { status: 'unavailable', products: [], credits: [] };
  const genre = GENRES[input.category];
  // お店に送るのは種類の名前と決まった語だけ
  const keyword = [CATEGORY_LABELS_JA[input.category], ...input.terms].join(' ');
  const [rakuten, yahoo] = await Promise.all([
    rakutenItemSearch(keyword, { caption: true, genreId: genre.rakuten }),
    yahooItemSearch(keyword, { genreCategoryId: genre.yahoo }),
  ]);
  if (!rakuten && !yahoo) return { status: 'unavailable', products: [], credits: [] };

  const brands = buildBrandIndex(COSMETICS_DATABASE);
  const excludedKeys = input.exclude.map((p) => seriesKey(p.name)).filter((k) => k.length >= 4);
  const excludedJans = new Set(input.exclude.map((p) => normalJan(p.barcode)).filter(Boolean));
  // 楽天と Yahoo! を交互に並べる（どちらかのお店だけで埋まらないように）
  const items: ShopItem[] = [];
  for (let i = 0; i < Math.max(rakuten?.length ?? 0, yahoo?.length ?? 0); i++) {
    for (const item of [rakuten?.[i], yahoo?.[i]]) {
      if (!item) continue;
      const name = withoutListingNoise(item.name);
      const jan = normalJan(item.janCode);
      if (NOT_SINGLE_ITEM.test(name)) continue;
      // 別の種類（ジャンルが広い・名前が別の種類を言う）と、勧めない製品（同じ製品・同じシリーズ）は除く
      const kind = categoryFromText(name);
      if (kind && kind !== input.category) continue;
      if (jan && excludedJans.has(jan)) continue;
      const series = seriesKey(item.name);
      if (series.length >= 4 && excludedKeys.some((k) => series.includes(k) || k.includes(series))) continue;
      items.push(item);
    }
  }

  const passes = alternativeGate(input.avoid);
  const excludeIds = new Set(input.exclude.map((p) => p.id));
  const ok = (p: Product) =>
    !excludeIds.has(p.id) &&
    !excludedJans.has(normalJan(p.barcode)) &&
    passes(p, { category: input.category, allowShopListing: true, minRatedShare: MIN_RATED_SHARE });
  const found: { product: Product; item: ShopItem }[] = [];
  // 同じ製品は1つだけ（別のお店・別の容量・先頭の 0 の違う JAN コード）。確かめた後で比べる
  // （確かめられない同じ製品の出品が先にあっても、確かめられる出品を落とさない）
  const listingKey = (item: ShopItem) => searchKey(withoutListingNoise(item.name).replace(SIZE, ''));
  const add = (product: Product, item: ShopItem) => {
    const list = product.ingredients.join('|');
    const key = listingKey(item);
    const jan = normalJan(item.janCode);
    const duplicate = found.some(
      (f) =>
        f.product.id === product.id ||
        f.product.ingredients.join('|') === list ||
        listingKey(f.item) === key ||
        (jan !== '' && normalJan(f.item.janCode) === jan)
    );
    if (!duplicate) found.push({ product, item });
  };
  const candidates = items.slice(0, MAX_CANDIDATES);
  // 1. 保存済みの確かめた製品（JAN コード）。KV はまとめて読む
  const savedList = await Promise.all(candidates.map((i) => (i.janCode ? findSavedByBarcode(i.janCode).catch(() => null) : null)));
  const unchecked: ShopItem[] = [];
  for (const [idx, item] of candidates.entries()) {
    if (found.length >= input.limit) break;
    const saved = savedList[idx];
    if (saved) {
      // 出品者の書いた JAN コードは間違えていることがある。保存済みの製品の名前と、お店の商品名が合うときだけ
      if (sameListing(saved, item) && ok(saved)) add(saved, item);
      continue;
    }
    // 2. 楽天の商品説明の全成分
    if (item.caption) {
      const label = await ingredientsFromCaption(item.caption);
      if (label) {
        const product = shopListingProduct(item, brandOf(item, brands), label);
        if (ok(product)) add(product, item);
        continue;
      }
    }
    if (item.janCode) unchecked.push(item);
  }
  // 3. まだ足りなければ、上位の JAN コードの商品を調べる（有料のことがある。必要な数だけ、並べて、時間の上限つき）。
  //    全員で共有してよい製品（信頼するサイト等）で、名前がお店の商品と合うものだけ
  const toLookup = input.allowPaidLookups
    ? unchecked.slice(0, Math.max(0, Math.min(MAX_BARCODE_LOOKUPS, input.limit - found.length)))
    : [];
  const looked = await Promise.all(toLookup.map((item) => withDeadline(lookupByBarcode(item.janCode!).catch(() => null))));
  looked.forEach((product, i) => {
    if (product && isShareable(product) && sameListing(product, toLookup[i]) && ok(product)) add(product, toLookup[i]);
  });

  const products = found.slice(0, input.limit).map(({ product, item }) => withShopInfo(product, item));
  const used = found.slice(0, input.limit).map(({ item }) => item.shopId);
  const credits: PriceApiCredit[] = (['rakuten', 'yahoo'] as const).filter((s) => used.includes(s));
  return { status: 'ok', products, credits };
}
