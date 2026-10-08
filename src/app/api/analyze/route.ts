import { NextRequest, NextResponse } from 'next/server';
import { analyzeProduct, performDifferentialAnalysis } from '@/lib/analyzer/ingredient-analyzer';
import { hydrateVerifiedProducts } from '@/lib/data/cosmetics-db';
import { isValidProduct, isValidProductList } from '@/lib/server/validation';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { product, badProducts, safeProducts } = body as {
      product?: unknown;
      badProducts?: unknown;
      safeProducts?: unknown;
    };

    // 入力の形式・サイズを検証（成分数×既知DBの計算量になるため上限を設ける）
    if (
      (product !== undefined && !isValidProduct(product)) ||
      (badProducts !== undefined && !isValidProductList(badProducts)) ||
      (safeProducts !== undefined && !isValidProductList(safeProducts))
    ) {
      return NextResponse.json({ error: '製品データの形式が正しくありません' }, { status: 400 });
    }

    // KV に保存された成分確認済みの製品を読み込み、おすすめ代替品の候補にする
    await hydrateVerifiedProducts();

    if (product) {
      const result = analyzeProduct(product);
      return NextResponse.json({ type: 'single', result });
    }

    if (badProducts && badProducts.length > 0) {
      const diffResult = performDifferentialAnalysis(badProducts, safeProducts || []);
      return NextResponse.json({ type: 'differential', result: diffResult });
    }

    return NextResponse.json({ error: '分析対象の製品データが不足しています' }, { status: 400 });
  } catch (err) {
    console.error('Analysis error:', err);
    return NextResponse.json({ error: '解析中にエラーが発生しました' }, { status: 500 });
  }
}
