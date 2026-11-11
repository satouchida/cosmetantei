import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { ChatMessage, Product } from '@/lib/types';
import { getUsableSnapshot, isPersistable, MAX_USABLE, updateUsable, UsableEntry } from '@/lib/usable-products';
import {
  getExportReminderOffServerSnapshot,
  isExportReminderOff,
  shouldOfferExport,
  subscribeExportReminderOff,
} from '@/lib/client/export-reminder';
import { decodeShareFragment, isEmptySnapshot, RoutineSnapshot, shareFragment } from '@/lib/routine-share';
import {
  appendProducts,
  appendStats,
  currentTime,
  IMPORT_FAILED,
  IMPORT_FAILURES,
  ImportRead,
  readRoutineImage,
} from './chat-helpers';
import type { ShowToast } from './useRoutineLists';

/**
 * リストの画像での保存（書き出し）、画像・共有のリンクからの読み込み、比較の結果のあとの「リストを画像で保存しませんか？」。
 * リストの値と処理は useRoutineLists から、開いているダイアログは ChatContainer から受け取る
 */
export function useRoutineTransfer({
  messages,
  showToast,
  setToastMessage,
  setIsSidebarOpen,
  badProducts,
  badRef,
  updateBad,
  usable,
  listsKey,
  listConflict,
  clearTarget,
  isScannerOpen,
  isLabelInputOpen,
  isDrawerModal,
  consented,
}: {
  messages: ChatMessage[];
  showToast: ShowToast;
  setToastMessage: (message: string | null) => void;
  setIsSidebarOpen: (open: boolean) => void;
  badProducts: Product[];
  badRef: RefObject<Product[]>;
  updateBad: (change: (prev: Product[]) => Product[]) => void;
  usable: UsableEntry[];
  listsKey: string;
  listConflict: { product: Product; target: 'bad' | 'usable' } | null;
  clearTarget: 'bad' | 'usable' | null;
  isScannerOpen: boolean;
  isLabelInputOpen: boolean;
  isDrawerModal: boolean;
  consented: boolean | null;
}) {
  // 画像で保存・共有するとき、開いた時点の内容（開いている間にリストが変わっても画像を作り直さない）
  const [routineExport, setRoutineExport] = useState<{ snapshot: RoutineSnapshot; culprits: string[] } | null>(null);
  // 読み込む前に確かめてもらうルーティン
  const [routineImport, setRoutineImport] = useState<{ snapshot: RoutineSnapshot; namesOnly: boolean } | null>(null);
  // 「リストを画像で保存しませんか？」を開いている。このページで1回だけ出す（shownThisSession）
  const [isExportReminderOpen, setIsExportReminderOpen] = useState(false);
  const exportReminderShownRef = useRef(false);
  // 最後に画像で保存したときのリスト（その後で変わっていなければ、おすすめを出さない）
  const exportedListsRef = useRef<string | null>(null);
  // おすすめを出すかを決める、最新の値（描画のたびに入れる。offerExportAfterResult が読む）
  const reminderStateRef = useRef({ badCount: 0, listsKey: '', off: true, otherDialogOpen: false });
  // 「リストを画像で保存しませんか？」を今後表示しない（ほかのタブで選んだときも、購読して読み直す）
  const exportReminderOff = useSyncExternalStore(subscribeExportReminderOff, isExportReminderOff, getExportReminderOffServerSnapshot);

  /**
   * 比較の結果を出したあとに、リストを画像で保存することを1回すすめる（肌荒れしたコスメは保存しないため。
   * docs/plans/two-lists.md の Step 4b）
   */
  // 応答を待った後に呼ばれるので（runChatAction・頼み直しは、押したときの描画の関数）、最新の値を ref から読む
  const offerExportAfterResult = () => {
    const latest = reminderStateRef.current;
    const show = shouldOfferExport({
      shownThisSession: exportReminderShownRef.current,
      badCount: latest.badCount,
      changedSinceExport: exportedListsRef.current !== latest.listsKey,
      off: latest.off,
      otherDialogOpen: latest.otherDialogOpen,
    });
    if (!show) return;
    exportReminderShownRef.current = true;
    setIsExportReminderOpen(true);
  };

  useEffect(() => {
    reminderStateRef.current = {
      // 画像に入る（保存できる）肌荒れしたコスメだけ。入力した成分表示だけなら、画像で保存しても残らない
      badCount: badProducts.filter(isPersistable).length,
      listsKey,
      off: exportReminderOff,
      otherDialogOpen:
        !!routineExport ||
        !!routineImport ||
        !!listConflict ||
        !!clearTarget ||
        isScannerOpen ||
        isLabelInputOpen ||
        isExportReminderOpen ||
        isDrawerModal ||
        consented !== true,
    };
  });

  /** 画像で保存・共有する。気をつけたい成分は、最近の差分分析の結果から */
  const handleExportImage = () => {
    exportedListsRef.current = listsKey;
    const latest = [...messages].reverse().find((m) => m.differentialAnalysis)?.differentialAnalysis;
    setIsSidebarOpen(false);
    setRoutineExport({
      // サンプル（sessionOnly）は書き出さない（読み込むと保存されてしまう）
      snapshot: { badProducts, usable: usable.filter((e) => !e.sessionOnly) },
      culprits: latest?.culprits.map((c) => c.nameJa) ?? [],
    });
  };

  const offerImport = (found: ImportRead | null) => {
    if (!found || 'failure' in found) {
      showToast(found ? IMPORT_FAILURES[found.failure] : IMPORT_FAILED, 'error');
      return;
    }
    if (isEmptySnapshot(found.snapshot)) {
      showToast('この画像のマイルーティンは空でした（読み込めるコスメがありません）。', 'error');
      return;
    }
    setToastMessage(null);
    setIsSidebarOpen(false);
    setRoutineImport(found);
  };

  // 画像を読んでいる間に、別の画像を選んでも読まない（QR コードを読む要素は1つ）
  const importingRef = useRef(false);
  const handleImportImage = async (file: File) => {
    if (importingRef.current) {
      showToast('前の画像を読み込んでいます。終わってからお試しください。', 'error');
      return;
    }
    importingRef.current = true;
    showToast('画像を読み込んでいます…', 'progress');
    try {
      offerImport(await readRoutineImage(file).catch((): ImportRead => ({ failure: 'failed' })));
    } finally {
      importingRef.current = false;
    }
  };

  /** 共有のリンク（#r=...）・QR コードから読み込む */
  const importFromFragment = async (fragment: string) => {
    const snapshot = await decodeShareFragment(fragment, currentTime());
    offerImport(snapshot ? { snapshot, namesOnly: true } : null);
  };

  const applyImport = (mode: 'append' | 'replace') => {
    if (!routineImport) return;
    const { snapshot } = routineImport;
    let skipped = 0;
    if (mode === 'replace') {
      updateBad(() => snapshot.badProducts);
      updateUsable(() => snapshot.usable.slice(0, MAX_USABLE));
    } else {
      // 1つの製品は1つのリストだけ：どちらかのリストにある製品は足さない（読み込むデータの中でも肌荒れが先）
      // 最新のリストで数える（badRef・getUsableSnapshot）
      const currentBad = badRef.current;
      const currentUsable = getUsableSnapshot();
      const takenIds = () => new Set([...currentBad.map((p) => p.id), ...currentUsable.map((e) => e.product.id)]);
      const taken = takenIds();
      const bad = appendStats(currentBad, snapshot.badProducts, taken);
      const nextBad = appendProducts(currentBad, snapshot.badProducts, takenIds());
      const freshUsable = snapshot.usable.filter((e) => !taken.has(e.product.id)).length;
      const usableAdded = Math.max(0, Math.min(freshUsable, MAX_USABLE - currentUsable.length));
      // 足さなかった数（重複・上限）を、読み込んだ後の案内に出す
      skipped = bad.skipped + (snapshot.usable.length - usableAdded);
      updateBad(() => nextBad);
      updateUsable((prev) => {
        const ids = new Set([...prev.map((e) => e.product.id), ...nextBad.map((p) => p.id)]);
        return [...prev, ...snapshot.usable.filter((e) => !ids.has(e.product.id))].slice(0, MAX_USABLE);
      });
    }
    setRoutineImport(null);
    showToast(
      skipped > 0
        ? `マイルーティンを読み込みました（${skipped}点は、すでに登録済みか上限のため追加しませんでした）`
        : 'マイルーティンを読み込みました'
    );
  };

  // 下の effect が使う、最初の描画の showToast（ChatContainer にあったときと同じ。state の setter と ref だけを使うので、
  // どの描画のものでも同じ働き）。引数で受け取ると eslint には変わりうる値に見えるので、ref に入れて渡す
  const firstShowToastRef = useRef(showToast);
  // 共有のリンク（https://cosmetantei.app/#r=...）で開いたら、読み込むか確かめる。リンクの部分はアドレスから消す。
  // 開いているページでリンクを押したとき（# の後ろだけが変わり、読み込み直さない）も同じ
  useEffect(() => {
    const onHash = () => {
      const fragment = shareFragment(window.location.hash);
      if (!fragment) return;
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
      void decodeShareFragment(fragment, currentTime()).then((snapshot) => {
        if (snapshot && !isEmptySnapshot(snapshot)) setRoutineImport({ snapshot, namesOnly: true });
        else firstShowToastRef.current(IMPORT_FAILED, 'error');
      });
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return {
    routineExport,
    setRoutineExport,
    routineImport,
    setRoutineImport,
    isExportReminderOpen,
    setIsExportReminderOpen,
    offerExportAfterResult,
    handleExportImage,
    handleImportImage,
    importFromFragment,
    applyImport,
  };
}
