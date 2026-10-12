import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, isRateLimited, RATE_LIMIT_MESSAGE_JA } from '@/lib/server/cloudflare';
import { parseLabelImage, readLabelImage, MAX_LABEL_IMAGE_BYTES } from '@/lib/services/label-reader';

/** base64 は元の 4/3 倍。JSON の枠の分を足した上限 */
const MAX_LABEL_REQUEST_BYTES = Math.ceil((MAX_LABEL_IMAGE_BYTES * 4) / 3) + 1024;

/**
 * 成分表示の写真を文字に起こす。結果はブラウザでユーザーが確認・修正してから分析する。
 * 写真と結果は保存しない
 */
export async function POST(request: NextRequest) {
  // Gemini を呼ぶため、AI 系と同じ上限を適用
  if (await isRateLimited('ai', getClientIp(request.headers))) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE_JA }, { status: 429 });
  }

  // 1.5MB の写真の base64 と JSON の枠に収まらない本文は、読まずに断る（ブラウザの fetch は長さを必ず送る）
  const declared = Number(request.headers.get('content-length'));
  if (!Number.isFinite(declared) || declared <= 0 || declared > MAX_LABEL_REQUEST_BYTES) {
    return NextResponse.json({ error: '画像が大きすぎます。1.5MB までの写真を選んでください。' }, { status: 413 });
  }
  const body = await request.json().catch(() => null);
  const image = parseLabelImage((body as { image?: unknown } | null)?.image);
  if (!image) {
    return NextResponse.json(
      { error: '画像を読み込めませんでした。JPEG・PNG・WebP の写真（1.5MB まで）を選んでください。' },
      { status: 400 }
    );
  }

  const result = await readLabelImage(image);
  if ('text' in result) return NextResponse.json({ text: result.text });
  if (result.error === 'not_found') {
    return NextResponse.json(
      { error: '写真から成分表示を見つけられませんでした。成分表示の部分を大きく、明るく写してください。' },
      { status: 422 }
    );
  }
  return NextResponse.json(
    { error: '写真の読み取りが一時的に使えません。成分表示を文字で入力してください。' },
    { status: 503 }
  );
}
