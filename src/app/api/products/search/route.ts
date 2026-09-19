import { NextRequest, NextResponse } from 'next/server';
import { searchCosmeticsLive } from '@/lib/services/search-barcode-service';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();
  const limit = parseInt(searchParams.get('limit') || '6', 10);

  // 高頻度API（Open Beauty Facts）＋ Google検索 ＋ 意図別サジェストによるリアルタイム探索
  const results = await searchCosmeticsLive(q, limit);

  return NextResponse.json({ query: q, results });
}
