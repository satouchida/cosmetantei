import { Product } from '../types';
import { isShopListingProduct, isUserLabelProduct, yahooStore } from '../product-source';
import { buildAmazonAffiliateUrl } from '../services/amazon-affiliate';
import { cacheGetJSON, cacheGetJSONStrict, cachePutJSON } from '../server/cloudflare';
import { hasStaleLabel } from '../analyzer/label-parser';
import { mayShareWebProduct } from './trusted-sites';

/**
 * 【動的コスメキャッシュ】
 * Open Beauty Facts API や Google検索グラウンディングから取得した実在商品のみを保持します。
 * 架空の商品・ベースライン商品は持ちません。
 * Cloudflare Workers ではアイソレート単位のメモリのため、上限件数を設けて古いものから破棄します。
 */
const MAX_CACHED_PRODUCTS = 500;

const RUNTIME_CACHE: Product[] = [];

export const COSMETICS_DATABASE: Product[] = RUNTIME_CACHE;

/** 成分表示が実在データ源（Open Beauty Facts・ユーザー入力・出典ページ）由来の製品か */
export function isVerifiedSource(p: Product): boolean {
  return (
    p.ingredientSource === 'open_beauty_facts' ||
    p.ingredientSource === 'user_label' ||
    p.ingredientSource === 'web_page'
  );
}

/**
 * 成分を確かめた製品の一覧（KV）に保存し、保存済みの製品として使ってよいデータ源か：確認済みのデータ源と、
 * Yahoo!ショッピングの商品説明（自動の保存で作る。shop_yahoo）。代わりの商品のおすすめに使えるかは別
 * （ingredient-analyzer の hasVerifiedIngredients は確認済みのデータ源だけ）
 */
export function isStoredSource(p: Product): boolean {
  return isVerifiedSource(p) || p.ingredientSource === 'shop_yahoo';
}

/**
 * 共有のキャッシュ・KV に入れてよい製品か。ユーザーが入力した成分表示は、その人だけのもので確認もされていないため入れない
 * （他の人の検索結果・代替品候補にしない）。Web のページの製品は、TRUSTED_SITES_MODE=enforce のとき
 * 信頼するサイトのものだけ（src/lib/data/trusted-sites.ts）。サーバーの持つ製品として使うか（client-products.ts）も、これで決まる
 */
export function isShareable(p: Product): boolean {
  return !isUserLabelProduct(p) && !isShopListingProduct(p) && mayShareWebProduct(p);
}

/**
 * 外部APIやGoogle検索で取得した商品情報を動的キャッシュに追加・更新
 */
/** 成分表示（全成分・有効成分）の中身が違うか */
function hasDifferentIngredients(a: Product, b: Product): boolean {
  const list = (p: Product) => [...p.ingredients, '|', ...(p.activeIngredientsJa ?? [])].join('\n');
  return list(a) !== list(b);
}

/**
 * next は prev の英語の成分表示を日本語に訳したものか（訳は後から有料で作る。訳した版は置き換えてよい）。
 * 訳した版は元の英語を ingredientsEn に持つ（src/lib/services/ingredient-translate.ts）
 */
function isTranslationOf(prev: Product, next: Product): boolean {
  return (
    !!next.ingredientsEn &&
    !prev.ingredientsEn &&
    next.ingredientsEn.length === prev.ingredients.length &&
    next.ingredientsEn.every((name, i) => name === prev.ingredients[i])
  );
}

/** 確認済みの成分表示を、この内容で置き換えてはいけないか（同じ id で、訳ではない別の内容） */
function isRejectedReplacement(prev: Product, next: Product): boolean {
  return prev.id === next.id && hasDifferentIngredients(prev, next) && !isTranslationOf(prev, next);
}

/** 同じ製品とみなす（id・バーコード・商品名とブランドのどれかが同じ） */
function isSameProduct(a: Product, b: Product): boolean {
  return a.id === b.id || (!!b.barcode && a.barcode === b.barcode) || (a.name === b.name && a.brand === b.brand);
}

/**
 * Web のページの製品（ページに書かれたバーコード・商品名で照合される）が、別の id の Open Beauty Facts の製品を
 * 置き換えようとしているか。置き換えない（ページの作者が、バーコードの読み取りで出る製品を差し替えられないように）
 */
function isWeakerDuplicate(prev: Product, next: Product): boolean {
  return prev.id !== next.id && prev.ingredientSource === 'open_beauty_facts' && next.ingredientSource === 'web_page';
}

export function addProductToDynamicCache(product: Product): Product {
  if (!isShareable(product)) return product;
  const existingIdx = RUNTIME_CACHE.findIndex((p) => isSameProduct(p, product));

  const enrichedProduct: Product = {
    ...product,
    amazonSearchUrl: product.amazonSearchUrl || buildAmazonAffiliateUrl(product.brand, product.name),
  };

  // 最初に当たった製品だけでなく、当たる製品すべてで確かめる（同じ名前のお店の製品が先に当たっても、
  // 同じバーコードの Open Beauty Facts の製品を Web のページの製品で隠さない）
  const stronger = RUNTIME_CACHE.find((p) => isSameProduct(p, product) && isWeakerDuplicate(p, enrichedProduct));
  if (stronger) return stronger;

  if (existingIdx >= 0) {
    const existing = RUNTIME_CACHE[existingIdx];
    // 確認済みの成分データを AI 推定で上書きしない。保存したお店の説明（Yahoo!）も、保存しない製品では上書きしない
    // （確認済みの製品での置き換えは受け付ける）
    if (isVerifiedSource(existing) && !isVerifiedSource(enrichedProduct)) {
      return existing;
    }
    if (isStoredSource(existing) && !isStoredSource(enrichedProduct)) {
      return existing;
    }
    // 同じ製品（同じページから作った同じ id）の確認済みの成分データを、別の内容で置き換えない
    // （検索語の細工で同じページを読み違えさせ、全員の分析を変えさせない）
    if (isVerifiedSource(existing) && isRejectedReplacement(existing, enrichedProduct)) {
      return existing;
    }
    RUNTIME_CACHE.splice(existingIdx, 1);
  }
  RUNTIME_CACHE.unshift(enrichedProduct);
  if (RUNTIME_CACHE.length > MAX_CACHED_PRODUCTS) {
    RUNTIME_CACHE.length = MAX_CACHED_PRODUCTS;
  }

  return enrichedProduct;
}

/** メモリのキャッシュから製品を外す（保存の期限が切れた製品・調べ直して置き換える製品） */
export function removeFromDynamicCache(id: string): void {
  const idx = RUNTIME_CACHE.findIndex((p) => p.id === id);
  if (idx >= 0) RUNTIME_CACHE.splice(idx, 1);
}

// ---------- 成分確認済み製品の KV 永続化 ----------
// おすすめ代替品は成分確認済みの製品からのみ選ぶため、新しいアイソレートでも候補が空にならないよう KV に保存する

/**
 * v2: 製品ごとに一覧に入れた日時（savedAt）を持つ。v1（日時なし）は読まない（日時が分からない製品を新しいとみなすと、
 * プライバシーポリシーの「最長30日」を守れない。v1 のキーは書き込みが止まるので、30日で消える）
 */
const VERIFIED_INDEX_KEY = 'verified-products:v2';
const MAX_VERIFIED_PRODUCTS = 300;
/**
 * そのうち Open Beauty Facts の製品の上限。費用のかからない検索で誰でも足せるため、上限を超えたら古い OBF の製品から外す
 * （OBF の検索を繰り返して、有料で調べた製品・自動の保存の製品を一覧から押し出し、
 * 同じ id の別の内容での置き換えを断る仕組みを外させない）
 */
const MAX_OBF_IN_INDEX = 100;
const VERIFIED_TTL_SECONDS = 60 * 60 * 24 * 30;
/**
 * 一覧の製品を持つ期間（一覧に入れた日から。同じ製品を保存し直しても延びない）。過ぎた製品は読むとき・書くときに捨てる。
 * 新しい成分表示は、毎日の調べ直し（src/lib/services/seeding.ts の refreshNextProduct）で、期限の前に取り直す
 */
export const VERIFIED_MAX_AGE_MS = VERIFIED_TTL_SECONDS * 1000;
const HYDRATE_INTERVAL_MS = 5 * 60 * 1000;
let lastHydratedAt = 0;

export interface VerifiedEntry {
  product: Product;
  /** 一覧に入れた（調べ直して取り直した）日時（ミリ秒） */
  savedAt: number;
}

/** このアイソレートが知っている、一覧の製品の savedAt（期限が切れた製品をメモリのキャッシュから外すため） */
const savedAtById = new Map<string, number>();

const isExpired = (savedAt: number, now: number): boolean => !(now - savedAt < VERIFIED_MAX_AGE_MS);
/** アイソレートどうしの時計のずれ。これより先の日時は、壊れた値として捨てる（期限が来ない値を残さない） */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const isPlausibleSavedAt = (savedAt: number, now: number): boolean =>
  Number.isFinite(savedAt) && savedAt <= now + CLOCK_SKEW_MS && !isExpired(savedAt, now);

/** KV の値を読む。形の違う項目・期限が切れた項目は捨てる */
function liveEntries(raw: unknown, now: number): VerifiedEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is VerifiedEntry =>
      !!e &&
      typeof e === 'object' &&
      !!e.product &&
      typeof e.product.id === 'string' &&
      typeof e.savedAt === 'number' &&
      isPlausibleSavedAt(e.savedAt, now)
  );
}

/** 期限内の一覧（KV を直接読む。毎日の調べ直しが、古い順に選ぶのに使う） */
export async function verifiedIndexEntries(now = Date.now()): Promise<VerifiedEntry[]> {
  return liveEntries(await cacheGetJSON<unknown>(VERIFIED_INDEX_KEY, { fresh: true }), now);
}

/** 期限内の一覧にある製品か（このアイソレートが最後に読んだ・書いた一覧で） */
export function isInVerifiedIndex(id: string, now = Date.now()): boolean {
  const savedAt = savedAtById.get(id);
  return savedAt !== undefined && !isExpired(savedAt, now);
}

function hostOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * next は prev と同じデータ源から取り直したものか（毎日の調べ直しで、同じ id の成分表示を置き換えてよいか）：
 * 同じ id・同じ ingredientSource で、Open Beauty Facts なら同じバーコード、Web のページなら同じホスト
 * （共有してよいサイトのものだけ）、Yahoo! なら同じストア（id の JAN コードは出品者の値なので、別のストアの説明で
 * 置き換えさせない）
 */
export function isSameSource(prev: Product, next: Product): boolean {
  if (prev.id !== next.id || !prev.ingredientSource || prev.ingredientSource !== next.ingredientSource) return false;
  switch (next.ingredientSource) {
    case 'open_beauty_facts':
      return !!next.barcode && prev.barcode === next.barcode;
    case 'web_page': {
      const host = hostOf(next.sourceUrl);
      return !!host && host === hostOf(prev.sourceUrl) && mayShareWebProduct(next);
    }
    case 'shop_yahoo': {
      const store = next.sourceUrl ? yahooStore(next.sourceUrl) : null;
      return !!store && !!prev.sourceUrl && store === yahooStore(prev.sourceUrl);
    }
    default:
      return false;
  }
}

/**
 * 成分確認済みの製品を KV のインデックスに追記する（確認済みでない製品は無視）。
 * refresh: 毎日の調べ直し（サーバーが自分で、同じデータ源から取り直した製品）。同じ id の成分表示の置き換えを受け付け、
 * savedAt を今にする。利用者の検索・ブラウザから送られた製品では使わない
 */
export async function rememberVerifiedProducts(
  products: Product[],
  { now = Date.now(), refresh = false }: { now?: number; refresh?: boolean } = {}
): Promise<void> {
  const verified = products.filter((p) => isStoredSource(p) && isShareable(p));
  if (verified.length === 0) return;

  // ほかのアイソレートが書いたばかりの一覧の上に足す（60秒のメモリの写しの上に書いて、その製品を消さない）。
  // 読めないときは書かない（読めなかった一覧を、この製品だけの一覧で上書きしない）
  let raw: unknown;
  try {
    raw = await cacheGetJSONStrict<unknown>(VERIFIED_INDEX_KEY);
  } catch (err) {
    console.error('Verified index unreadable; not writing:', err instanceof Error ? err.message : err);
    return;
  }
  const rawCount = Array.isArray(raw) ? raw.length : 0;
  // 期限が切れた製品・古い方式で分けた成分表示の製品は捨てる（次に調べたときに新しい方式で保存される）
  // 共有しない製品（信頼しないサイトの製品など）も、次の書き込みで一覧から外す
  const stored = liveEntries(raw, now).filter((e) => !hasStaleLabel(e.product) && isShareable(e.product));
  // すでに保存した製品（同じ id）の成分表示は、別の内容で置き換えない（英語の成分表示を訳した版、同じデータ源からの
  // 調べ直しは置き換える）。置き換えなかった製品は、期限（30日）か、新しい製品に押し出される（最大 300 件）まで残る
  // Web のページの製品は、同じバーコード・商品名の Open Beauty Facts の製品（別の id）があれば保存しない
  const fresh = verified.filter(
    (v) =>
      !stored.some(
        ({ product: s }) =>
          (isRejectedReplacement(s, v) && !(refresh && isSameSource(s, v))) ||
          (isSameProduct(s, v) && isWeakerDuplicate(s, v))
      )
  );
  // 足す・変える製品が無く、古い製品も捨てていなければ書き込まない（1つのキーへの書き込みを減らす。
  // 置き換えを断った製品を何度送られても、書き込みは起きない）。調べ直しは savedAt を変えるので書き込む
  if (
    !refresh &&
    stored.length === rawCount &&
    fresh.every((v) => stored.some(({ product: s }) => s.id === v.id && !hasDifferentIngredients(s, v)))
  )
    return;
  // 一覧に入れた日時は、すでに一覧にある製品ならそのまま（保存し直しても延びない）。調べ直した製品だけ今にする
  const savedAtOf = (id: string): number => {
    if (refresh) return now;
    const known = stored.find((e) => e.product.id === id)?.savedAt ?? savedAtById.get(id);
    return known !== undefined && isPlausibleSavedAt(known, now) ? known : now;
  };
  const combined: VerifiedEntry[] = [
    ...fresh.map((product) => ({ product, savedAt: savedAtOf(product.id) })),
    ...stored.filter((e) => !fresh.some((v) => v.id === e.product.id)),
  ];
  // 先に保存した Web のページの製品も、同じ製品の Open Beauty Facts の製品が入ったら外す
  // （OBF の製品が上限で外れた後に、Web のページの製品だけが残らないように）
  // OBF の製品のバーコード・商品名とブランドを先に集める（300 件どうしを総当たりで比べない。CPU 時間の上限 10ms）
  const obfKeys = new Set<string>();
  for (const { product: p } of combined) {
    if (p.ingredientSource !== 'open_beauty_facts') continue;
    if (p.barcode) obfKeys.add(`b:${p.barcode}`);
    obfKeys.add(`n:${p.brand}\n${p.name}`);
  }
  const withoutWeaker = combined.filter(
    ({ product: p }) =>
      p.ingredientSource !== 'web_page' ||
      !((p.barcode && obfKeys.has(`b:${p.barcode}`)) || obfKeys.has(`n:${p.brand}\n${p.name}`))
  );
  let obfCount = 0;
  const merged = withoutWeaker
    .filter(({ product: p }) => p.ingredientSource !== 'open_beauty_facts' || ++obfCount <= MAX_OBF_IN_INDEX)
    .slice(0, MAX_VERIFIED_PRODUCTS);
  // KV の期限は、だれも書かなくなったキーを消すためだけ（製品ごとの期限は savedAt）
  await cachePutJSON(VERIFIED_INDEX_KEY, merged, VERIFIED_TTL_SECONDS);
  for (const e of merged) savedAtById.set(e.product.id, e.savedAt);
}

/** 製品が見つからないときに KV を読み直す最短の間隔（読み直しが続いても KV を読みすぎない） */
const RECHECK_INTERVAL_MS = 10_000;
let lastRecheckedAt = 0;

/**
 * KV に保存された成分確認済みの製品をメモリのキャッシュへ読み込む（アイソレートごとに一定間隔で実行）。
 * recheck: 送られた製品が見つからないとき（別のアイソレートで見つけたばかりの製品）。いつもの間隔を待たず、
 * 前回の読み直しから RECHECK_INTERVAL_MS 経っていれば読む。
 * 期限（30日）が切れた製品はメモリのキャッシュからも外す（長く動くアイソレートが、古い成分表示を出し続けないように）
 */
export async function hydrateVerifiedProducts({
  recheck = false,
  now = Date.now(),
}: { recheck?: boolean; now?: number } = {}): Promise<void> {
  // 期限が切れた製品は、読み直しの間隔に関係なくメモリから外す（30日を過ぎて出さない）
  for (const [id, savedAt] of savedAtById) {
    if (!isExpired(savedAt, now)) continue;
    savedAtById.delete(id);
    removeFromDynamicCache(id);
  }
  if (recheck) {
    if (now - lastRecheckedAt < RECHECK_INTERVAL_MS) return;
    lastRecheckedAt = now;
  } else if (now - lastHydratedAt < HYDRATE_INTERVAL_MS) {
    return;
  }

  // 読み込みが終わってから印を付ける（読み込み中に来た別のリクエストが、空のまま進まないように）
  // 読み直しは、このアイソレートのメモリの写し（60 秒）ではなく KV を読む
  const raw = await cacheGetJSON<unknown>(VERIFIED_INDEX_KEY, { fresh: recheck });
  lastHydratedAt = now;
  // 古い順に追加し、新しいものがキャッシュの先頭に来るようにする
  for (const { product, savedAt } of liveEntries(raw, now).reverse()) {
    if (hasStaleLabel(product)) continue;
    const known = savedAtById.get(product.id);
    savedAtById.set(product.id, savedAt);
    // 一覧の成分表示が正：ほかのアイソレートが調べ直した製品（savedAt が新しい）、利用者の検索で別の内容が
    // メモリに入った製品は、一覧の内容に入れ替える（英語の成分表示を訳した版は、置き換えとして残す）
    const inMemory = RUNTIME_CACHE.find((p) => p.id === product.id);
    if (inMemory && ((known !== undefined && savedAt > known) || isRejectedReplacement(product, inMemory))) {
      removeFromDynamicCache(product.id);
    }
    if (!RUNTIME_CACHE.some((p) => p.id === product.id)) addProductToDynamicCache(product);
  }
}

/** テスト用：このアイソレートが覚えている一覧の状態を消す */
export function resetVerifiedIndexStateForTests(): void {
  savedAtById.clear();
  lastHydratedAt = 0;
  lastRecheckedAt = 0;
}
