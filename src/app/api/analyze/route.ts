import { NextRequest, NextResponse } from 'next/server';
import { analyzeProduct, performDifferentialAnalysis } from '@/lib/analyzer/ingredient-analyzer';
import { hydrateVerifiedProducts } from '@/lib/data/cosmetics-db';
import { isValidProduct, isValidProductList } from '@/lib/server/validation';
import { resolveClientProduct, resolveClientProducts } from '@/lib/server/client-products';
import { getClientIp, isRateLimited, RATE_LIMIT_MESSAGE_JA } from '@/lib/server/cloudflare';
import { withUsageRoute } from '@/lib/server/usage';
import { analyzeProductWithAI } from '@/lib/services/ai-analysis';
import { isUserLabelProduct } from '@/lib/product-source';

async function handlePost(request: NextRequest) {
  // 成分数×既知DBの計算をするため、回数を制限する（有料の呼び出しは無いので検索と同じ枠）
  if (await isRateLimited('search', getClientIp(request.headers))) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE_JA }, { status: 429 });
  }
  try {
    const body = await request.json();
    const { product, badProducts, safeProducts, aiEvaluate } = body as {
      product?: unknown;
      badProducts?: unknown;
      safeProducts?: unknown;
      /** 未評価の成分を AI で評価する（Gemini を呼ぶので AI の回数制限も使う） */
      aiEvaluate?: unknown;
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

    // サーバーが持っている製品は、ブラウザから送られた内容ではなくサーバーの内容を使う
    if (product && aiEvaluate === true) {
      // サーバーが持っている製品なら、送られたものとは別のオブジェクトが返る
      let resolved = await resolveClientProduct(product);
      // 別のアイソレートで見つけたばかりの製品は、このアイソレートのメモリにまだ無い。KV を早めに読み直して探す
      if (resolved === product && !isUserLabelProduct(product)) {
        await hydrateVerifiedProducts({ recheck: true });
        resolved = await resolveClientProduct(product);
      }
      const fromServer = resolved !== product;
      // Gemini を呼ぶのはサーバーが持っている製品だけなので、AI の回数制限もそのときだけ使う
      if (fromServer && (await isRateLimited('ai', getClientIp(request.headers)))) {
        return NextResponse.json({ error: RATE_LIMIT_MESSAGE_JA }, { status: 429 });
      }
      const result = await analyzeProductWithAI(resolved, { fromServer });
      return NextResponse.json({ type: 'single', result });
    }

    if (product) {
      const result = analyzeProduct(await resolveClientProduct(product));
      return NextResponse.json({ type: 'single', result });
    }

    if (badProducts && badProducts.length > 0) {
      const diffResult = performDifferentialAnalysis(
        await resolveClientProducts(badProducts),
        await resolveClientProducts(safeProducts || [])
      );
      return NextResponse.json({ type: 'differential', result: diffResult });
    }

    return NextResponse.json({ error: '分析対象の製品データが不足しています' }, { status: 400 });
  } catch (err) {
    console.error('Analysis error:', err);
    return NextResponse.json({ error: '解析中にエラーが発生しました' }, { status: 500 });
  }
}

/** 有料の呼び出しの利用量を、このルートの分として記録する（src/lib/server/usage.ts） */
export const POST = withUsageRoute('analyze', handlePost);
