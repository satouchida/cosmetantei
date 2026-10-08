import { NextRequest, NextResponse } from 'next/server';
import { lookupByBarcode, BARCODE_PATTERN } from '@/lib/services/search-barcode-service';
import { getClientIp, isRateLimited, RATE_LIMIT_MESSAGE_JA } from '@/lib/server/cloudflare';

export async function GET(request: NextRequest) {
  // 未登録バーコードは Gemini 検索に到達するため、AI系と同じ上限を適用
  if (await isRateLimited('ai', getClientIp(request.headers))) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE_JA }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const code = (searchParams.get('code') || '').replace(/[\s\-_]/g, '');

  if (!BARCODE_PATTERN.test(code)) {
    return NextResponse.json({ error: 'バーコードは8〜14桁の数字で指定してください' }, { status: 400 });
  }

  const product = await lookupByBarcode(code);

  if (!product) {
    return NextResponse.json(
      {
        error: `バーコード（${code}）に該当する製品が見つかりませんでした。パッケージの全成分を直接入力して分析することができます。`,
        barcode: code,
      },
      { status: 404 }
    );
  }

  return NextResponse.json({ product });
}
