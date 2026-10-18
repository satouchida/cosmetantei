/**
 * ブラウザから API を呼ぶ fetch。サーバーがブラウザの確認（401 と Turnstile のサイトキー）を求めたら、
 * Turnstile を解いて POST /api/session でセッションの Cookie をもらい、1回だけ頼み直す（src/lib/server/session.ts）。
 * - 同時に何件 401 になっても、Turnstile は1回だけ出す
 * - Turnstile はふつう画面に出ない。疑わしいときだけ、画面の下にチェックボックスが出る
 * - 確認できなければ、最初の 401 の応答をそのまま返す（呼び出し側のエラー表示になる）
 */

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** チェックボックスを押してもらう時間も含めた、確認を待つ上限 */
const VERIFY_TIMEOUT_MS = 120_000;
/** サーバーの TURNSTILE_ACTION と同じ */
const TURNSTILE_ACTION = 'api';

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string | undefined;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptLoading: Promise<TurnstileApi | null> | null = null;
let verifying: Promise<boolean> | null = null;
/** セッションを始められた回数（確認の前に送った要求の 401 が後から届いたら、確認をやり直さずに頼み直す） */
let sessionEpoch = 0;

function loadTurnstile(): Promise<TurnstileApi | null> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptLoading ??= new Promise<TurnstileApi | null>((resolve) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () => resolve(window.turnstile ?? null);
    script.onerror = () => {
      // 次の確認でもう一度読み込む（広告ブロッカー・回線の一時的な失敗）
      script.remove();
      scriptLoading = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return scriptLoading;
}

/** Turnstile を解いてトークンを得る。解けなければ null */
async function solveTurnstile(siteKey: string): Promise<string | null> {
  const turnstile = await loadTurnstile();
  if (!turnstile) return null;
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:1000;';
  document.body.appendChild(container);
  let widgetId: string | undefined;
  try {
    return await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), VERIFY_TIMEOUT_MS);
      const done = (token: string | null) => {
        clearTimeout(timer);
        resolve(token);
      };
      widgetId = turnstile.render(container, {
        sitekey: siteKey,
        action: TURNSTILE_ACTION,
        appearance: 'interaction-only',
        language: 'ja',
        callback: (token: string) => done(token),
        'error-callback': () => done(null),
        'expired-callback': () => done(null),
        'timeout-callback': () => done(null),
      });
    });
  } finally {
    if (widgetId) turnstile.remove(widgetId);
    container.remove();
  }
}

/** Turnstile を解いてセッションを始める（同時の呼び出しは同じ確認を待つ） */
function verifyBrowser(siteKey: string): Promise<boolean> {
  verifying ??= (async () => {
    const token = await solveTurnstile(siteKey);
    if (!token) return false;
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (res.ok) sessionEpoch++;
    return res.ok;
  })()
    .catch(() => false)
    .finally(() => {
      verifying = null;
    });
  return verifying;
}

/** 401 の応答から Turnstile のサイトキーを読む（確認を求める応答でなければ null） */
async function siteKeyFrom(res: Response): Promise<string | null> {
  try {
    const data = await res.clone().json();
    const siteKey = data?.verify?.siteKey;
    return typeof siteKey === 'string' && siteKey ? siteKey : null;
  } catch {
    return null;
  }
}

/** 確認を待つ。要求が中断されたら、確認の終わりを待たずに AbortError にする（確認はほかの要求のために続ける） */
function waitForVerification(siteKey: string, signal?: AbortSignal | null): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const aborted = () => reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    if (signal?.aborted) return aborted();
    signal?.addEventListener('abort', aborted, { once: true });
    verifyBrowser(siteKey)
      .then(resolve)
      .finally(() => signal?.removeEventListener('abort', aborted));
  });
}

/** API を呼ぶ（body は文字列にしておく。頼み直すときに同じ本文を送るため） */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const epoch = sessionEpoch;
  const res = await fetch(input, init);
  if (res.status !== 401) return res;
  const siteKey = await siteKeyFrom(res);
  if (!siteKey) return res;
  // この要求を送った後にセッションが始まっていれば、確認せずに頼み直す
  if (sessionEpoch === epoch && !(await waitForVerification(siteKey, init?.signal))) return res;
  return fetch(input, init);
}
