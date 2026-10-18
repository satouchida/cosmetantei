'use client';

import React, { useEffect, useRef } from 'react';

interface ModalDialogProps {
  /** 見出しの要素の id（読み上げで「〜 ダイアログ」と伝える） */
  labelledBy: string;
  /** Escape キーなどで閉じるとき */
  onClose: () => void;
  /** スマホでは画面下から出すシート（Material 3 のボトムシート）にする */
  sheet?: boolean;
  className?: string;
  /** 開いたボタンが閉じたときに見えなくなっている場合（スマホの引き出しの中など）に、代わりにフォーカスを移す先 */
  fallbackFocus?: () => HTMLElement | null;
  children: React.ReactNode;
}

/** フォーカスを移せる、見えている要素か（visibility: hidden の引き出しの中は移せない） */
function isFocusable(el: HTMLElement | null): el is HTMLElement {
  return !!el && el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert]');
}

/**
 * Material 3 のモーダル。ブラウザの <dialog> を showModal() で開くので、
 * フォーカスは中に閉じ込められ、後ろの画面は操作も読み上げもされず、Escape で閉じられる
 */
export function ModalDialog({ labelledBy, onClose, sheet = false, className = '', fallbackFocus, children }: ModalDialogProps) {
  const ref = useRef<HTMLDialogElement | null>(null);
  // 閉じるときの最新の値を使う（effect は開いたときに1回だけ動く）
  const fallbackRef = useRef(fallbackFocus);
  useEffect(() => {
    fallbackRef.current = fallbackFocus;
  });

  useEffect(() => {
    const dialog = ref.current;
    // 閉じたら開いたボタンにフォーカスを戻す（<dialog> が先に DOM から外れるとブラウザは戻さない）
    // Safari はクリックでボタンにフォーカスしないので body のことがある。そのときは開いたボタンが分からないものとする
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      // 開いたボタンが見えなくなっていたら（引き出しが閉じた等）、代わりの場所へ。どちらも無理なら何もしない
      const target = isFocusable(opener) ? opener : fallbackRef.current?.() ?? null;
      if (isFocusable(target)) target.focus();
    };
  }, []);

  const position = sheet
    ? 'mt-auto mb-0 w-full max-w-none max-h-[92dvh] rounded-t-2xl sm:m-auto sm:max-w-lg sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl'
    : 'm-auto w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] rounded-2xl';

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        // ブラウザに閉じさせず、親の状態で閉じる（開閉の状態を一か所にする）
        e.preventDefault();
        onClose();
      }}
      onClose={(e) => {
        // ブラウザが先に閉じた場合（Escape を続けて押したときなど）も親の状態を合わせる。
        // StrictMode の閉じ直しや、閉じるときの close() では、開き直している／外れているので何もしない
        if (!e.currentTarget.open && e.currentTarget.isConnected) onClose();
      }}
      className={`p-0 bg-white text-ink shadow-2xl overflow-y-auto backdrop:bg-gray-900/40 animate-fade-in ${position} ${className}`}
    >
      {children}
    </dialog>
  );
}
