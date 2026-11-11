import 'server-only';

/**
 * 署名・秘密の値の比べ方（セッション・運営者の Cookie、自動の保存の x-seed-secret）。
 * 時間の変わらない比べ方は1か所だけに置く（写しがあると、片方だけ直して食い違う）
 */

const encoder = new TextEncoder();

/** HMAC-SHA-256 の鍵（署名と、verify での確かめに使う） */
export function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

/**
 * 入力された値が秘密の値と同じか。長さ・中身で時間の変わらない比べ方：同じ長さ（32バイト）のダイジェストを、
 * 全バイトを見て比べる（かかる時間から秘密の値を1字ずつ推測させない）
 */
export async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
