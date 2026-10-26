/**
 * ブラウザから API を呼ぶ fetch。サーバーがブラウザの確認（401 と Turnstile のサイトキー）を求めたら、
 * Turnstile を解いて POST /api/session でセッションの Cookie をもらい、1回だけ頼み直す（src/lib/server/session.ts）。
 * - 同時に何件 401 になっても、Turnstile は1回だけ出す
 * - Turnstile はふつう画面に出ない。疑わしいときだけ、画面の上にチェックボックスと案内が出る
 *   （入力欄・送信ボタンに重ならないように上。ダイアログが開いていればその中に出す。外だと押せない）
 * - 確認できなければ、最初の 401 の応答をそのまま返す（呼び出し側のエラー表示になる）
 */

import { hasConsented } from '@/lib/consent';
import { parseSpendLimit, SPEND_LIMIT_HEADER } from '@/lib/spend-limit';
import { noteSpendLimit } from './spend-limit-store';

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** チェックボックスを押してもらう時間も含めた、確認を待つ上限 */
const VERIFY_TIMEOUT_MS = 120_000;
/** Turnstile のスクリプトの読み込みを待つ上限（届かない回線で、確認を待ち続けないように） */
const SCRIPT_TIMEOUT_MS = 10_000;
/** POST /api/session を待つ上限 */
const SESSION_TIMEOUT_MS = 15_000;

/** 時間切れの signal（AbortSignal.timeout の無いブラウザ：iOS 16 より前でも動くように） */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms);
  return controller.signal;
}

/** どれかが中断されたら中断する signal（AbortSignal.any の無いブラウザでも） */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}
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
    // 次の確認でもう一度読み込む（広告ブロッカー・回線の一時的な失敗・届かないまま止まった読み込み）
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      scriptLoading = null;
      resolve(null);
    };
    const timer = setTimeout(fail, SCRIPT_TIMEOUT_MS);
    script.onload = () => {
      clearTimeout(timer);
      resolve(window.turnstile ?? null);
    };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return scriptLoading;
}

/** Turnstile を置く場所：画面の上の、名前の付いた領域。開いているダイアログがあればその中（外は押せない） */
function createWidgetContainer(): { container: HTMLElement; slot: HTMLElement; showNotice: () => void } {
  const container = document.createElement('div');
  container.style.cssText =
    'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:1000;max-width:calc(100% - 32px);';
  const notice = document.createElement('p');
  notice.setAttribute('role', 'alert');
  notice.style.cssText = 'margin:0 0 8px;font-size:14px;font-weight:600;color:#1a2e26;';
  const slot = document.createElement('div');
  container.append(notice, slot);
  (document.querySelector('dialog[open]') ?? document.body).appendChild(container);
  return {
    container,
    slot,
    // チェックボックスを押してもらうときだけ、案内と背景を出す（ふつうは見えないまま終わる）
    showNotice: () => {
      // 見えるときだけ名前の付いた領域にする（ふつうは見えないまま終わるので、空の領域を読み上げさせない）
      container.setAttribute('role', 'region');
      container.setAttribute('aria-label', 'ブラウザの確認');
      notice.textContent = '続けるには、下の確認のチェックボックスを押してください。';
      container.style.background = '#ffffff';
      container.style.padding = '12px';
      container.style.borderRadius = '12px';
      container.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
    },
  };
}

/** Turnstile を解いてトークンを得る。解けなければ null */
async function solveTurnstile(siteKey: string): Promise<string | null> {
  const turnstile = await loadTurnstile();
  if (!turnstile) return null;
  const { container, slot, showNotice } = createWidgetContainer();
  let widgetId: string | undefined;
  try {
    return await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => done(null), VERIFY_TIMEOUT_MS);
      // ダイアログの中に置いたまま、そのダイアログが閉じられたら、押せないので確認をやめる（次の要求で出し直す）
      const watch = setInterval(() => {
        if (!container.isConnected) done(null);
      }, 1_000);
      const done = (token: string | null) => {
        clearTimeout(timer);
        clearInterval(watch);
        resolve(token);
      };
      widgetId = turnstile.render(slot, {
        sitekey: siteKey,
        action: TURNSTILE_ACTION,
        appearance: 'interaction-only',
        language: 'ja',
        callback: (token: string) => done(token),
        'before-interactive-callback': showNotice,
        'error-callback': () => done(null),
        'expired-callback': () => done(null),
        'timeout-callback': () => done(null),
      });
      if (!widgetId) done(null);
    });
  } finally {
    if (widgetId) turnstile.remove(widgetId);
    container.remove();
  }
}

/** Turnstile を解いてセッションを始める（同時の呼び出しは同じ確認を待つ） */
function verifyBrowser(siteKey: string): Promise<boolean> {
  verifying ??= (async () => {
    // 利用規約・Cookie の使用に同意する前は、Turnstile を読み込まず、セッションの Cookie も発行しない
    if (!hasConsented()) return false;
    const token = await solveTurnstile(siteKey);
    if (!token) return false;
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      // 止まった要求で、確認（とそれを待つすべての要求）を待ち続けない
      signal: timeoutSignal(SESSION_TIMEOUT_MS),
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

/** 1回の要求の init。timeoutMs があれば、呼び出し側の signal と時間切れのどちらでも中断する */
function withTimeout(init: RequestInit | undefined, timeoutMs: number | undefined): RequestInit | undefined {
  if (!timeoutMs) return init;
  const timeout = timeoutSignal(timeoutMs);
  return { ...init, signal: init?.signal ? anySignal([init.signal, timeout]) : timeout };
}

/** 同意する前の要求への応答の文（チャット等は、失敗の応答の error をそのまま出す） */
export const CONSENT_REQUIRED_MESSAGE =
  '利用規約とプライバシーポリシー（Cookie の使用を含む）に同意すると使えます。画面の確認で「同意して利用を始める」を押してください。';

/** 同意する前の要求には、サーバーに送らずにこの応答を返す（Cookie も Turnstile も始めない） */
function consentRequiredResponse(): Response {
  return new Response(JSON.stringify({ error: CONSENT_REQUIRED_MESSAGE }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * API を呼ぶ（body は文字列にしておく。頼み直すときに同じ本文を送るため）。
 * timeoutMs は1回の要求ごとの上限（チェックボックスを押してもらう間は数えない）。超えたら TimeoutError。
 * 利用規約・Cookie の使用に同意する前は送らない（src/lib/consent.ts）
 */
export async function apiFetch(input: string, init?: RequestInit, options: { timeoutMs?: number } = {}): Promise<Response> {
  if (!hasConsented()) return consentRequiredResponse();
  const epoch = sessionEpoch;
  const res = await fetch(input, withTimeout(init, options.timeoutMs));
  if (res.status !== 401) return noticeSpendLimit(res);
  const siteKey = await siteKeyFrom(res);
  if (!siteKey) return res;
  // この要求を送った後にセッションが始まっていれば、確認せずに頼み直す
  if (sessionEpoch === epoch && !(await waitForVerification(siteKey, init?.signal))) return res;
  return noticeSpendLimit(await fetch(input, withTimeout(init, options.timeoutMs)));
}

/** 有料の呼び出しが上限で断られた応答なら、画面に案内を出す（src/lib/spend-limit.ts） */
function noticeSpendLimit(res: Response): Response {
  const limit = parseSpendLimit(res.headers.get(SPEND_LIMIT_HEADER));
  if (limit) noteSpendLimit(limit);
  return res;
}
