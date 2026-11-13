'use client';

import React, { type RefObject } from 'react';
import { FileText, Menu, ScanBarcode } from 'lucide-react';
import { STALE_AFTER_MONTHS } from '@/lib/usable-products';

interface ChatHeaderProps {
  /** スマホの引き出しの中のボタンから開いたダイアログを閉じたときの、フォーカスの戻り先 */
  scanButtonRef: RefObject<HTMLButtonElement | null>;
  labelButtonRef: RefObject<HTMLButtonElement | null>;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  isDrawerModal: boolean;
  isSidebarOpen: boolean;
  /** 2つのリストの点数の合計 */
  routineCount: number;
  /** 3か月以上前に追加した、今も使っている使えるコスメの数 */
  staleCount: number;
  onOpenScanner: () => void;
  onOpenLabelInput: () => void;
  onToggleSidebar: () => void;
}

/** 上のバー：ロゴ、バーコード読取・成分表示の入力のボタン、スマホのマイルーティンのボタン（数のバッジつき） */
export const ChatHeader: React.FC<ChatHeaderProps> = ({
  scanButtonRef,
  labelButtonRef,
  menuButtonRef,
  isDrawerModal,
  isSidebarOpen,
  routineCount,
  staleCount,
  onOpenScanner,
  onOpenLabelInput,
  onToggleSidebar,
}) => (
    <header inert={isDrawerModal} className="h-14 shrink-0 bg-white border-b border-sand-200 pl-3 pr-1 sm:px-4 flex items-center justify-between gap-2 z-10">
      <div className="flex items-center gap-2 min-w-0">
        {/* eslint-disable-next-line @next/next/no-img-element -- 小さな SVG のロゴ。画像最適化は不要 */}
        <img src="/icon.svg" alt="" width={36} height={36} className="w-9 h-9 shrink-0" />
        <div className="min-w-0">
          <h1 className="font-bold text-ink text-lg leading-tight tracking-tight truncate">コスメ探偵</h1>
          <p className="text-xs text-ink-muted hidden md:block truncate">
            化粧品選びの参考に、肌荒れの原因になりうる成分の候補を調べます
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        <button
          ref={scanButtonRef}
          type="button"
          onClick={onOpenScanner}
          aria-label="バーコード読取"
          className="min-h-12 min-w-12 flex items-center justify-center gap-2 sm:px-4 rounded-full text-ink hover:bg-surface-container sm:border sm:border-sage-600 sm:text-sage-700 sm:hover:bg-sage-50 text-sm font-semibold transition-colors"
        >
          <ScanBarcode className="w-6 h-6 sm:w-5 sm:h-5" aria-hidden />
          <span className="hidden sm:inline">バーコード読取</span>
        </button>

        <button
          ref={labelButtonRef}
          type="button"
          onClick={onOpenLabelInput}
          aria-label="成分表示を入力"
          title="パッケージの成分表示を入力・撮影"
          className="min-h-12 min-w-12 flex items-center justify-center gap-2 sm:px-4 rounded-full text-ink hover:bg-surface-container sm:border sm:border-sand-300 text-sm font-semibold transition-colors"
        >
          <FileText className="w-6 h-6 sm:w-5 sm:h-5" aria-hidden />
          <span className="hidden sm:inline">成分表示を入力</span>
        </button>

        <button
          ref={menuButtonRef}
          type="button"
          onClick={onToggleSidebar}
          aria-expanded={isSidebarOpen}
          aria-controls="routine-drawer"
          // 開閉は aria-expanded で伝え、名前は変えない。数のバッジは見た目だけなので、名前に数を入れる
          aria-label={`マイルーティン（${routineCount}点${
            staleCount > 0 ? `、${STALE_AFTER_MONTHS}か月以上前に追加したコスメが${staleCount}点` : ''
          }）`}
          className="lg:hidden min-h-12 min-w-12 flex items-center justify-center text-ink rounded-full hover:bg-surface-container relative"
        >
          <Menu className="w-6 h-6" aria-hidden />
          {routineCount > 0 && (
            <span
              aria-hidden
              className={`absolute top-1.5 right-1.5 min-w-5 h-5 px-1 rounded-full text-xs font-semibold text-white flex items-center justify-center ${
                staleCount > 0 ? 'bg-orange-700' : 'bg-rose-600'
              }`}
            >
              {routineCount}
            </span>
          )}
        </button>
      </div>
    </header>
);
