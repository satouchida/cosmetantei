import { NextRequest, NextResponse } from 'next/server';
import { lookupByBarcode } from '@/lib/services/search-barcode-service';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code') || '';

  if (!code) {
    return NextResponse.json({ error: 'バーコードが指定されていません' }, { status: 400 });
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
