import { createBrowserStore } from './browser-store';

/**
 * 「リストを画像で保存しませんか？」のおすすめ（docs/plans/two-lists.md の Step 4b）。
 * 肌荒れしたコスメのリストは保存しないので、比較の結果を出したときに、画像で保存しておくことを1回すすめる。
 * 「今後このお知らせを表示しない」を選んだことだけを、この端末のブラウザ（localStorage）に保存する（製品の情報は入れない）
 */

export const EXPORT_REMINDER_STORAGE_KEY = 'cosmetantei:export-reminder:v1';

const store = createBrowserStore<boolean>({
  key: EXPORT_REMINDER_STORAGE_KEY,
  parse: (raw) => raw === 'off',
  serialize: (off) => (off ? 'off' : ''),
});

export const subscribeExportReminderOff = store.subscribe;
/** 「今後このお知らせを表示しない」を選んだ */
export const isExportReminderOff = store.getSnapshot;
/** サーバーでの描画では「表示しない」（ブラウザで読むまで出さない） */
export const getExportReminderOffServerSnapshot = (): boolean => true;

export function turnOffExportReminder(): void {
  store.set(true);
}

/** テスト用：保存先を読み直す状態に戻す */
export const resetExportReminderForTests = store.resetForTests;

/**
 * 比較の結果を出したときに、おすすめを出すか。
 * このページで出したことが無い・肌荒れしたコスメがある・前に画像で保存してからリストが変わった・
 * 「表示しない」を選んでいない・ほかのダイアログを開いていない、のすべてのとき
 */
export function shouldOfferExport(state: {
  shownThisSession: boolean;
  badCount: number;
  changedSinceExport: boolean;
  off: boolean;
  otherDialogOpen: boolean;
}): boolean {
  return !state.shownThisSession && state.badCount > 0 && state.changedSinceExport && !state.off && !state.otherDialogOpen;
}
