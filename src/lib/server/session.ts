import 'server-only';
import { warnOnceInProduction } from './cloudflare';

/**
 * Turnstile で確かめたブラウザのセッション（ログインの代わり）。
 * - 有料の呼び出しをする API ルートは、署名付きのセッションの Cookie が無ければ 401 と Turnstile のサイトキーを返す。
 *   ブラウザ（src/lib/client/api-fetch.ts）は Turnstile を解いて POST /api/session に渡し、Cookie をもらって頼み直す
 * - セッションごとにも1日の予算を付ける（src/lib/server/spend-cap.ts の session）。IP を替えても、新しいセッションには
 *   毎回 Turnstile を解く必要があるので、多くの IP を並べて予算を使い切るのが高くつく
 * - TURNSTILE_SITE_KEY（[vars]）が空なら使わない（IP ごとの予算だけ）。設定したら、秘密情報の
 *   TURNSTILE_SECRET_KEY と SESSION_SECRET（32文字以上）も要る。足りなければ有料の API を断る
 * - Cookie はセッションの ID と期限と署名だけ（利用者の情報は入れない）。24時間で切れ、また Turnstile を解く
 */

export const SESSION_COOKIE = '__Host-session';
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SITEVERIFY_TIMEOUT_MS = 5_000;
/** ブラウザの Turnstile に付ける action（siteverify の結果と比べる） */
export const TURNSTILE_ACTION = 'api';
const MAX_TOKEN_LENGTH = 2048;
const MIN_SESSION_SECRET_LENGTH = 32;
/** Cloudflare が公開しているテスト用の秘密キー（どこでも通る・必ず失敗する等） */
const TEST_SECRET_PATTERN = /^[123]x0+AA$/;

export const VERIFY_REPLY_JA = 'ブラウザの確認が必要です。ページを読み込み直してください。';
const VERIFY_FAILED_JA = 'ブラウザを確認できませんでした。ページを読み込み直してください。';
const UNAVAILABLE_JA = 'ただいま AI を使う機能を利用できません。時間をおいてお試しください。';

type TurnstileConfig =
  | { state: 'off' }
  | { state: 'misconfigured' }
  | { state: 'on'; siteKey: string; secret: string; sessionSecret: string; testSecret: boolean };

const readEnv = (name: string): string => (process.env[name] || '').trim();

export function turnstileConfig(): TurnstileConfig {
  const siteKey = readEnv('TURNSTILE_SITE_KEY');
  if (!siteKey) {
    // 設定前のデプロイでも動くように、空なら使わない。止まっていることはログで分かるようにする
    warnOnceInProduction('turnstile-off', 'TURNSTILE_SITE_KEY is empty; Turnstile session checks are off (per-IP budgets only).');
    return { state: 'off' };
  }
  const secret = readEnv('TURNSTILE_SECRET_KEY');
  const sessionSecret = readEnv('SESSION_SECRET');
  if (!secret || sessionSecret.length < MIN_SESSION_SECRET_LENGTH) return { state: 'misconfigured' };
  return { state: 'on', siteKey, secret, sessionSecret, testSecret: TEST_SECRET_PATTERN.test(secret) };
}

function misconfiguredReply(): Response {
  warnOnceInProduction(
    'turnstile-config',
    'TURNSTILE_SITE_KEY is set but TURNSTILE_SECRET_KEY or SESSION_SECRET (32+ chars) is missing; refusing paid API routes.'
  );
  return Response.json({ error: UNAVAILABLE_JA }, { status: 503 });
}

const encoder = new TextEncoder();

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

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const signedPart = (id: string, expires: number) => `v1|${id}|${expires}`;

/** 新しいセッションの Cookie の値（ID.期限.署名） */
export async function createSessionValue(sessionSecret: string, now: number): Promise<string> {
  const id = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const expires = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(sessionSecret), encoder.encode(signedPart(id, expires)));
  return `${id}.${expires}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Cookie のセッションが正しく、期限内なら ID。そうでなければ null */
export async function readSessionId(cookieHeader: string | null, sessionSecret: string, now: number): Promise<string | null> {
  const value = cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  const [id, expiresText, signatureText, ...rest] = (value ?? '').split('.');
  if (!id || !expiresText || !signatureText || rest.length > 0 || !/^[A-Za-z0-9_-]{22}$/.test(id)) return null;
  const expires = /^\d{1,12}$/.test(expiresText) ? Number(expiresText) : 0;
  if (expires * 1000 <= now) return null;
  const signature = fromBase64Url(signatureText);
  if (!signature) return null;
  // 署名は verify で比べる（かかる時間から署名を推測させない）
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(sessionSecret), signature, encoder.encode(signedPart(id, expires)));
  return valid ? id : null;
}

/**
 * 有料の API ルートの前に確かめる。Turnstile を使わない設定なら {}、正しいセッションなら { id }、
 * そうでなければ断る応答（401 にはブラウザが Turnstile を出すためのサイトキーを付ける）
 */
export async function checkSession(request: Request): Promise<{ id?: string } | Response> {
  const config = turnstileConfig();
  if (config.state === 'off') return {};
  if (config.state === 'misconfigured') return misconfiguredReply();
  const id = await readSessionId(request.headers.get('cookie'), config.sessionSecret, Date.now());
  if (id) return { id };
  return Response.json({ error: VERIFY_REPLY_JA, verify: { siteKey: config.siteKey } }, { status: 401 });
}

const isLocalHostname = (hostname: string): boolean =>
  ['localhost', '127.0.0.1', '[::1]'].includes(hostname) || hostname.endsWith('.localhost');

/** このサイトのホスト名（request.url と Host ヘッダー。開発環境では違う形で届くことがある） */
function siteHostnames(request: Request): string[] {
  const names = [new URL(request.url).hostname];
  const host = request.headers.get('host');
  if (host) {
    try {
      names.push(new URL(`http://${host}`).hostname);
    } catch {
      // 形の違う Host は使わない
    }
  }
  return names;
}

/** Turnstile のトークンを Cloudflare に確かめる（1回だけ使える）。Cloudflare に届かなければ 'unavailable' */
async function verifyTurnstileToken(
  config: Extract<TurnstileConfig, { state: 'on' }>,
  token: string,
  request: Request
): Promise<boolean | 'unavailable'> {
  let data: { success?: unknown; hostname?: unknown; action?: unknown; 'error-codes'?: unknown };
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      // 解いたブラウザの IP も渡す（別の場所で解いたトークンの使い回しを、Cloudflare が見分けやすくする）。
      // Cloudflare が付けた IP だけ（無ければ渡さない）
      body: new URLSearchParams({
        secret: config.secret,
        response: token,
        ...(request.headers.get('cf-connecting-ip') && { remoteip: request.headers.get('cf-connecting-ip')! }),
      }),
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel();
      console.error(`Turnstile siteverify failed: status ${res.status}`);
      return 'unavailable';
    }
    data = await res.json();
  } catch (err) {
    console.error('Turnstile siteverify failed:', err instanceof Error ? err.message : err);
    return 'unavailable';
  }
  if (data.success !== true) {
    // エラーの種類だけを出す（トークンは出さない）
    const codes = Array.isArray(data['error-codes']) ? data['error-codes'].filter((c) => typeof c === 'string') : [];
    console.warn('Turnstile token rejected:', codes.join(',') || 'unknown');
    return false;
  }
  // テスト用の秘密キーは hostname・action を返さないので、手元の開発環境でだけ確かめずに通す
  // （本番のホスト名では通らない。テスト用のキーのまま公開しても、だれも有料の API を使えないだけ）。
  // 開発環境かどうかは request.url で決める（利用者が書き換えられる Host ヘッダーは使わない）
  if (config.testSecret) {
    warnOnceInProduction('turnstile-test-secret', 'TURNSTILE_SECRET_KEY is a Turnstile test key.');
    return isLocalHostname(new URL(request.url).hostname);
  }
  return data.action === TURNSTILE_ACTION && typeof data.hostname === 'string' && siteHostnames(request).includes(data.hostname);
}

/** POST /api/session の本体：Turnstile のトークンを確かめ、セッションの Cookie を付ける */
export async function startSession(request: Request, token: unknown): Promise<Response> {
  const config = turnstileConfig();
  if (config.state === 'off') return Response.json({ ok: true });
  if (config.state === 'misconfigured') return misconfiguredReply();
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return Response.json({ error: VERIFY_FAILED_JA }, { status: 400 });
  }
  const verified = await verifyTurnstileToken(config, token, request);
  if (verified === 'unavailable') return Response.json({ error: UNAVAILABLE_JA }, { status: 503 });
  if (!verified) return Response.json({ error: VERIFY_FAILED_JA }, { status: 403 });
  const value = await createSessionValue(config.sessionSecret, Date.now());
  return Response.json(
    { ok: true },
    {
      headers: {
        'Set-Cookie': `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
        'Cache-Control': 'no-store',
      },
    }
  );
}
