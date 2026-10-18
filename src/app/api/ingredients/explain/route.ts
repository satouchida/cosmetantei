import { NextRequest, NextResponse } from 'next/server';
import { explainIngredientWithAI, NOT_AN_INGREDIENT_NAME } from '@/lib/services/dynamic-ingredient-service';
import { findMatchingKnownIngredient } from '@/lib/analyzer/ingredient-analyzer';
import { getClientIp, isRateLimited, RATE_LIMIT_MESSAGE_JA } from '@/lib/server/cloudflare';
import { apiRoute, readJsonBody, TOO_LARGE } from '@/lib/server/api-route';

const MAX_INGREDIENT_NAME_LENGTH = 100;
/** 成分名1つの要求としては大きすぎる本文 */
const MAX_BODY_BYTES = 2048;

async function handlePost(req: NextRequest) {
  if (await isRateLimited('ai', getClientIp(req.headers))) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE_JA }, { status: 429 });
  }

  try {
    const body = await readJsonBody(req, MAX_BODY_BYTES);
    if (body === TOO_LARGE) {
      return NextResponse.json({ error: '成分名が長すぎます。' }, { status: 413 });
    }
    const raw = body && typeof body === 'object' ? (body as { ingredientName?: unknown }).ingredientName : undefined;
    const ingredientName = typeof raw === 'string' ? raw.normalize('NFKC').trim() : '';

    if (!ingredientName || ingredientName.length > MAX_INGREDIENT_NAME_LENGTH || NOT_AN_INGREDIENT_NAME.test(ingredientName)) {
      return NextResponse.json(
        { error: `成分名（ingredientName）を${MAX_INGREDIENT_NAME_LENGTH}文字以内で指定してください。` },
        { status: 400 }
      );
    }

    // 成分DBの成分は、アプリの評価のまま解説だけを AI で詳しくする。DB に無い成分は AI またはルールの解説
    const ingredient = await explainIngredientWithAI(ingredientName, findMatchingKnownIngredient(ingredientName));

    return NextResponse.json({
      success: true,
      ingredient,
    });
  } catch (error) {
    console.error('API /api/ingredients/explain error:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: '成分解説の取得中にエラーが発生しました。' },
      { status: 500 }
    );
  }
}

/** ほかのサイトからの呼び出しを断り、有料の呼び出しにルート名と利用者を付ける（src/lib/server/api-route.ts） */
export const POST = apiRoute('ingredient_explain', handlePost);
