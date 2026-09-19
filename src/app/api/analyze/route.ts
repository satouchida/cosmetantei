import { NextRequest, NextResponse } from 'next/server';
import { analyzeProduct, performDifferentialAnalysis } from '@/lib/analyzer/ingredient-analyzer';
import { Product } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { product, badProducts, safeProducts } = body as {
      product?: Product;
      badProducts?: Product[];
      safeProducts?: Product[];
    };

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
