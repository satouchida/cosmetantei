import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Product, UserRoutineState } from '@/lib/types';
import {
  getUsableServerSnapshot,
  getUsableSnapshot,
  isPersistable,
  isStale,
  MAX_USABLE,
  routineFromLists,
  subscribeUsable,
  updateUsable,
} from '@/lib/usable-products';
import { MAX_ROUTINE_PRODUCTS } from '@/lib/product-validation';
import { currentTime } from './chat-helpers';

/** 画面の下に短い案内を出す（ChatContainer の showToast） */
export type ShowToast = (msg: string, kind?: 'info' | 'error' | 'progress') => void;

/**
 * 登録の結果。added：追加した。exists：同じリストにある。conflict：もう一方のリストにある（移す・削除するかを聞く）。
 * full：上限
 */
export type AddResult = 'added' | 'exists' | 'conflict' | 'full';

/** 2つのリスト（肌荒れしたコスメ・使えるコスメ）と、登録・移動・削除・クリアの処理 */
export function useRoutineLists({ showToast }: { showToast: ShowToast }) {
  // もう一方のリストにある製品を登録しようとした（移す・削除するかを聞く。1つの製品は1つのリストだけ）
  const [listConflict, setListConflict] = useState<{ product: Product; target: 'bad' | 'usable' } | null>(null);
  // クリアするリスト（確かめるダイアログを開いている）
  const [clearTarget, setClearTarget] = useState<'bad' | 'usable' | null>(null);

  // 肌荒れしたコスメ（このページを開いている間だけ。保存しない。docs/plans/two-lists.md）。
  // badRef は最新の値（再描画の前に続けて呼ばれても正しく数える。使えるコスメの getUsableSnapshot と同じ役目）。
  // 変えるときは updateBad だけを使う
  const [badProducts, setBadState] = useState<Product[]>([]);
  const badRef = useRef<Product[]>([]);
  const updateBad = (change: (prev: Product[]) => Product[]) => {
    badRef.current = change(badRef.current);
    setBadState(badRef.current);
  };
  // 使えるコスメはこの端末のブラウザに保存する（src/lib/usable-products.ts）。ほかのタブで、このタブの肌荒れした
  // コスメにある製品が使えるコスメに追加されたときは、このタブでは肌荒れしたコスメだけに出す（1つの製品は1つのリスト）
  const storedUsable = useSyncExternalStore(subscribeUsable, getUsableSnapshot, getUsableServerSnapshot);
  const usable = useMemo(() => {
    const badIds = new Set(badProducts.map((p) => p.id));
    return storedUsable.some((e) => badIds.has(e.product.id)) ? storedUsable.filter((e) => !badIds.has(e.product.id)) : storedUsable;
  }, [storedUsable, badProducts]);
  // サーバーに送る形：比較には使えるコスメのすべて、組み合わせチェックには今も使っているものだけ
  const routine: UserRoutineState = routineFromLists(badProducts, usable);
  // 代わりの商品のカードに出さない、登録した製品（RegisteredProducts.tsx）
  const registeredProducts = useMemo(() => [...badProducts, ...usable.map((e) => e.product)], [badProducts, usable]);
  // 今も使っている製品のうち、3か月以上前に追加したもの（今も使っているか確かめてもらう）
  const staleEntries = usable.filter((e) => e.inUse && isStale(e.addedAt, currentTime()));
  const staleIds = new Set(staleEntries.map((e) => e.product.id));
  // 2つのリストの中身（画像で保存した後で変わったかを比べる）
  const listsKey = `${badProducts.map((p) => p.id).join(',')}|${usable.map((e) => e.product.id).join(',')}`;

  /** 肌荒れしたコスメに追加する。使えるコスメにあれば、移すか削除するかを聞く（1つの製品は1つのリストだけ） */
  const handleAddToBad = (product: Product): AddResult => {
    if (badRef.current.some((p) => p.id === product.id)) {
      showToast('すでに肌荒れしたコスメに登録されています', 'error');
      return 'exists';
    }
    // 上限なら、移すことも勧めない（移せないのに、移すかを聞かない）
    if (badRef.current.length >= MAX_ROUTINE_PRODUCTS) {
      showToast(`肌荒れしたコスメは${MAX_ROUTINE_PRODUCTS}点まで登録できます`, 'error');
      return 'full';
    }
    if (getUsableSnapshot().some((e) => e.product.id === product.id)) {
      setListConflict({ product, target: 'bad' });
      return 'conflict';
    }
    updateBad((prev) => [...prev, product]);
    showToast(`「${product.name}」を【肌荒れしたコスメ】に追加しました`);
    return 'added';
  };

  /** 使えるコスメに追加する（今も使っている製品として）。肌荒れしたコスメにあれば、移すか削除するかを聞く */
  const handleAddToUsable = (product: Product): AddResult => {
    // 再描画の前に続けて押されても正しく数えるよう、最新のリストで確かめる
    const latest = getUsableSnapshot();
    const inBad = badRef.current.some((p) => p.id === product.id);
    // このタブの肌荒れしたコスメにある製品は、ほかのタブで使えるコスメに保存されていても、移すかを聞く
    if (!inBad && latest.some((e) => e.product.id === product.id)) {
      showToast('すでに使えるコスメに登録されています', 'error');
      return 'exists';
    }
    if (latest.length >= MAX_USABLE && !latest.some((e) => e.product.id === product.id)) {
      showToast(`使えるコスメは${MAX_USABLE}点まで登録できます`, 'error');
      return 'full';
    }
    if (inBad) {
      setListConflict({ product, target: 'usable' });
      return 'conflict';
    }
    const addedAt = currentTime();
    updateUsable((prev) => [...prev, { product, addedAt, inUse: true }]);
    showToast(
      isPersistable(product)
        ? `「${product.name}」を【使えるコスメ】に追加しました`
        : `「${product.name}」を【使えるコスメ】に追加しました（入力した成分表示・お店の商品説明から読んだ成分は保存しません）`
    );
    return 'added';
  };

  /** もう一方のリストにある製品を、登録しようとしたリストへ移す */
  const moveToList = (product: Product, target: 'bad' | 'usable') => {
    setListConflict(null);
    // 移す先が上限なら、何も消さずに案内だけ出す（ダイアログを開いている間に、ほかで追加されたとき）
    if (target === 'bad') {
      if (badRef.current.length >= MAX_ROUTINE_PRODUCTS && !badRef.current.some((p) => p.id === product.id)) {
        showToast(`肌荒れしたコスメは${MAX_ROUTINE_PRODUCTS}点まで登録できます`, 'error');
        return;
      }
      updateUsable((prev) => prev.filter((e) => e.product.id !== product.id));
      updateBad((prev) => (prev.some((p) => p.id === product.id) ? prev : [...prev, product]));
      showToast(`「${product.name}」を【肌荒れしたコスメ】に移しました`);
    } else {
      const latest = getUsableSnapshot();
      if (latest.length >= MAX_USABLE && !latest.some((e) => e.product.id === product.id)) {
        showToast(`使えるコスメは${MAX_USABLE}点まで登録できます`, 'error');
        return;
      }
      updateBad((prev) => prev.filter((p) => p.id !== product.id));
      updateUsable((prev) =>
        prev.some((e) => e.product.id === product.id) ? prev : [...prev, { product, addedAt: currentTime(), inUse: true }]
      );
      showToast(`「${product.name}」を【使えるコスメ】に移しました`);
    }
  };

  /** もう一方のリストにある製品を、そのリストから削除する（どちらのリストにも入れない） */
  const removeFromOtherList = (product: Product, target: 'bad' | 'usable') => {
    setListConflict(null);
    if (target === 'bad') {
      updateUsable((prev) => prev.filter((e) => e.product.id !== product.id));
      showToast(`「${product.name}」を使えるコスメから削除しました`);
    } else {
      updateBad((prev) => prev.filter((p) => p.id !== product.id));
      showToast(`「${product.name}」を肌荒れしたコスメから削除しました`);
    }
  };

  const handleRemoveUsable = (id: string) => {
    updateUsable((prev) => prev.filter((e) => e.product.id !== id));
  };

  /** 「今も使っている」：追加した日を今日にする */
  const handleConfirmUsable = (id: string) => {
    const now = currentTime();
    updateUsable((prev) => prev.map((e) => (e.product.id === id ? { ...e, addedAt: now, inUse: true } : e)));
  };

  /** 今も使っているか。使い始めたとき（false → true）は、追加した日を今日にする（3か月の確認をそこから数える） */
  const handleSetInUse = (id: string, inUse: boolean) => {
    const now = currentTime();
    updateUsable((prev) =>
      prev.map((e) => (e.product.id === id && e.inUse !== inUse ? { ...e, inUse, ...(inUse && { addedAt: now }) } : e))
    );
  };

  const handleRemoveBad = (id: string) => {
    updateBad((prev) => prev.filter((p) => p.id !== id));
  };

  /** リストをクリアする（確かめるダイアログで「クリアする」を押したとき） */
  const clearList = (target: 'bad' | 'usable') => {
    setClearTarget(null);
    if (target === 'bad') {
      updateBad(() => []);
      showToast('肌荒れしたコスメのリストをクリアしました');
    } else {
      updateUsable(() => []);
      showToast('使えるコスメのリストをクリアしました');
    }
  };

  return {
    badProducts,
    badRef,
    updateBad,
    usable,
    routine,
    registeredProducts,
    staleEntries,
    staleIds,
    listsKey,
    listConflict,
    setListConflict,
    clearTarget,
    setClearTarget,
    handleAddToBad,
    handleAddToUsable,
    moveToList,
    removeFromOtherList,
    handleRemoveUsable,
    handleConfirmUsable,
    handleSetInUse,
    handleRemoveBad,
    clearList,
  };
}
