import 'server-only';

/**
 * 運営者の利用枠（docs/plans/owner-allowance.md）。運営者のブラウザだけ、利用者ごとの1日の上限（IP・セッション）の
 * 代わりに SPEND_PER_OWNER_USD の上限を使う（全体の予算・1回の要求の上限・1分の件数はほかの利用者と同じ）
 * - 秘密の値 OWNER_KEY（32字以上。wrangler secret put で設定）を /owner のページで1回入力すると、
 *   署名した Cookie（__Host-owner）を付ける。Cookie には OWNER_KEY そのものは入れない
 * - 署名の鍵は OWNER_KEY。OWNER_KEY を変えれば、それまでの Cookie はすべて使えなくなる（写された Cookie を
 *   止める方法はこれだけ。「外す」はそのブラウザの Cookie だけを消す）
 * - OWNER_KEY が無い・短いときは、この仕組みを使わない（入力も断る）
 */

export const OWNER_COOKIE = '__Host-owner';

/** Cookie の期限（秒）。30日 */
export const OWNER_TTL_SECONDS = 30 * 24 * 60 * 60;

/** OWNER_KEY の最短の長さ（推測で当てられないように） */
export const MIN_OWNER_KEY_LENGTH = 32;

/** OWNER_KEY の最長の長さ（/owner で入力できる長さ） */
export const MAX_OWNER_KEY_LENGTH = 512;

const encoder = new TextEncoder();

/** 使える OWNER_KEY。無い・短いときは null */
export function ownerKey(): string | null {
  const key = (process.env.OWNER_KEY || '').trim();
  if (key.length < MIN_OWNER_KEY_LENGTH || key.length > MAX_OWNER_KEY_LENGTH) return null;
  // 同じ字の繰り返しなど、明らかに弱い鍵は使わない（Cookie の署名の鍵でもあるので。openssl rand -base64 32 などで作る）
  if (new Set(key).size < 12) return null;
  return key;
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const signedPart = (expires: number) => `owner|v1|${expires}`;

/** 運営者の Cookie の値（期限.署名） */
export async function createOwnerValue(key: string, now: number): Promise<string> {
  const expires = Math.floor(now / 1000) + OWNER_TTL_SECONDS;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(key), encoder.encode(signedPart(expires)));
  return `${expires}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Cookie が、今の OWNER_KEY で署名した期限内の運営者の Cookie か */
export async function isOwnerCookie(cookieHeader: string | null, key: string | null, now: number): Promise<boolean> {
  if (!key) return false;
  const value = cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${OWNER_COOKIE}=`))
    ?.slice(OWNER_COOKIE.length + 1);
  const [expiresText, signatureText, ...rest] = (value ?? '').split('.');
  if (!expiresText || !signatureText || rest.length > 0 || !/^\d{1,12}$/.test(expiresText)) return false;
  const expires = Number(expiresText);
  if (expires * 1000 <= now) return false;
  const signature = fromBase64Url(signatureText);
  if (!signature) return false;
  // 署名は verify で比べる（かかる時間から署名を推測させない）。暗号の処理が失敗したら、ふつうの利用者として扱う
  try {
    return await crypto.subtle.verify('HMAC', await hmacKey(key), signature, encoder.encode(signedPart(expires)));
  } catch (err) {
    console.error('[owner] cookie check failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

/** 要求が運営者のブラウザからか */
export function isOwnerRequest(request: Request): Promise<boolean> {
  return isOwnerCookie(request.headers.get('cookie'), ownerKey(), Date.now());
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

/**
 * 入力された値が OWNER_KEY か。同じ長さ（32バイト）のダイジェストを、全バイトを見て比べる
 * （かかる時間から OWNER_KEY を1字ずつ推測させない）
 */
async function matchesOwnerKey(input: string, key: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(input), sha256(key)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const NOT_AVAILABLE_REPLY = { error: '使えません。' };

/** POST /api/owner の本体：OWNER_KEY と同じ値なら、運営者の Cookie を付ける */
export async function startOwner(input: unknown): Promise<Response> {
  const key = ownerKey();
  if (!key) return Response.json(NOT_AVAILABLE_REPLY, { status: 404 });
  try {
    if (typeof input !== 'string' || !input.trim() || input.length > MAX_OWNER_KEY_LENGTH || !(await matchesOwnerKey(input.trim(), key))) {
      console.warn('[owner] wrong key');
      return Response.json({ error: '値が違います。' }, { status: 403 });
    }
    const value = await createOwnerValue(key, Date.now());
    console.log('[owner] cookie set');
    return Response.json(
      { ok: true, days: OWNER_TTL_SECONDS / 86_400 },
      { headers: { 'Set-Cookie': `${OWNER_COOKIE}=${value}; Path=/; Max-Age=${OWNER_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict` } }
    );
  } catch (err) {
    console.error('[owner] failed:', err instanceof Error ? err.message : err);
    return Response.json({ error: '処理できませんでした。' }, { status: 500 });
  }
}

/** DELETE /api/owner の本体：運営者の Cookie を消す */
export function endOwner(): Response {
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': `${OWNER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict` } }
  );
}
