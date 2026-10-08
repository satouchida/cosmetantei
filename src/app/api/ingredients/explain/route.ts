import { NextRequest, NextResponse } from 'next/server';
import { explainIngredientWithAI } from '@/lib/services/dynamic-ingredient-service';
import { getClientIp, isRateLimited, RATE_LIMIT_MESSAGE_JA } from '@/lib/server/cloudflare';

const MAX_INGREDIENT_NAME_LENGTH = 100;

export async function POST(req: NextRequest) {
  if (await isRateLimited('ai', getClientIp(req.headers))) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE_JA }, { status: 429 });
  }

  try {
    const body = await req.json();
    const { ingredientName } = body;

    if (!ingredientName || typeof ingredientName !== 'string' || ingredientName.length > MAX_INGREDIENT_NAME_LENGTH) {
      return NextResponse.json(
        { error: `成分名（ingredientName）を${MAX_INGREDIENT_NAME_LENGTH}文字以内で指定してください。` },
        { status: 400 }
      );
    }

    // Gemini によるAI解説またはルールベース動的解説を取得（キャッシュ対応）
    const ingredient = await explainIngredientWithAI(ingredientName.trim());

    return NextResponse.json({
      success: true,
      ingredient,
    });
  } catch (error) {
    console.error('API /api/ingredients/explain error:', error);
    return NextResponse.json(
      { error: '成分解説の取得中にエラーが発生しました。' },
      { status: 500 }
    );
  }
}
