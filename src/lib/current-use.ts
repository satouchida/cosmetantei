import { Product } from './types';
import { isShopListingProduct, isUserLabelProduct } from './product-source';
import { isValidProduct, MAX_ROUTINE_PRODUCTS } from './product-validation';
import { createBrowserStore } from './client/browser-store';

/**
 * 「今使っているコスメ」のリスト（ブラウザ側）。
 * 組み合わせチェックに使う。この端末のブラウザ（localStorage）にだけ保存し、サーバーには保存しない。
 * 追加した日を持ち、3か月以上たった製品は「今も使っているか」確かめてもらう
 *
 * - ユーザーが入力した成分表示の製品（ingredientSource が user_label、ID が label_ で始まる）は保存しない。
 *   画面には残るが、再読み込みで消える
 * - 保存できない環境（プライベートウィンドウ、サイトデータのブロック）では、保存せずに動く
 */

export interface CurrentUseEntry {
  product: Product;
  /** リストに追加した（または「今も使っている」と確かめた）日時（ミリ秒） */
  addedAt: number;
}

export const CURRENT_USE_STORAGE_KEY = 'cosmetantei:current-use:v1';
/** サーバーが受け付ける1つのリストの上限と同じ */
export const MAX_CURRENT_USE = MAX_ROUTINE_PRODUCTS;
/** この月数より前に追加した製品は、今も使っているか確かめてもらう */
export const STALE_AFTER_MONTHS = 3;

/** 追加してから STALE_AFTER_MONTHS か月以上たっている（11月30日の3か月後は2月の末日） */
export function isStale(addedAt: number, now: number): boolean {
  const due = new Date(addedAt);
  const day = due.getDate();
  due.setDate(1);
  due.setMonth(due.getMonth() + STALE_AFTER_MONTHS);
  const lastDay = new Date(due.getFullYear(), due.getMonth() + 1, 0).getDate();
  due.setDate(Math.min(day, lastDay));
  return due.getTime() <= now;
}

/** 保存してよい製品（入力した成分表示は保存しない） */
export function isPersistable(product: Product): boolean {
  // お店の商品説明から読んだ成分は、楽天の規約で保存できない
  return !isUserLabelProduct(product) && !isShopListingProduct(product);
}

/**
 * 保存された文字列を読む。サーバーが受け付けない製品（isValidProduct）・重複・上限を超えた分・
 * 入力した成分表示は捨てる（1つでも受け付けられない製品があると、チェックのたびに失敗するため）
 */
export function parseCurrentUse(raw: string | null): CurrentUseEntry[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const entries: CurrentUseEntry[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const { product, addedAt } = item as Record<string, unknown>;
    if (!isValidProduct(product) || !isPersistable(product)) continue;
    if (typeof addedAt !== 'number' || !Number.isFinite(addedAt) || addedAt <= 0) continue;
    if (entries.some((e) => e.product.id === product.id)) continue;
    entries.push({ product, addedAt });
    if (entries.length >= MAX_CURRENT_USE) break;
  }
  return entries;
}

export function serializeCurrentUse(entries: CurrentUseEntry[]): string {
  return JSON.stringify(entries.filter((e) => isPersistable(e.product)));
}

// ブラウザの中の保存先（useSyncExternalStore で読む。src/lib/client/browser-store.ts）。保存できない環境でも、
// このページを開いている間はメモリの値を使う。入力した成分表示の製品はメモリにだけ持つ
const EMPTY: CurrentUseEntry[] = [];
const store = createBrowserStore<CurrentUseEntry[]>({
  key: CURRENT_USE_STORAGE_KEY,
  parse: parseCurrentUse,
  serialize: serializeCurrentUse,
  // ほかのタブで変えたときは保存された値を読み直す（このタブで追加した、保存しない製品は後ろに残す）
  merge: (stored, current) => {
    const kept = (current ?? []).filter((e) => !isPersistable(e.product));
    return [...stored.filter((e) => !kept.some((k) => k.product.id === e.product.id)), ...kept].slice(0, MAX_CURRENT_USE);
  },
});

export const subscribeCurrentUse = store.subscribe;
export const getCurrentUseSnapshot = store.getSnapshot;
export const setCurrentUse = store.set;

/** サーバーでの描画では空（保存はブラウザにしか無い） */
export function getCurrentUseServerSnapshot(): CurrentUseEntry[] {
  return EMPTY;
}

/** 最新のリストから変える（再描画の前に2回押されても、先の変更を消さない） */
export function updateCurrentUse(change: (prev: CurrentUseEntry[]) => CurrentUseEntry[]): void {
  setCurrentUse(change(getCurrentUseSnapshot()));
}

/** テスト用：保存先を読み直す状態に戻す */
export const resetCurrentUseForTests = store.resetForTests;
