/**
 * 利用規約・プライバシーポリシー（Cookie の使用を含む）への同意。初めて開いたときの確認画面で同意してもらう。
 * この端末のブラウザ（localStorage）に、同意した規約の版だけを保存する。規約を変えて版を上げたら、もう一度確認する。
 * 同意する前は Turnstile を読み込まず、セッションの Cookie も発行しない（src/lib/client/api-fetch.ts）
 */

/** 規約の版（制定日・改定日）。src/app/terms・src/app/privacy の日付と合わせる */
export const CONSENT_VERSION = '2026-10-20';
export const CONSENT_STORAGE_KEY = 'cosmetantei:consent:v1';

// 保存できない環境（プライベートブラウズ等）でも、このページを開いている間は同意したものとして使う
let memory: boolean | null = null;
const listeners = new Set<() => void>();

function readStorage(): boolean {
  try {
    return window.localStorage.getItem(CONSENT_STORAGE_KEY) === CONSENT_VERSION;
  } catch {
    return false;
  }
}

/** ほかのタブで同意したら、このタブの確認画面も閉じる */
function onStorage(event: StorageEvent): void {
  if (event.key !== CONSENT_STORAGE_KEY && event.key !== null) return;
  if (readStorage()) {
    memory = true;
    for (const listener of listeners) listener();
  }
}

export function subscribeConsent(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

export function hasConsented(): boolean {
  if (memory === null) memory = readStorage();
  return memory;
}

/** サーバーでの描画では確認画面を出さない（同意はブラウザにしか無い。表示はブラウザで判断する） */
export function getConsentServerSnapshot(): boolean {
  return true;
}

export function giveConsent(): void {
  memory = true;
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, CONSENT_VERSION);
  } catch {
    // 保存できない環境では、このページを開いている間だけ
  }
  for (const listener of listeners) listener();
}
