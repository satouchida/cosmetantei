import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, isRateLimited, RATE_LIMIT_MESSAGE_JA } from '@/lib/server/cloudflare';
import { crossSiteRejection, readJsonBody, TOO_LARGE } from '@/lib/server/api-route';
import { startSession } from '@/lib/server/session';

/** トークンは 2,048 字まで。JSON の枠の分を足した上限 */
const MAX_SESSION_BODY_BYTES = 4096;

/**
 * Turnstile のトークンを確かめ、セッションの Cookie を付ける（src/lib/server/session.ts）。
 * 有料の呼び出しはしないので apiRoute は使わない（セッションが無いと断る apiRoute の前に呼ぶ）
 */
export async function POST(request: NextRequest) {
  const rejected = crossSiteRejection(request);
  if (rejected) return rejected;
  if (await isRateLimited('session', getClientIp(request.headers))) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE_JA }, { status: 429 });
  }
  const body = await readJsonBody(request, MAX_SESSION_BODY_BYTES);
  if (body === TOO_LARGE) return NextResponse.json({ error: 'リクエストが大きすぎます。' }, { status: 413 });
  return startSession(request, (body as { token?: unknown } | null)?.token);
}
