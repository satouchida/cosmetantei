import 'server-only';
import { Product } from '../types';
import {
  addProductToDynamicCache,
  COSMETICS_DATABASE,
  hydrateVerifiedProducts,
  isInVerifiedIndex,
  isSameSource,
  rememberVerifiedProducts,
  removeFromDynamicCache,
  VERIFIED_MAX_AGE_MS,
  verifiedIndexEntries,
} from '../data/cosmetics-db';
import { cacheGetJSON, cacheGetJSONStrict, cachePutJSON, cachePutJSONStrict, hasSharedCache } from '../server/cloudflare';
import { utcDay } from '../server/spend-cap-core';
import { currentRequestSpendMicros } from '../server/usage';
import { hasVerifiedIngredientList, namesProduct, searchOpenBeautyFacts } from './live-cosmetics-service';
import { searchKey } from '../search/product-match';
import { fetchObfProduct, linkBarcode } from './search-barcode-service';
import {
  matchingShopItems,
  productFromShopBarcodes,
  productFromYahooDescription,
  ShopMatches,
  yahooJanCodes,
} from './shop-ingredients';
import { yahooStore } from '../product-source';
import { productSearchQuery, refreshPageProduct, researchProducts, toProductSearchQuery } from './web-research';
import { REFRESH_PER_DAY } from './refresh-limits';

export { REFRESH_PER_DAY };

/**
 * 製品を1つ、成分を確かめた製品の一覧（KV。src/lib/data/cosmetics-db.ts）に入れる。毎日の予定の仕事が、
 * src/lib/data/seed-products.ts の製品ごとに呼ぶ（src/app/api/internal/seed/route.ts）。
 * 費用の少ない順に調べ、見つかったところでやめる：
 * 1. 保存済み（一覧にある）：何もしない
 * 2. Open Beauty Facts の検索（無料）
 * 3. お店の商品検索（楽天・Yahoo!、無料。1回だけ呼び、次の2つで使う）：
 *    a. 商品の JAN コード → Open Beauty Facts のバーコード（楽天の商品説明は JAN コードを読むだけで、保存しない）
 *    b. Yahoo! の商品説明の全成分（出品者の文。shop_yahoo として保存。オーナーの判断 2026-10-26）
 * 4. Web リサーチ（有料、約 $0.30）。1日 SEED_PAID_PER_DAY 回まで（調べ直しの REFRESH_PAID_PER_DAY 回とは別。KV で数える。秘密の値が漏れても増えない）。
 *    有料で調べても見つからなかった製品は、14日間は有料では調べない。
 *    回数は使う前に1回分を取り（費用がかからなかったら返す）、数えられないとき（KV が読めない・書けない・本番で
 *    KV が無い）は有料では調べない。KV に「比べて書く」が無いので、同時に呼ばれると1回分ずれることがある
 *    （呼ぶのは毎日の予定の仕事だけで、製品を1つずつ順に呼ぶ。全体の予算 $10/日・1回の要求 $0.30 も効く）
 * 新しく保存した製品には、Yahoo! の項目の JAN コード（容量違いなど最大3件）を結び付ける（バーコードの読み取りで費用なし）。
 * 全体の予算・1分の件数の上限（spend-cap.ts）はほかの呼び出しと同じに効く。
 * 一覧の製品は、入れた日から30日で捨てる（cosmetics-db の VERIFIED_MAX_AGE_MS）。Yahoo! の商品説明の製品も同じく
 * 30日まで、出典のリンクとクレジットを付けて出す（LINEヤフー共通利用規約 8.1・8.3。オーナーの判断 2026-10-31）。
 * 新しい成分表示は、毎日の調べ直し（refreshNextProduct）で期限の前に取り直す
 */

/**
 * 有料の調べもの（約 $0.30）をしてよい1日（UTC）の回数。自動の保存と毎日の調べ直しで別に数え、1回ずつ
 * （オーナーの判断 2026-11-01。先に動く自動の保存が、調べ直しの分を使い切らないように）
 */
export const SEED_PAID_PER_DAY = 1;
export const REFRESH_PAID_PER_DAY = 1;

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

interface PaidCounter {
  key: (now: number) => string;
  limit: number;
}
const SEED_PAID: PaidCounter = { key: (now) => `seed:paid:${utcDay(now)}`, limit: SEED_PAID_PER_DAY };
const REFRESH_PAID: PaidCounter = { key: (now) => `seed:refresh-paid:${utcDay(now)}`, limit: REFRESH_PAID_PER_DAY };
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

/**
 * 有料の調べものの1回分を、使う前に取る（途中で止まっても、使った分を数え忘れない）。取る前の回数を返す
 * （費用がかからなかったら、呼び出し側がこの値に戻す）。上限に達した・数えられないときは null（有料では調べない）。
 * 自動の保存（SEED_PAID）と毎日の調べ直し（REFRESH_PAID）で、別の回数を使う
 */
async function claimPaidSlot(counter: PaidCounter, now: number): Promise<number | null> {
  // 本番で KV が無いと、回数はアイソレートごとのメモリにしか残らず、上限にならない
  if (process.env.NODE_ENV === 'production' && !(await hasSharedCache())) return null;
  let used: number;
  try {
    used = (await cacheGetJSONStrict<number>(counter.key(now))) ?? 0;
  } catch (err) {
    console.error('Seed paid count unreadable; skipping paid research:', err instanceof Error ? err.message : err);
    return null;
  }
  if (used >= counter.limit) return null;
  try {
    await cachePutJSONStrict(counter.key(now), used + 1, PAID_COUNT_TTL_SECONDS);
  } catch (err) {
    console.error('Seed paid count not saved; skipping paid research:', err instanceof Error ? err.message : err);
    return null;
  }
  return used;
}

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

  await hydrateVerifiedProducts({ now });
  // 保存済みなら、一覧にあることだけ確かめる（このアイソレートのメモリにだけある製品もあるので。同じ内容なら書き込まない）。
  // お店には問い合わせない
  // 一覧（期限内）にある製品だけ。メモリにだけある製品・期限が切れた製品は、もう一度調べる（新しい成分表示を取る）
  const saved = match(COSMETICS_DATABASE.filter((p) => isInVerifiedIndex(p.id, now)));
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
  const used = await claimPaidSlot(SEED_PAID, now);
  if (used === null) return { result: 'paid_limit', paid: false };
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
  if (!paid) await cachePutJSON(SEED_PAID.key(now), used, PAID_COUNT_TTL_SECONDS);
  const fromWeb = match(researched);
  if (fromWeb) return done('web_research', fromWeb, paid);
  if (paid) await cachePutJSON(missKey(productQuery), true, PAID_MISS_TTL_SECONDS);
  return { result: 'not_found', paid };
}

// ---------- 毎日の調べ直し ----------

/** 一覧に入れてからこの日数を過ぎた製品を、古い順に調べ直す（期限の30日の前の7日） */
export const REFRESH_AFTER_MS = 23 * 24 * 60 * 60 * 1000;

/**
 * データ源にもう無かった製品（id → その時の savedAt）。期限まで調べ直さない。保存し直されて savedAt が変われば、また調べる。
 * 期限の過ぎた記録は、書くときに捨てる
 */
const GONE_KEY = 'seed:refresh:gone';
const GONE_TTL_SECONDS = 8 * 24 * 60 * 60;

/** その日に調べ直しを試した製品の id（同じ製品を1日に何度も試さない・1日の数を数える） */
const refreshedKey = (now: number) => `seed:refresh:${utcDay(now)}`;

export type RefreshResult = 'none' | 'changed' | 'unchanged' | 'gone' | 'failed' | 'paid_limit';

export interface RefreshOutcome {
  result: RefreshResult;
  paid: boolean;
  productId?: string;
}

/**
 * 製品を、保存したときと同じデータ源から取り直す（KV・メモリの結果のキャッシュは使わない）：
 * Open Beauty Facts はバーコードで、Yahoo! は商品検索で同じ商品を、Web のページは同じページを読み直す（有料）。
 * 取れた製品・null（データ源にもう無い）・undefined（一時的な失敗）・'paid_limit'
 */
async function fetchFromSameSource(
  stored: Product,
  now: number
): Promise<{ product: Product | null | undefined | 'paid_limit'; paid: boolean }> {
  switch (stored.ingredientSource) {
    case 'open_beauty_facts':
      return { product: stored.barcode ? await fetchObfProduct(stored.barcode) : null, paid: false };
    case 'shop_yahoo': {
      const query = productSearchQuery(stored);
      const store = stored.sourceUrl ? yahooStore(stored.sourceUrl) : null;
      if (!query || !store) return { product: null, paid: false };
      const matches = await matchingShopItems(query);
      if (!matches) return { product: undefined, paid: false };
      // 保存したときと同じストアの商品だけ（同じ JAN コードの、別のストアの説明では置き換えない）
      const sameStore = { ...matches, yahoo: matches.yahoo.filter((i) => yahooStore(i.url) === store) };
      return { product: await productFromYahooDescription(sameStore, stored.id), paid: false };
    }
    case 'web_page': {
      if (!stored.sourceUrl) return { product: null, paid: false };
      const used = await claimPaidSlot(REFRESH_PAID, now);
      if (used === null) return { product: 'paid_limit', paid: false };
      const before = currentRequestSpendMicros();
      let product: Product | null | undefined;
      try {
        product = await refreshPageProduct(stored);
      } catch (err) {
        console.error('Refresh page read failed:', err instanceof Error ? err.message : err);
        product = undefined;
      }
      const paid = currentRequestSpendMicros() > before;
      if (!paid) await cachePutJSON(REFRESH_PAID.key(now), used, PAID_COUNT_TTL_SECONDS);
      return { product, paid };
    }
    default:
      return { product: null, paid: false };
  }
}

/**
 * 一覧に入れてから REFRESH_AFTER_MS を過ぎた製品のうち、いちばん古いものを1つ調べ直す（毎日の予定の仕事が、
 * 自動の保存の後に REFRESH_PER_DAY 回まで呼ぶ。src/worker/seed-schedule.ts）。
 * 同じデータ源から取れたら、同じ id の成分表示を置き換えて savedAt を今にする（変わっていなくても期限を延ばす）。
 * 取れなければ何もしない（その製品は期限で捨てられる）。調べる製品が無い・その日の数に達したら 'none'
 */
export async function refreshNextProduct(now = Date.now()): Promise<RefreshOutcome> {
  // 呼び出しごとに別のアイソレートになりうるので、メモリの写し（60秒）ではなく KV を読む
  const tried = (await cacheGetJSON<string[]>(refreshedKey(now), { fresh: true })) ?? [];
  if (!Array.isArray(tried) || tried.length >= REFRESH_PER_DAY) return { result: 'none', paid: false };
  const goneRaw = await cacheGetJSON<Record<string, number>>(GONE_KEY, { fresh: true });
  const gone = goneRaw && typeof goneRaw === 'object' ? goneRaw : {};
  // 有料の回数が残っていない日は、Web のページの製品を飛ばす（無料で取り直せる製品の枠を使わない）
  const paidOpen = ((await cacheGetJSON<number>(REFRESH_PAID.key(now), { fresh: true })) ?? 0) < REFRESH_PAID.limit;
  const due = (await verifiedIndexEntries(now))
    .filter(
      (e) =>
        now - e.savedAt >= REFRESH_AFTER_MS &&
        !tried.includes(e.product.id) &&
        // 取り直せないと分かった版（同じ savedAt）は、期限まで調べ直さない（毎日の枠を使い続けない）
        gone[e.product.id] !== e.savedAt &&
        (e.product.ingredientSource !== 'web_page' || paidOpen)
    )
    .sort((a, b) => a.savedAt - b.savedAt);
  const next = due[0];
  if (!next) return { result: 'none', paid: false };
  const stored = next.product;
  // 調べる前に印を付ける（途中で止まっても、同じ日に同じ製品を何度も調べない）
  await cachePutJSON(refreshedKey(now), [...tried, stored.id], PAID_COUNT_TTL_SECONDS);

  let fetched: Awaited<ReturnType<typeof fetchFromSameSource>>;
  try {
    fetched = await fetchFromSameSource(stored, now);
  } catch (err) {
    console.error(`[verified-refresh] ${stored.id} failed:`, err instanceof Error ? err.message : err);
    return { result: 'failed', paid: false, productId: stored.id };
  }
  const { product, paid } = fetched;
  if (product === 'paid_limit') return { result: 'paid_limit', paid: false, productId: stored.id };
  if (product === undefined) return { result: 'failed', paid, productId: stored.id };
  // データ源にもう無い・別のデータ源の製品になった：置き換えず、期限で捨てる
  if (!product || !isSameSource(stored, product)) {
    const pruned = Object.fromEntries(Object.entries(gone).filter(([, savedAt]) => now - savedAt < VERIFIED_MAX_AGE_MS));
    await cachePutJSON(GONE_KEY, { ...pruned, [stored.id]: next.savedAt }, GONE_TTL_SECONDS);
    console.log(`[verified-refresh] ${stored.id} gone`);
    return { result: 'gone', paid, productId: stored.id };
  }
  const changed = !sameIngredientList(stored, product);
  // このアイソレートのメモリの古い成分表示も入れ替える（ほかのアイソレートは、savedAt が新しくなったことで入れ替える）
  removeFromDynamicCache(stored.id);
  addProductToDynamicCache(product);
  await rememberVerifiedProducts([product], { now, refresh: true });
  // 成分の中身はログに出さない（id と、変わったかだけ）
  console.log(`[verified-refresh] ${stored.id} ${changed ? 'changed' : 'unchanged'}`);
  return { result: changed ? 'changed' : 'unchanged', paid, productId: stored.id };
}

function sameIngredientList(a: Product, b: Product): boolean {
  const list = (p: Product) => [...p.ingredients, '|', ...(p.activeIngredientsJa ?? [])].join('\n');
  return list(a) === list(b);
}
