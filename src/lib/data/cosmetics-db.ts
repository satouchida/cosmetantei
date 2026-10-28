import { Product } from '../types';
import { isShopListingProduct, isUserLabelProduct } from '../product-source';
import { buildAmazonAffiliateUrl } from '../services/amazon-affiliate';
import { cacheGetJSON, cachePutJSON } from '../server/cloudflare';
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

export function addMultipleProductsToDynamicCache(products: Product[]): Product[] {
  return products.map(addProductToDynamicCache);
}

// ---------- 成分確認済み製品の KV 永続化 ----------
// おすすめ代替品は成分確認済みの製品からのみ選ぶため、新しいアイソレートでも候補が空にならないよう KV に保存する

const VERIFIED_INDEX_KEY = 'verified-products:v1';
const MAX_VERIFIED_PRODUCTS = 300;
/**
 * そのうち Open Beauty Facts の製品の上限。費用のかからない検索で誰でも足せるため、上限を超えたら古い OBF の製品から外す
 * （OBF の検索を繰り返して、有料で調べた製品・自動の保存の製品を一覧から押し出し、
 * 同じ id の別の内容での置き換えを断る仕組みを外させない）
 */
const MAX_OBF_IN_INDEX = 100;
const VERIFIED_TTL_SECONDS = 60 * 60 * 24 * 30;
const HYDRATE_INTERVAL_MS = 5 * 60 * 1000;
let lastHydratedAt = 0;

/**
 * 成分確認済みの製品を KV のインデックスに追記する（確認済みでない製品は無視）
 */
export async function rememberVerifiedProducts(products: Product[]): Promise<void> {
  const verified = products.filter((p) => isStoredSource(p) && isShareable(p));
  if (verified.length === 0) return;

  // 古い方式で分けた成分表示の製品は捨てる（次に調べたときに新しい方式で保存される）
  // ほかのアイソレートが書いたばかりの一覧の上に足す（60秒のメモリの写しの上に書いて、その製品を消さない）
  const raw = (await cacheGetJSON<Product[]>(VERIFIED_INDEX_KEY, { fresh: true })) || [];
  // 共有しない製品（信頼しないサイトの製品など）も、次の書き込みで一覧から外す
  const stored = raw.filter((p) => !hasStaleLabel(p) && isShareable(p));
  // すでに保存した製品（同じ id）の成分表示は、別の内容で置き換えない（英語の成分表示を訳した版は置き換える）。
  // 置き換えなかった製品は、新しい製品に押し出される（最大 300 件）まで残る。インデックス全体の期限は書き込むたびに延びる
  // Web のページの製品は、同じバーコード・商品名の Open Beauty Facts の製品（別の id）があれば保存しない
  const fresh = verified.filter(
    (v) => !stored.some((s) => isRejectedReplacement(s, v) || (isSameProduct(s, v) && isWeakerDuplicate(s, v)))
  );
  // 足す・変える製品が無く、古い製品も捨てていなければ書き込まない（1つのキーへの書き込みを減らす。
  // 置き換えを断った製品を何度送られても、書き込みは起きない）
  if (
    stored.length === raw.length &&
    fresh.every((v) => stored.some((s) => s.id === v.id && !hasDifferentIngredients(s, v)))
  )
    return;
  const combined = [...fresh, ...stored.filter((s) => !fresh.some((v) => v.id === s.id))];
  // 先に保存した Web のページの製品も、同じ製品の Open Beauty Facts の製品が入ったら外す
  // （OBF の製品が上限で外れた後に、Web のページの製品だけが残らないように）
  // OBF の製品のバーコード・商品名とブランドを先に集める（300 件どうしを総当たりで比べない。CPU 時間の上限 10ms）
  const obfKeys = new Set<string>();
  for (const p of combined) {
    if (p.ingredientSource !== 'open_beauty_facts') continue;
    if (p.barcode) obfKeys.add(`b:${p.barcode}`);
    obfKeys.add(`n:${p.brand}\n${p.name}`);
  }
  const withoutWeaker = combined.filter(
    (p) =>
      p.ingredientSource !== 'web_page' ||
      !((p.barcode && obfKeys.has(`b:${p.barcode}`)) || obfKeys.has(`n:${p.brand}\n${p.name}`))
  );
  let obfCount = 0;
  const merged = withoutWeaker
    .filter((p) => p.ingredientSource !== 'open_beauty_facts' || ++obfCount <= MAX_OBF_IN_INDEX)
    .slice(0, MAX_VERIFIED_PRODUCTS);
  await cachePutJSON(VERIFIED_INDEX_KEY, merged, VERIFIED_TTL_SECONDS);
}

/** 製品が見つからないときに KV を読み直す最短の間隔（読み直しが続いても KV を読みすぎない） */
const RECHECK_INTERVAL_MS = 10_000;
let lastRecheckedAt = 0;

/**
 * KV に保存された成分確認済みの製品をメモリのキャッシュへ読み込む（アイソレートごとに一定間隔で実行）。
 * recheck: 送られた製品が見つからないとき（別のアイソレートで見つけたばかりの製品）。いつもの間隔を待たず、
 * 前回の読み直しから RECHECK_INTERVAL_MS 経っていれば読む
 */
export async function hydrateVerifiedProducts({ recheck = false }: { recheck?: boolean } = {}): Promise<void> {
  if (recheck) {
    if (Date.now() - lastRecheckedAt < RECHECK_INTERVAL_MS) return;
    lastRecheckedAt = Date.now();
  } else if (Date.now() - lastHydratedAt < HYDRATE_INTERVAL_MS) {
    return;
  }

  // 読み込みが終わってから印を付ける（読み込み中に来た別のリクエストが、空のまま進まないように）
  // 読み直しは、このアイソレートのメモリの写し（60 秒）ではなく KV を読む
  const stored = await cacheGetJSON<Product[]>(VERIFIED_INDEX_KEY, { fresh: recheck });
  lastHydratedAt = Date.now();
  if (!stored) return;
  // 古い順に追加し、新しいものがキャッシュの先頭に来るようにする
  for (const product of [...stored].reverse()) {
    if (!hasStaleLabel(product) && !RUNTIME_CACHE.some((p) => p.id === product.id)) {
      addProductToDynamicCache(product);
    }
  }
}

