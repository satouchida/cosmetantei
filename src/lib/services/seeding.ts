import 'server-only';
import { Product } from '../types';
import { addProductToDynamicCache, COSMETICS_DATABASE, hydrateVerifiedProducts, rememberVerifiedProducts } from '../data/cosmetics-db';
import { cacheGetJSON, cacheGetJSONStrict, cachePutJSON, cachePutJSONStrict, hasSharedCache } from '../server/cloudflare';
import { utcDay } from '../server/spend-cap-core';
import { currentRequestSpendMicros } from '../server/usage';
import { hasVerifiedIngredientList, namesProduct, searchOpenBeautyFacts } from './live-cosmetics-service';
import { searchKey } from '../search/product-match';
import { linkBarcode } from './search-barcode-service';
import {
  matchingShopItems,
  productFromShopBarcodes,
  productFromYahooDescription,
  ShopMatches,
  yahooJanCodes,
} from './shop-ingredients';
import { researchProducts, toProductSearchQuery } from './web-research';

/**
 * 製品を1つ、成分を確かめた製品の一覧（KV。src/lib/data/cosmetics-db.ts）に入れる。毎日の予定の仕事が、
 * src/lib/data/seed-products.ts の製品ごとに呼ぶ（src/app/api/internal/seed/route.ts）。
 * 費用の少ない順に調べ、見つかったところでやめる：
 * 1. 保存済み（一覧にある）：何もしない
 * 2. Open Beauty Facts の検索（無料）
 * 3. お店の商品検索（楽天・Yahoo!、無料。1回だけ呼び、次の2つで使う）：
 *    a. 商品の JAN コード → Open Beauty Facts のバーコード（楽天の商品説明は JAN コードを読むだけで、保存しない）
 *    b. Yahoo! の商品説明の全成分（出品者の文。shop_yahoo として保存。オーナーの判断 2026-10-26）
 * 4. Web リサーチ（有料、約 $0.30）。全体で1日 SEED_PAID_PER_DAY 回まで（KV で数える。秘密の値が漏れても増えない）。
 *    有料で調べても見つからなかった製品は、14日間は有料では調べない。
 *    回数は使う前に1回分を取り（費用がかからなかったら返す）、数えられないとき（KV が読めない・書けない・本番で
 *    KV が無い）は有料では調べない。KV に「比べて書く」が無いので、同時に呼ばれると1回分ずれることがある
 *    （呼ぶのは毎日の予定の仕事だけで、製品を1つずつ順に呼ぶ。全体の予算 $10/日・1回の要求 $0.30 も効く）
 * 新しく保存した製品には、Yahoo! の項目の JAN コード（容量違いなど最大3件）を結び付ける（バーコードの読み取りで費用なし）。
 * 全体の予算・1分の件数の上限（spend-cap.ts）はほかの呼び出しと同じに効く
 */

/** 自動の保存で、有料の Web リサーチをしてよい1日（UTC）の回数 */
export const SEED_PAID_PER_DAY = 3;

export type SeedResult =
  | 'cached'
  | 'open_beauty_facts'
  | 'shop_barcode'
  | 'yahoo_listing'
  | 'web_research'
  | 'not_found'
  | 'paid_limit'
  | 'invalid';

export interface SeedOutcome {
  result: SeedResult;
  /** 有料の Web リサーチをしたか */
  paid: boolean;
  productId?: string;
}

const paidKey = (now: number) => `seed:paid:${utcDay(now)}`;
/** 回数の記録は、その日が終わってから少し残せば足りる */
const PAID_COUNT_TTL_SECONDS = 2 * 24 * 60 * 60;
/**
 * 有料で調べても見つからなかった製品は、しばらく有料では調べない（毎日の有料の回数を、見つからない製品で使い切らない。
 * 無料の段は毎日調べる）
 */
const missKey = (productQuery: string) => `seed:miss:${searchKey(productQuery)}`;
const PAID_MISS_TTL_SECONDS = 14 * 24 * 60 * 60;
/** 調べものが例外で終わった製品も、少しの間は有料では調べない（毎日の回数を、失敗し続ける製品で使い切らない） */
const PAID_ERROR_TTL_SECONDS = 2 * 24 * 60 * 60;

export async function seedProduct(query: string, now = Date.now()): Promise<SeedOutcome> {
  const productQuery = toProductSearchQuery(query);
  if (!productQuery) return { result: 'invalid', paid: false };
  const match = (products: readonly Product[]) =>
    products.find((p) => hasVerifiedIngredientList(p) && namesProduct(p, productQuery));
  // お店の商品検索は1回だけ（JAN コード・Yahoo! の説明・JAN コードの結び付けで使う）。失敗しても次の段へ進む
  let shopMatches: Promise<ShopMatches | null> | undefined;
  const shops = () =>
    (shopMatches ??= matchingShopItems(productQuery).catch((err) => {
      console.error('Seed shop lookup failed:', err instanceof Error ? err.message : err);
      return null;
    }));
  // 見つけた製品は一覧に入れ（すでに同じ内容なら書き込まない）、Yahoo! の JAN コードを結び付ける
  const done = async (result: SeedResult, found: Product, paid = false): Promise<SeedOutcome> => {
    // このアイソレートの検索にもすぐ出す（一覧は、ほかのアイソレートでは5分ごとに読み直される）
    const product = addProductToDynamicCache(found);
    await rememberVerifiedProducts([product]);
    const matches = await shops();
    for (const jan of matches ? yahooJanCodes(matches, product) : []) await linkBarcode(jan, product);
    return { result, paid, productId: product.id };
  };

  await hydrateVerifiedProducts();
  // 保存済みなら、一覧にあることだけ確かめる（このアイソレートのメモリにだけある製品もあるので。同じ内容なら書き込まない）。
  // お店には問い合わせない
  const saved = match(COSMETICS_DATABASE);
  if (saved && saved.ingredientSource !== 'shop_yahoo') {
    await rememberVerifiedProducts([saved]);
    return { result: 'cached', paid: false, productId: saved.id };
  }

  // Yahoo! の商品説明（出品者の文）で保存した製品は、毎日 Open Beauty Facts（無料）だけ調べ直し、見つかれば置き換える。
  // 有料の調べものはしない
  const fromObf = match((await searchOpenBeautyFacts(productQuery, 6)).filter((p) => p.ingredientSource !== 'shop_yahoo'));
  if (fromObf) return done('open_beauty_facts', fromObf);
  if (saved) {
    await rememberVerifiedProducts([saved]);
    return { result: 'cached', paid: false, productId: saved.id };
  }

  const matches = await shops();
  if (matches) {
    const fromBarcode = await productFromShopBarcodes(matches);
    if (fromBarcode) return done('shop_barcode', fromBarcode);
    const fromYahoo = await productFromYahooDescription(matches);
    if (fromYahoo) return done('yahoo_listing', fromYahoo);
  }

  if (await cacheGetJSON<boolean>(missKey(productQuery))) return { result: 'not_found', paid: false };
  // 本番で KV が無いと、回数はアイソレートごとのメモリにしか残らず、上限にならない
  if (process.env.NODE_ENV === 'production' && !(await hasSharedCache())) return { result: 'paid_limit', paid: false };
  let used: number;
  try {
    used = (await cacheGetJSONStrict<number>(paidKey(now))) ?? 0;
  } catch (err) {
    console.error('Seed paid count unreadable; skipping paid research:', err instanceof Error ? err.message : err);
    return { result: 'paid_limit', paid: false };
  }
  if (used >= SEED_PAID_PER_DAY) return { result: 'paid_limit', paid: false };
  // 使う前に1回分を取る（途中で止まっても、使った分を数え忘れない）。書けなければ有料では調べない
  try {
    await cachePutJSONStrict(paidKey(now), used + 1, PAID_COUNT_TTL_SECONDS);
  } catch (err) {
    console.error('Seed paid count not saved; skipping paid research:', err instanceof Error ? err.message : err);
    return { result: 'paid_limit', paid: false };
  }
  const before = currentRequestSpendMicros();
  let researched: Product[];
  try {
    researched = await researchProducts(productQuery, 4);
  } catch (err) {
    // 費用がかかったかもしれないので、取った1回分は返さない
    console.error('Seed research failed:', err instanceof Error ? err.message : err);
    await cachePutJSON(missKey(productQuery), true, PAID_ERROR_TTL_SECONDS);
    return { result: 'not_found', paid: true };
  }
  // 前の調べもののキャッシュから返った・Gemini の設定が無いときは費用がかからないので、取った1回分を返す
  const paid = currentRequestSpendMicros() > before;
  if (!paid) await cachePutJSON(paidKey(now), used, PAID_COUNT_TTL_SECONDS);
  const fromWeb = match(researched);
  if (fromWeb) return done('web_research', fromWeb, paid);
  if (paid) await cachePutJSON(missKey(productQuery), true, PAID_MISS_TTL_SECONDS);
  return { result: 'not_found', paid };
}
