'use client';

import React, { type Dispatch, type RefObject, type SetStateAction } from 'react';
import { Camera, Send } from 'lucide-react';
import { Product } from '@/lib/types';
import { LiveSearchCandidateTray } from '../search/LiveSearchCandidateTray';
import { LegalLinks } from '@/components/legal/LegalPage';
import { SpendLimitNotice } from '@/components/chat/SpendLimitNotice';
import { dismissSpendLimit, getSpendLimitSnapshot } from '@/lib/client/spend-limit-store';
import { SEARCH_TRAY_ID } from './chat-helpers';

interface ChatInputBarProps {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  inputRef: RefObject<HTMLInputElement | null>;
  busy: boolean;
  /** 有料の呼び出しが上限で断られたときの案内 */
  spendLimit: ReturnType<typeof getSpendLimitSnapshot>;
  /** 入力欄の文を送る */
  onSubmit: () => void;
  onOpenScanner: () => void;
  /** 入力途中の候補（useTypeahead） */
  isTrayVisible: boolean;
  setIsTrayOpen: (open: boolean) => void;
  clearCandidates: () => void;
  trayCandidates: Product[];
  liveBrands: { name: string; kana?: string }[];
  trayCredits: ('rakuten' | 'yahoo')[];
  onSelectTrayProduct: (product: Product) => void;
  onAddToBad: (product: Product) => void;
  onAddToUsable: (product: Product) => void;
}

/** 入力欄のバー：上限の案内、入力欄（カメラ・送信のボタン）、候補のトレイ、規約などのリンク */
export const ChatInputBar: React.FC<ChatInputBarProps> = ({
  input,
  setInput,
  inputRef,
  busy,
  spendLimit,
  onSubmit,
  onOpenScanner,
  isTrayVisible,
  setIsTrayOpen,
  clearCandidates,
  trayCandidates,
  liveBrands,
  trayCredits,
  onSelectTrayProduct,
  onAddToBad,
  onAddToUsable,
}) => {
  const closeTray = () => {
    setIsTrayOpen(false);
    inputRef.current?.focus();
  };
  /** 入力欄から候補の最初のボタンへ（下矢印キー） */
  const focusTray = () => {
    // 閉じるボタンではなく、最初の候補（ブランドか製品のボタン）へ
    document.getElementById(SEARCH_TRAY_ID)?.querySelector<HTMLElement>('button:not([data-tray-close]), a[href]')?.focus();
  };

  return (
    <div className="px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 bg-surface">
      {/* 候補のトレイは見た目は入力欄の上、Tab の順番は入力欄の後（DOM は入力欄が先） */}
      <div className="max-w-[720px] mx-auto flex flex-col">
        {/* 上限の案内は、候補のトレイ（order-first）の下・入力欄のすぐ上 */}
        {spendLimit && <SpendLimitNotice reason={spendLimit.reason} onDismiss={dismissSpendLimit} />}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="min-h-[52px] p-0.5 flex items-center gap-1 bg-white border-[1.5px] border-outline rounded-full shadow-sm focus-within:border-primary focus-within:outline focus-within:outline-1 focus-within:outline-primary"
        >
          <button
            type="button"
            onClick={onOpenScanner}
            aria-label="バーコードをカメラでスキャン"
            title="バーコードをカメラでスキャン"
            className="w-12 h-12 flex items-center justify-center text-sage-700 bg-surface-container-low hover:bg-surface-container-high rounded-full transition-colors shrink-0"
          >
            <Camera className="w-6 h-6" aria-hidden />
          </button>

          <input
            ref={inputRef}
            id="chat-input"
            type="text"
            value={input}
            // 候補の有無は上のステータスが読み上げる（テキストボックスに aria-expanded は付けられない）
            aria-controls={SEARCH_TRAY_ID}
            onKeyDown={(e) => {
              // 下矢印で候補へ、Escape で候補を閉じる（入力はそのまま）
              // 日本語入力の確定中は使わない（Safari は確定のキーで isComposing が false なので keyCode 229 も見る）
              if (!isTrayVisible || e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                focusTray();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setIsTrayOpen(false);
              }
            }}
            onChange={(e) => {
              const value = e.target.value;
              setInput(value);
              // 入力を消したら前の検索候補を破棄する（次の入力で古い候補が一瞬表示されないように）
              if (!value.trim()) clearCandidates();
            }}
            aria-label="コスメ名を入力"
            placeholder="コスメ名を入力 (例: ちふれ リップ, キュレル泡洗顔, アヌア, メラノCC...)"
            className="flex-1 min-w-0 h-12 px-2 text-sm bg-transparent focus:outline-hidden text-ink placeholder:text-gray-500 truncate"
          />

          <button
            type="submit"
            disabled={!input.trim() || busy}
            aria-label="送信"
            className="w-12 h-12 flex items-center justify-center bg-primary hover:bg-primary-active disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed text-on-primary rounded-full transition-colors shrink-0"
          >
            <Send className="w-5 h-5" aria-hidden />
          </button>
        </form>
        <div className="order-first">
        <LiveSearchCandidateTray
          id={SEARCH_TRAY_ID}
          busy={busy}
          query={input}
          candidates={trayCandidates}
          brands={liveBrands}
          credits={trayCredits}
          onSelectBrand={(brand) => {
            // ブランド名を入れて続けて入力できるようにする（候補はそのブランドの製品に絞り込まれる）
            setInput(`${brand} `);
            inputRef.current?.focus();
          }}
          isOpen={isTrayVisible}
          onClose={closeTray}
          onSelectProduct={onSelectTrayProduct}
          onAddToBad={(product) => {
            onAddToBad(product);
          }}
          onAddToUsable={(product) => {
            onAddToUsable(product);
          }}
        />
        </div>
        <LegalLinks className="justify-center -mb-2" />
      </div>
    </div>
  );
};
