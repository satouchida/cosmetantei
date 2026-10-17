import { NextRequest, NextResponse } from 'next/server';
import { explainIngredientWithAI, NOT_AN_INGREDIENT_NAME } from '@/lib/services/dynamic-ingredient-service';
import { findMatchingKnownIngredient } from '@/lib/analyzer/ingredient-analyzer';
import { getClientIp, isRateLimited, RATE_LIMIT_MESSAGE_JA } from '@/lib/server/cloudflare';
import { withUsageRoute } from '@/lib/server/usage';

const MAX_INGREDIENT_NAME_LENGTH = 100;
/** 成分名1つの要求としては大きすぎる本文 */
const MAX_BODY_BYTES = 2048;

const TOO_LARGE = Symbol('too large');

/** 本文を上限まで読む（Content-Length が無い・偽りの要求でも、上限を超えたら読むのをやめる） */
async function readJsonBody(req: NextRequest): Promise<unknown | typeof TOO_LARGE> {
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return TOO_LARGE;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

async function handlePost(req: NextRequest) {
  if (await isRateLimited('ai', getClientIp(req.headers))) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE_JA }, { status: 429 });
  }

  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: '成分名が長すぎます。' }, { status: 413 });
  }

  try {
    const body = await readJsonBody(req);
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

/** 有料の呼び出しの利用量を、このルートの分として記録する（src/lib/server/usage.ts） */
export const POST = withUsageRoute('ingredient_explain', handlePost);
