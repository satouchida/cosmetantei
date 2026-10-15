import { NextRequest, NextResponse } from 'next/server';
import { searchCosmeticsLive } from '@/lib/services/search-barcode-service';
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
import { withUsageRoute } from '@/lib/server/usage';
import { hydrateVerifiedProducts } from '@/lib/data/cosmetics-db';

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 10;
const MAX_QUERY_LENGTH = 100;
// 同じ検索語で Open Beauty Facts への問い合わせを繰り返さないよう、結果をキャッシュする
// （この API は入力途中の候補表示用。有料の Web リサーチは行わない）
const RESULTS_TTL_SECONDS = 60 * 60;
const EMPTY_RESULTS_TTL_SECONDS = 60 * 5;

async function handleGet(request: NextRequest) {
  if (await isRateLimited('search', getClientIp(request.headers))) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE_JA, results: [] }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim().slice(0, MAX_QUERY_LENGTH);
  const requested = parseInt(searchParams.get('limit') || '', 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), MAX_LIMIT) : DEFAULT_LIMIT;

  // 照合のしかたを変えたら版を上げる（v3: ひらがな・カタカナ等の揺れを吸収する照合）
  // 記号だけの検索語は空の検索（人気の製品）と分ける
  const key = searchKey(q) || (q ? `raw:${q}` : '');
  const cacheKey = await hashedCacheKey('search:v3', `${key}|${limit}`);
  const cached = await cacheGetJSON<Product[]>(cacheKey);
  if (cached) {
    return NextResponse.json({ query: q, results: cached });
  }

  // KV に保存された成分確認済みの製品（チャットの Web リサーチ等で調べたもの）をメモリへ読み込んでから探す
  await hydrateVerifiedProducts();
  // キャッシュ済みの製品 ＋ Open Beauty Facts による探索
  const results = await searchCosmeticsLive(q, limit);
  await cachePutJSON(cacheKey, results, results.length > 0 ? RESULTS_TTL_SECONDS : EMPTY_RESULTS_TTL_SECONDS);

  return NextResponse.json({ query: q, results });
}

/** 有料の呼び出しの利用量を、このルートの分として記録する（src/lib/server/usage.ts） */
export const GET = withUsageRoute('product_search', handleGet);
