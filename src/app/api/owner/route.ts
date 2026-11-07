import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, isRateLimited, RATE_LIMIT_MESSAGE_JA } from '@/lib/server/cloudflare';
import { crossSiteRejection, readJsonBody, TOO_LARGE } from '@/lib/server/api-route';
import { endOwner, startOwner } from '@/lib/server/owner';

/** 値は 512 字まで。JSON の枠の分を足した上限 */
const MAX_OWNER_BODY_BYTES = 1024;

/**
 * 運営者の利用枠の Cookie を付ける・消す（src/lib/server/owner.ts）。
 * 有料の呼び出しはしないので apiRoute は使わない。入力の回数はセッションの発行と同じ上限で数える
 */
export async function POST(request: NextRequest) {
  const rejected = crossSiteRejection(request);
  if (rejected) return rejected;
  if (await isRateLimited('session', getClientIp(request.headers))) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE_JA }, { status: 429 });
  }
  const body = await readJsonBody(request, MAX_OWNER_BODY_BYTES);
  if (body === TOO_LARGE) return NextResponse.json({ error: 'リクエストが大きすぎます。' }, { status: 413 });
  return startOwner((body as { key?: unknown } | null)?.key);
}

export async function DELETE(request: NextRequest) {
  const rejected = crossSiteRejection(request);
  if (rejected) return rejected;
  return endOwner();
}
