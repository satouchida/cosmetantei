import { Product } from '../types';
import { buildAmazonAffiliateUrl } from '../services/amazon-affiliate';
import { cacheGetJSON, cachePutJSON } from '../server/cloudflare';

/**
 * 【動的コスメキャッシュ】
 * Open Beauty Facts API や Google検索グラウンディングから取得した実在商品のみを保持します。
 * 架空の商品・ベースライン商品は持ちません。
 * Cloudflare Workers ではアイソレート単位のメモリのため、上限件数を設けて古いものから破棄します。
 */
const MAX_CACHED_PRODUCTS = 500;

const RUNTIME_CACHE: Product[] = [];

export const COSMETICS_DATABASE: Product[] = RUNTIME_CACHE;

/** 成分表示が実在データ源（Open Beauty Facts・ユーザー入力）由来の製品か */
function isVerifiedSource(p: Product): boolean {
  return p.ingredientSource === 'open_beauty_facts' || p.ingredientSource === 'user_label';
}

/**
 * 外部APIやGoogle検索で取得した商品情報を動的キャッシュに追加・更新
 */
export function addProductToDynamicCache(product: Product): Product {
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
  const verified = products.filter(isVerifiedSource);
  if (verified.length === 0) return;

  const stored = (await cacheGetJSON<Product[]>(VERIFIED_INDEX_KEY)) || [];
  const merged = [...verified, ...stored.filter((s) => !verified.some((v) => v.id === s.id))].slice(
    0,
    MAX_VERIFIED_PRODUCTS
  );
  await cachePutJSON(VERIFIED_INDEX_KEY, merged, VERIFIED_TTL_SECONDS);
}

/**
 * KV に保存された成分確認済みの製品をメモリのキャッシュへ読み込む（アイソレートごとに一定間隔で実行）
 */
export async function hydrateVerifiedProducts(): Promise<void> {
  if (Date.now() - lastHydratedAt < HYDRATE_INTERVAL_MS) return;
  lastHydratedAt = Date.now();

  const stored = await cacheGetJSON<Product[]>(VERIFIED_INDEX_KEY);
  if (!stored) return;
  // 古い順に追加し、新しいものがキャッシュの先頭に来るようにする
  for (const product of [...stored].reverse()) {
    if (!RUNTIME_CACHE.some((p) => p.id === product.id)) {
      addProductToDynamicCache(product);
    }
  }
}

