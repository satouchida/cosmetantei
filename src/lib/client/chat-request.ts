import { apiFetch } from './api-fetch';

/**
 * POST /api/chat を呼び、応答を「返答」か「利用者に見せる失敗の文」のどちらかにする。
 * - サーバーが文を付けた失敗（429・413・400・500 の reply、401・403・503 の error）は、その文をそのまま出す
 * - JSON でない応答（Workers の 502・524 等）・時間切れ・通信エラーは、決まった文にする
 * - 成功でも reply の無い応答は、読めない応答として扱う（空の吹き出しを出さない）
 */

/** サーバーが重い調べもの（Web リサーチ）をしても返ってくるはずの上限。チェックボックスを押してもらう間は数えない */
export const CHAT_TIMEOUT_MS = 90_000;

export type ChatResponse = Record<string, unknown> & { reply: string };

export type ChatResult =
  | { ok: true; data: ChatResponse }
  | { ok: false; status: number | null; message: string };

// サーバーでは調べものが終わっていることもある（待つのをやめただけ）。同じことを頼み直すと、もう一度調べる
export const TIMEOUT_MESSAGE =
  '時間がかかりすぎたため、待つのをやめました。結果が届いていない場合は、少し時間をおいてもう一度お試しください。';
export const CANCELLED_MESSAGE = '中止しました。もう一度調べるときは、ボタンを押すか入力し直してください。';
export const NETWORK_MESSAGE = '通信できませんでした。インターネットへの接続を確かめて、もう一度お試しください。';
const RATE_LIMIT_MESSAGE = '短い間に続けて送られたため、少し休んでいます。1分ほど待ってから、もう一度お試しください。';
const SERVER_MESSAGE = 'サーバーで問題が起きました。少し時間をおいて、もう一度お試しください。';
const GENERIC_MESSAGE = '通信中にエラーが発生しました。もう一度お試しください。';

const textOf = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** 文の付いていない失敗の、状態コードごとの文 */
function messageForStatus(status: number): string {
  if (status === 429) return RATE_LIMIT_MESSAGE;
  if (status >= 500) return SERVER_MESSAGE;
  return GENERIC_MESSAGE;
}

/** 応答を結果にする（テストのため fetch と分けておく） */
export async function toChatResult(res: Response): Promise<ChatResult> {
  const data: unknown = await res.json().catch((err: unknown) => {
    // 本文を読んでいる途中の時間切れ・中断は postChat に返す（「サーバーの問題」と言わない）。JSON でなければ null
    if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw err;
    return null;
  });
  const body = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  const reply = textOf(body?.reply);
  if (res.ok && body && reply) return { ok: true, data: { ...body, reply } };
  const message = (!res.ok && (reply ?? textOf(body?.error))) || messageForStatus(res.ok ? 500 : res.status);
  return { ok: false, status: res.status, message };
}

/** signal: 利用者が「中止」を押したときに中断する */
export async function postChat(body: Record<string, unknown>, signal?: AbortSignal): Promise<ChatResult> {
  try {
    const res = await apiFetch(
      '/api/chat',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal },
      { timeoutMs: CHAT_TIMEOUT_MS }
    );
    return await toChatResult(res);
  } catch (err) {
    if (signal?.aborted) return { ok: false, status: null, message: CANCELLED_MESSAGE };
    const name = err instanceof Error || err instanceof DOMException ? err.name : '';
    return { ok: false, status: null, message: name === 'TimeoutError' || name === 'AbortError' ? TIMEOUT_MESSAGE : NETWORK_MESSAGE };
  }
}
