import { NextRequest, NextResponse } from 'next/server';
import { explainIngredientWithAI, getOrGenerateIngredientExplanation } from '@/lib/services/dynamic-ingredient-service';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { ingredientName } = body;

    if (!ingredientName || typeof ingredientName !== 'string') {
      return NextResponse.json(
        { error: '成分名（ingredientName）が必要です。' },
        { status: 400 }
      );
    }

    // Gemini 3.8 Flash によるAI解説またはルールベース動的解説を取得（キャッシュ対応）
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
