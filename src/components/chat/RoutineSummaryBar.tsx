'use client';

import React from 'react';
import { CalendarClock, ChevronRight, ClipboardList, Sparkles } from 'lucide-react';
import { STALE_AFTER_MONTHS, UsableEntry } from '@/lib/usable-products';
import { busyLook } from '../ui/design';
import { DIFFERENTIAL_LABEL } from '../routine/routine-labels';
import { USABLE_SECTION_ID } from '../routine/RoutineSidebar';

interface RoutineSummaryBarProps {
  badCount: number;
  usableCount: number;
  isSidebarOpen: boolean;
  onOpenSidebar: () => void;
  /** 差分分析を始める（応答待ちなら案内だけ出す） */
  onRunDifferential: () => void;
  busy: boolean;
  /** 3か月以上前に追加した、今も使っている使えるコスメ */
  staleEntries: UsableEntry[];
}

/** スマホの登録状況のバー（マイルーティンを開く・差分分析のボタン）と、3か月以上前に追加したコスメの確認 */
export const RoutineSummaryBar: React.FC<RoutineSummaryBarProps> = ({
  badCount,
  usableCount,
  isSidebarOpen,
  onOpenSidebar,
  onRunDifferential,
  busy,
  staleEntries,
}) => (
  <>
    {/* スマホ：登録状況とマイルーティン（引き出し）を開くボタン。肌荒れしたコスメがあれば、ここから差分分析も始められる */}
    <div className="lg:hidden px-3 pt-3">
      <div className="max-w-[720px] mx-auto bg-white rounded-xl border border-sand-200 shadow-xs">
      <div className="pl-3 pr-1 py-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-tint-safe text-emerald-700 flex items-center justify-center shrink-0">
            <ClipboardList className="w-[18px] h-[18px]" aria-hidden />
          </div>
          <p className="text-xs text-ink-muted truncate">
            肌荒れ {badCount}点 / 使えている {usableCount}点
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-controls="routine-drawer"
          aria-expanded={isSidebarOpen}
          className="min-h-12 pl-3 pr-2 rounded-lg text-sage-700 hover:bg-surface-container text-sm font-semibold flex items-center gap-0.5 shrink-0"
        >
          マイルーティン
          <ChevronRight className="w-4 h-4" aria-hidden />
        </button>
      </div>
      {badCount > 0 && (
        <div className="px-2 pb-2">
          <button
            type="button"
            onClick={onRunDifferential}
            aria-disabled={busy || undefined}
            className={`w-full min-h-12 px-4 bg-primary hover:bg-primary-active text-on-primary rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${busyLook}`}
          >
            <Sparkles className="w-5 h-5" aria-hidden />
            <span>{DIFFERENTIAL_LABEL}</span>
          </button>
        </div>
      )}
      </div>
    </div>

    {/* 3か月以上前に追加した、今も使っている「使えるコスメ」の確認（今も使っている・もう使っていない・削除で消える） */}
    {/* ステータスの入れ物は常に置く（中身ごと作ると読み上げられないことがある） */}
    <div role="status">
    {staleEntries.length > 0 && (
      <div className="mx-3 sm:mx-6 mt-3 px-3 py-2 bg-orange-50 rounded-xl border border-orange-200 text-xs text-orange-900 flex items-center gap-2">
        <CalendarClock className="w-4 h-4 shrink-0 text-orange-600" aria-hidden />
        <p className="flex-1 min-w-0 break-words">
          「使えるコスメ」に、{STALE_AFTER_MONTHS}か月以上前に追加した、今も使っているものがあります（
          {staleEntries.slice(0, 3).map((e) => e.product.name).join('、')}
          {staleEntries.length > 3 && ` ほか${staleEntries.length - 3}点`}
          ）。今も使っているか確かめてください。
        </p>
        <button
          type="button"
          onClick={() => {
            onOpenSidebar();
            // 使えるコスメはリストの下のほうにあるので、開いたら（閉じるボタンにフォーカスが移ったあとで）
            // 見出しへフォーカスと表示を送る
            requestAnimationFrame(() => {
              const section = document.getElementById(USABLE_SECTION_ID);
              section?.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
              section?.scrollIntoView({ block: 'start', inline: 'nearest' });
            });
          }}
          aria-label="使えるコスメを確認する"
          className="lg:hidden shrink-0 min-h-12 px-3 bg-white hover:bg-orange-100 border border-orange-300 rounded-lg text-sm font-semibold"
        >
          確認する
        </button>
      </div>
    )}
    </div>
  </>
);
