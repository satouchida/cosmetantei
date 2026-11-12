import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MOBILE_QUERY } from './chat-helpers';
import type { ShowToast } from './useRoutineLists';

/**
 * 画面のまわり：下に出す短い案内（トースト）、スマホのルーティン引き出し（開閉・フォーカス・キー操作）、
 * 同意した直後のフォーカス。consented は利用規約・Cookie の使用への同意（null はまだ分からない）
 */
export function usePageChrome({ consented }: { consented: boolean | null }) {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // info: 確認（緑のチェック）/ error: 受け付けなかった・失敗（長めに出す）/ progress: 処理中（終わるまで出す）
  const [toastKind, setToastKind] = useState<'info' | 'error' | 'progress'>('info');
  // 同じ案内を続けて出したときに、前のタイマーで早く消えないようにする
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast: ShowToast = (msg, kind = 'info') => {
    setToastMessage(msg);
    setToastKind(kind);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    // 失敗の案内は読めるよう長めに。処理中の案内は、終わったときの案内で置き換える（念のため 30 秒で消す）
    const duration = kind === 'error' ? 6000 : kind === 'progress' ? 30_000 : 3000;
    toastTimerRef.current = setTimeout(() => setToastMessage(null), duration);
  };

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);

  // 確認画面で同意したら入力欄へ（確認画面を開いたボタンは無いので、閉じても戻す先が無い）。
  // タッチの端末では会話の欄へ（入力欄だとキーボードが開き、iOS では画面がずれる）。
  // 前に同意していた人が開いたとき（null → true）はフォーカスを動かさない
  const wasConsented = useRef(consented);
  useEffect(() => {
    if (wasConsented.current === false && consented) {
      if (window.matchMedia('(pointer: coarse)').matches) mainRef.current?.focus({ preventScroll: true });
      else inputRef.current?.focus();
    }
    wasConsented.current = consented;
  }, [consented]);

  // スマホの幅（Tailwind の lg = 64rem 未満）か。引き出しをモーダルとして扱うかどうかに使う
  const isMobileViewport = useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(MOBILE_QUERY);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false
  );

  // スマホのルーティン引き出し：開いたら閉じるボタンにフォーカスし、Escape で閉じてメニューボタンに戻す
  const isDrawerModal = isSidebarOpen && isMobileViewport;
  // 閉じたらメニューボタンにフォーカスを戻す。ヘッダーの inert が外れて（再描画されて）からでないと移せない
  const closeSidebar = () => {
    setIsSidebarOpen(false);
    requestAnimationFrame(() => menuButtonRef.current?.focus());
  };
  useEffect(() => {
    if (!isDrawerModal) return;
    drawerCloseRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      // 引き出しの上に開いたダイアログ（リストのクリアなど）があれば、Tab・Escape はそのダイアログに任せる
      if (document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') {
        closeSidebar();
        return;
      }
      // Tab で引き出しの外（ブラウザの画面）に出ないよう、最後と最初をつなぐ
      if (e.key !== 'Tab') return;
      const drawer = document.getElementById('routine-drawer');
      if (!drawer) return;
      // 見えているものだけ（隠れた要素が最後だと、そこで一致せず外へ出てしまう）
      const focusables = [
        ...drawer.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
        ),
      ].filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!drawer.contains(active)) {
        // 引き出しの文字をタップした後など、外にあるフォーカスは中に戻す
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isDrawerModal]);

  return {
    toastMessage,
    toastKind,
    setToastMessage,
    showToast,
    isSidebarOpen,
    setIsSidebarOpen,
    isDrawerModal,
    closeSidebar,
    mainRef,
    inputRef,
    menuButtonRef,
    drawerCloseRef,
  };
}
