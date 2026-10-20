import { createBrowserStore } from './client/browser-store';
import { LEGAL_VERSION } from './site';

/**
 * 利用規約・プライバシーポリシー（Cookie の使用を含む）への同意。初めて開いたときの確認画面で同意してもらう。
 * この端末のブラウザ（localStorage）に、同意した規約の版だけを保存する。規約を変えて版を上げたら、もう一度確認する。
 * 同意する前は API を呼ばず、Turnstile も読み込まず、セッションの Cookie も発行しない（src/lib/client/api-fetch.ts）。
 * ほかのタブでサイトデータを消したときは、同意していない状態に戻る（src/lib/client/browser-store.ts）
 */

export const CONSENT_VERSION = LEGAL_VERSION;
export const CONSENT_STORAGE_KEY = 'cosmetantei:consent:v1';

const store = createBrowserStore<boolean>({
  key: CONSENT_STORAGE_KEY,
  parse: (raw) => raw === CONSENT_VERSION,
  serialize: (agreed) => (agreed ? CONSENT_VERSION : ''),
});

export const subscribeConsent = store.subscribe;
export const hasConsented = store.getSnapshot;

/** サーバーでの描画では「まだ分からない」（同意はブラウザにしか無い）。分かるまで画面は操作させない */
export function getConsentServerSnapshot(): boolean | null {
  return null;
}

export function giveConsent(): void {
  store.set(true);
}

/** テスト用：保存先を読み直す状態に戻す */
export const resetConsentForTests = store.resetForTests;
