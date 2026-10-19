import { Product } from '../types';
import { isUserLabelProduct } from '../product-source';
import { buildAmazonAffiliateUrl } from '../services/amazon-affiliate';
import { cacheGetJSON, cachePutJSON } from '../server/cloudflare';
import { hasStaleLabel } from '../analyzer/label-parser';

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
 * 共有のキャッシュ・KV に入れてよい製品か。ユーザーが入力した成分表示は、その人だけのもので確認もされていないため入れない
 * （他の人の検索結果・代替品候補にしない）
 */
export function isShareable(p: Product): boolean {
  return !isUserLabelProduct(p);
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

export function addProductToDynamicCache(product: Product): Product {
  if (!isShareable(product)) return product;
  const existingIdx = RUNTIME_CACHE.findIndex(
    (p) =>
      p.id === product.id ||
      (product.barcode && p.barcode === product.barcode) ||
      (p.name === product.name && p.brand === product.brand)
  );

  const enrichedProduct: Product = {
    ...product,
    amazonSearchUrl: product.amazonSearchUrl || buildAmazonAffiliateUrl(product.brand, product.name),
  };

  if (existingIdx >= 0) {
    const existing = RUNTIME_CACHE[existingIdx];
    // 確認済みの成分データを AI 推定で上書きしない
    if (isVerifiedSource(existing) && !isVerifiedSource(enrichedProduct)) {
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
const VERIFIED_TTL_SECONDS = 60 * 60 * 24 * 30;
const HYDRATE_INTERVAL_MS = 5 * 60 * 1000;
let lastHydratedAt = 0;

/**
 * 成分確認済みの製品を KV のインデックスに追記する（確認済みでない製品は無視）
 */
export async function rememberVerifiedProducts(products: Product[]): Promise<void> {
  const verified = products.filter((p) => isVerifiedSource(p) && isShareable(p));
  if (verified.length === 0) return;

  // 古い方式で分けた成分表示の製品は捨てる（次に調べたときに新しい方式で保存される）
  const raw = (await cacheGetJSON<Product[]>(VERIFIED_INDEX_KEY)) || [];
  const stored = raw.filter((p) => !hasStaleLabel(p));
  // すでに保存した製品（同じ id）の成分表示は、別の内容で置き換えない（英語の成分表示を訳した版は置き換える）。
  // 置き換えなかった製品は、新しい製品に押し出される（最大 300 件）まで残る。インデックス全体の期限は書き込むたびに延びる
  const fresh = verified.filter((v) => !stored.some((s) => isRejectedReplacement(s, v)));
  // 足す・変える製品が無く、古い製品も捨てていなければ書き込まない（1つのキーへの書き込みを減らす。
  // 置き換えを断った製品を何度送られても、書き込みは起きない）
  if (
    stored.length === raw.length &&
    fresh.every((v) => stored.some((s) => s.id === v.id && !hasDifferentIngredients(s, v)))
  )
    return;
  const merged = [...fresh, ...stored.filter((s) => !fresh.some((v) => v.id === s.id))].slice(
    0,
    MAX_VERIFIED_PRODUCTS
  );
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

