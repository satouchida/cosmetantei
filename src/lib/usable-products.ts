import { Product, UserRoutineState } from './types';
import { isSellerTextProduct, isUserLabelProduct } from './product-source';
import { isValidProduct, MAX_ROUTINE_PRODUCTS } from './product-validation';
import { createBrowserStore } from './client/browser-store';

/**
 * 「使えるコスメ」のリスト（ブラウザ側。docs/plans/two-lists.md）。
 * 比較（肌荒れしたコスメと比べて原因の候補を絞り込む）にはすべての製品を、組み合わせチェックには今も使っている製品
 * （inUse）だけを使う。この端末のブラウザ（localStorage）にだけ保存し、サーバーには保存しない。
 * 追加した日を持ち、今も使っている製品は 3か月以上たつと「今も使っているか」確かめてもらう
 *
 * - ユーザーが入力した成分表示の製品（ingredientSource が user_label、ID が label_ で始まる）と、お店の商品説明から
 *   成分を読んだ製品（楽天・Yahoo!）は保存しない。サンプルの製品（sessionOnly）も保存しない。画面には残るが、
 *   再読み込みで消える
 * - 以前の「今使っているコスメ」（cosmetantei:current-use:v1）は、最初に読むときに移して消す（今も使っている製品として）
 * - 保存できない環境（プライベートウィンドウ、サイトデータのブロック）では、保存せずに動く
 */

export interface UsableEntry {
  product: Product;
  /** リストに追加した（または「今も使っている」と確かめた）日時（ミリ秒） */
  addedAt: number;
  /** 今も使っている（組み合わせチェックに使う）。false は「以前使っていた」（比較にだけ使う） */
  inUse: boolean;
  /** このページを開いている間だけ（サンプルの製品。保存しない） */
  sessionOnly?: true;
}

export const USABLE_STORAGE_KEY = 'cosmetantei:usable:v1';
/** 以前の「今使っているコスメ」の保存先（移して消す） */
export const LEGACY_CURRENT_USE_KEY = 'cosmetantei:current-use:v1';
/** サーバーが受け付ける1つのリストの上限と同じ */
export const MAX_USABLE = MAX_ROUTINE_PRODUCTS;
/** この月数より前に追加した、今も使っている製品は、今も使っているか確かめてもらう */
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

/** 保存してよい製品（入力した成分表示・お店の商品説明から読んだ成分は保存しない） */
export function isPersistable(product: Product): boolean {
  // お店の商品説明から読んだ成分：楽天は規約（第10条 (9)）で保存できない。Yahoo! の分は、サーバーが30日まで
  // 出典とクレジットを付けて出すだけにし、ブラウザ・書き出したファイルには残さない（LINEヤフー共通利用規約 8.1・8.3。
  // オーナーの判断 2026-10-31）
  return !isUserLabelProduct(product) && !isSellerTextProduct(product);
}

/**
 * サーバーに送る形（docs/plans/two-lists.md）：比較（safeProducts）には使えるコスメのすべて（以前使っていた製品も）、
 * 組み合わせチェック（currentlyUsing）には今も使っている製品だけ
 */
export function routineFromLists(badProducts: Product[], usable: readonly UsableEntry[]): UserRoutineState {
  return {
    badProducts,
    safeProducts: usable.map((e) => e.product),
    currentlyUsing: usable.filter((e) => e.inUse).map((e) => e.product),
  };
}

/** 保存する項目（保存しない製品・このページだけの製品を除く） */
const isSaved = (e: UsableEntry): boolean => !e.sessionOnly && isPersistable(e.product);

/**
 * 保存された文字列を読む。サーバーが受け付けない製品（isValidProduct）・重複・上限を超えた分・
 * 入力した成分表示は捨てる（1つでも受け付けられない製品があると、チェックのたびに失敗するため）。
 * inUse の無い項目（以前の「今使っているコスメ」）は、今も使っている製品として読む
 */
export function parseUsable(raw: string | null): UsableEntry[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const entries: UsableEntry[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const { product, addedAt, inUse } = item as Record<string, unknown>;
    if (!isValidProduct(product) || !isPersistable(product)) continue;
    if (typeof addedAt !== 'number' || !Number.isFinite(addedAt) || addedAt <= 0) continue;
    if (entries.some((e) => e.product.id === product.id)) continue;
    entries.push({ product, addedAt, inUse: inUse !== false });
    if (entries.length >= MAX_USABLE) break;
  }
  return entries;
}

export function serializeUsable(entries: UsableEntry[]): string {
  return JSON.stringify(entries.filter(isSaved).map(({ product, addedAt, inUse }) => ({ product, addedAt, inUse })));
}

// ブラウザの中の保存先（useSyncExternalStore で読む。src/lib/client/browser-store.ts）。保存できない環境でも、
// このページを開いている間はメモリの値を使う。保存しない製品はメモリにだけ持つ
const EMPTY: UsableEntry[] = [];
const store = createBrowserStore<UsableEntry[]>({
  key: USABLE_STORAGE_KEY,
  legacyKey: LEGACY_CURRENT_USE_KEY,
  parse: parseUsable,
  serialize: serializeUsable,
  // ほかのタブで変えたときは保存された値を読み直す（このタブで追加した、保存しない製品は後ろに残す）
  merge: (stored, current) => {
    const kept = (current ?? []).filter((e) => !isSaved(e));
    return [...stored.filter((e) => !kept.some((k) => k.product.id === e.product.id)), ...kept].slice(0, MAX_USABLE);
  },
});

export const subscribeUsable = store.subscribe;
export const getUsableSnapshot = store.getSnapshot;
export const setUsable = store.set;

/** サーバーでの描画では空（保存はブラウザにしか無い） */
export function getUsableServerSnapshot(): UsableEntry[] {
  return EMPTY;
}

/** 最新のリストから変える（再描画の前に2回押されても、先の変更を消さない） */
export function updateUsable(change: (prev: UsableEntry[]) => UsableEntry[]): void {
  setUsable(change(getUsableSnapshot()));
}

/** テスト用：保存先を読み直す状態に戻す */
export const resetUsableForTests = store.resetForTests;
