import { NextRequest, NextResponse } from 'next/server';
import { isActualCosmeticProduct, searchCosmeticsLive } from '@/lib/services/search-barcode-service';
import { brandProducts, BrandSuggestion, buildBrandIndex, resolveBrand, suggestBrands } from '@/lib/services/brand-suggest';
import { searchKey } from '@/lib/search/product-match';
import {
  cacheGetJSON,
  cachePutJSON,
  getClientIp,
  hashedCacheKey,
  isRateLimited,
  RATE_LIMIT_MESSAGE_JA,
} from '@/lib/server/cloudflare';
import { Product } from '@/lib/types';
import { apiRoute } from '@/lib/server/api-route';
import { COSMETICS_DATABASE, hydrateVerifiedProducts, isVerifiedSource } from '@/lib/data/cosmetics-db';

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 10;
const MAX_QUERY_LENGTH = 100;
// 同じ検索語で Open Beauty Facts への問い合わせを繰り返さないよう、結果をキャッシュする
// （この API は入力途中の候補表示用。有料の Web リサーチは行わない）
const RESULTS_TTL_SECONDS = 60 * 60;
const EMPTY_RESULTS_TTL_SECONDS = 60 * 5;

const isVerified = (p: Product) => isVerifiedSource(p) && p.ingredients.length > 0;

async function handleGet(request: NextRequest) {
  if (await isRateLimited('search', getClientIp(request.headers))) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE_JA, results: [], brands: [] }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim().slice(0, MAX_QUERY_LENGTH);
  const requested = parseInt(searchParams.get('limit') || '', 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), MAX_LIMIT) : DEFAULT_LIMIT;

  // KV に保存された成分確認済みの製品（チャットの Web リサーチ等で調べたもの）をメモリへ読み込んでから探す
  await hydrateVerifiedProducts();
  const onFile = COSMETICS_DATABASE.filter(isActualCosmeticProduct);

  // ブランドで始まる検索語（「しせいどう 化粧水」）：そのブランドの保存済みの製品を、残りの語で絞り込む。
  // お店の API のキーが届いたら、ここでブランドの製品一覧を足す（docs/walkthroughs/2026-10-15-brand-typeahead.md）
  const brandIndex = buildBrandIndex(onFile);
  // brands: 検索語で始まるブランド（タップすると「ブランド名 」が入力され、そのブランドの製品に絞り込む）。毎回作る
  const brands: BrandSuggestion[] = suggestBrands(q, brandIndex);
  const resolved = resolveBrand(q, brandIndex);
  const byBrand = brandProducts(q, onFile, brandIndex, isVerified)?.products ?? [];
  // brand: 検索語の先頭のブランドと残りの語。ブラウザはこれで、お店の製品一覧（/api/products/lineup）を取って絞り込む
  const brand = resolved ? { name: resolved.brand.entry.name, rest: resolved.rest } : null;
  // 保存済みの製品は毎回読み直す（キャッシュには外部の結果だけを入れ、新しく調べた製品がすぐ出るように）
  const withBrandFirst = (external: Product[]) => {
    const out = byBrand.slice(0, limit);
    for (const p of external) {
      if (out.length >= limit) break;
      if (!out.some((r) => r.id === p.id)) out.push(p);
    }
    return out;
  };
  // 保存済みのブランドの製品だけで足りるなら、外部に問い合わせない
  if (byBrand.length >= limit) {
    return NextResponse.json({ query: q, results: withBrandFirst([]), brands, brand });
  }

  // 照合のしかたを変えたら版を上げる（v5: キャッシュは searchCosmeticsLive の結果だけ。ブランドの製品は入れない）
  // 記号だけの検索語は空の検索（人気の製品）と分ける
  const key = searchKey(q) || (q ? `raw:${q}` : '');
  const cacheKey = await hashedCacheKey('search:v5', `${key}|${limit}`);
  const cached = await cacheGetJSON<Product[]>(cacheKey);
  if (cached) {
    return NextResponse.json({ query: q, results: withBrandFirst(cached), brands, brand });
  }

  // キャッシュ済みの製品 ＋ Open Beauty Facts による探索。
  // ブランド名を入力している途中（「しせ」）は Open Beauty Facts に問い合わせない（ブランドの候補を出せば足り、待たせない）
  const typingBrand = brands.length > 0 && !resolved;
  const external = await searchCosmeticsLive(q, limit, { openBeautyFacts: !typingBrand });
  await cachePutJSON(cacheKey, external, external.length > 0 ? RESULTS_TTL_SECONDS : EMPTY_RESULTS_TTL_SECONDS);

  return NextResponse.json({ query: q, results: withBrandFirst(external), brands, brand });
}

/** ほかのサイトからの呼び出しを断り、有料の呼び出しにルート名と利用者を付ける（src/lib/server/api-route.ts） */
export const GET = apiRoute('product_search', handleGet);
