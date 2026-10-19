import 'server-only';
import { getClientIp, getRequestAsn, ipv4Network24 } from './cloudflare';
import { HOSTING_ASNS } from './hosting-networks';
import { checkSession, isNewSession } from './session';
import { BudgetClient, withUsageRoute } from './usage';

/**
 * API ルートの入口（すべての /api/* が通る）。
 * - ほかのサイトのページからの呼び出しを断る。ログインの無いアプリなので、ほかのサイトに訪問者のブラウザから有料の
 *   呼び出しをさせ、訪問者ごとの IP で回数制限をすり抜けられないようにする（サーバーから直接の呼び出しは、
 *   1日あたりの利用者ごとの予算で抑える。src/lib/server/spend-cap.ts）
 *   - ブラウザが付ける Sec-Fetch-Site が same-origin・none 以外なら断る
 *   - Origin がこのサイトでなければ断る。POST の本文は application/json だけ受け付ける（ほかのサイトの JSON の
 *     送信には事前の確認（preflight）が要り、CORS のヘッダーを返さないので届かない）
 * - Turnstile を使う設定なら、確かめたセッションの Cookie が無い呼び出しを断る（src/lib/server/session.ts）
 * - 呼び出した利用者（IP・IPv4 の /24・クラウドの事業者・セッション）を、その中の有料の呼び出しに付ける
 *   （利用者ごとの予算。src/lib/server/spend-cap.ts）
 */

const FORBIDDEN_REPLY = { error: 'このページからの操作だけを受け付けています。' };
const UNSUPPORTED_REPLY = { error: 'リクエストの形式が正しくありません。' };

/** ほかのサイトからの呼び出しなら、断る応答。問題なければ null */
export function crossSiteRejection(request: Request): Response | null {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return Response.json(FORBIDDEN_REPLY, { status: 403 });
  // Sec-Fetch-Site を送らない古いブラウザでも、Origin が付く呼び出しは確かめる（GET も）
  const origin = request.headers.get('origin');
  if (origin && !isSameOrigin(origin, request.url, request.headers.get('host'))) {
    return Response.json(FORBIDDEN_REPLY, { status: 403 });
  }
  if (request.method === 'POST') {
    const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') return Response.json(UNSUPPORTED_REPLY, { status: 415 });
  }
  return null;
}

/**
 * Origin がこのサイトか。request.url が利用者の開いた URL と違う形で届く環境（プロキシの後ろ・開発環境の IP での
 * アクセス）もあるので、Host ヘッダー（ほかのサイトのページからは変えられない）とも比べる
 */
function isSameOrigin(origin: string, requestUrl: string, host: string | null): boolean {
  try {
    const from = new URL(origin);
    return from.origin === new URL(requestUrl).origin || (host !== null && from.host === host);
  } catch {
    return false;
  }
}

/**
 * 要求の利用者ごとの予算のキー（IP は必ず。/24 は IPv4 のとき、事業者はクラウドのとき、セッションは確かめたとき）。
 * 発行したばかりのセッションは、同じキーで小さい上限（new_session）にする
 */
export async function budgetClients(request: Request, sessionId?: string, sessionIssuedAt?: number): Promise<BudgetClient[]> {
  const ip = getClientIp(request.headers);
  const clients: BudgetClient[] = [{ kind: 'ip', key: `ip:${ip}` }];
  const network = ipv4Network24(ip);
  if (network) clients.push({ kind: 'network', key: `net:${network}` });
  const asn = await getRequestAsn();
  if (asn !== undefined && HOSTING_ASNS.has(asn)) clients.push({ kind: 'hosting', key: `asn:${asn}` });
  if (sessionId) {
    const kind = sessionIssuedAt !== undefined && isNewSession(sessionIssuedAt, Date.now()) ? 'new_session' : 'session';
    clients.push({ kind, key: `sess:${sessionId}` });
  }
  return clients;
}

/**
 * API ルートの処理を包む（ほかのサイトからの呼び出し・確かめていないブラウザを断り、利用量・利用者ごとの予算に、
 * ルート名と利用者を付ける）
 */
export function apiRoute<A extends [Request, ...unknown[]]>(route: string, handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    const request = args[0];
    const rejected = crossSiteRejection(request);
    if (rejected) return rejected;
    const session = await checkSession(request);
    if (session instanceof Response) return session;
    return withUsageRoute(route, handler, await budgetClients(request, session.id, session.issuedAt))(...args);
  };
}

export const TOO_LARGE = Symbol('too large');

/**
 * 本文を上限まで読んで JSON にする（Content-Length が無い・偽りの要求でも、上限を超えたら読むのをやめる）。
 * 大きすぎれば TOO_LARGE、JSON でなければ null
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown | typeof TOO_LARGE> {
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) return TOO_LARGE;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
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
