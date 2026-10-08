import { NextRequest, NextResponse } from 'next/server';
import { searchCosmeticsLive, normalizeSearchString } from '@/lib/services/search-barcode-service';
import {
  cacheGetJSON,
  cachePutJSON,
  getClientIp,
  hashedCacheKey,
  isRateLimited,
  RATE_LIMIT_MESSAGE_JA,
} from '@/lib/server/cloudflare';
import { Product } from '@/lib/types';

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 10;
const MAX_QUERY_LENGTH = 100;
// 同じ検索語で Google 検索グラウンディングを繰り返さないよう、結果をキャッシュする
const RESULTS_TTL_SECONDS = 60 * 60;
const EMPTY_RESULTS_TTL_SECONDS = 60 * 5;

export async function GET(request: NextRequest) {
  if (await isRateLimited('search', getClientIp(request.headers))) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE_JA, results: [] }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim().slice(0, MAX_QUERY_LENGTH);
  const requested = parseInt(searchParams.get('limit') || '', 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), MAX_LIMIT) : DEFAULT_LIMIT;

  const cacheKey = await hashedCacheKey('search:v1', `${normalizeSearchString(q)}|${limit}`);
  const cached = await cacheGetJSON<Product[]>(cacheKey);
  if (cached) {
    return NextResponse.json({ query: q, results: cached });
  }

  // 高頻度API（Open Beauty Facts）＋ Google検索 ＋ 意図別サジェストによるリアルタイム探索
  const results = await searchCosmeticsLive(q, limit);
  await cachePutJSON(cacheKey, results, results.length > 0 ? RESULTS_TTL_SECONDS : EMPTY_RESULTS_TTL_SECONDS);

  return NextResponse.json({ query: q, results });
}
