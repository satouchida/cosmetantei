'use client';

import React, { type RefObject } from 'react';
import { UsableEntry } from '@/lib/usable-products';
import { ClipboardList, X } from 'lucide-react';
import type { Product } from '@/lib/types';
import { BadProductsSection } from './BadProductsSection';
import { UsableProductsSection } from './UsableProductsSection';
import { RoutineImageButtons } from './RoutineImageButtons';
import { DifferentialAction } from './DifferentialAction';

// 差分分析を始めるボタンの文言（React を読まずに使えるよう routine-labels.ts に置く）
import { DIFFERENTIAL_LABEL } from './routine-labels';
export { DIFFERENTIAL_LABEL };

/** 使えるコスメの見出しの ID（3か月の確認の「確認する」から、ここへ移る） */
export const USABLE_SECTION_ID = 'usable-section';
/** 肌荒れしたコスメの見出しの ID（リストをクリアした後のフォーカスの移り先） */
export const BAD_SECTION_ID = 'bad-section';

interface RoutineSidebarProps {
  badProducts: Product[];
  /** 使えるコスメ（追加した日・今も使っているかつき） */
  usable: UsableEntry[];
  /** 今も使っている製品のうち、3か月以上前に追加した製品の ID */
  staleIds: ReadonlySet<string>;
  onRemoveBad: (productId: string) => void;
  onRemoveUsable: (productId: string) => void;
  /** 「今も使っている」：追加した日を今日にする */
  onConfirmUsable: (productId: string) => void;
  /** 今も使っているか（false は以前使っていた。組み合わせチェックに使わない） */
  onSetInUse: (productId: string, inUse: boolean) => void;
  /** リストをクリアする（確かめるダイアログを開く） */
  onClearBad: () => void;
  onClearUsable: () => void;
  onCheckCurrentUse: () => void;
  onRunDifferential: () => void;
  /** 開発用のサンプル（使えるコスメは保存しない） */
  onLoadSample: () => void;
  /** 応答を待っている（調べる操作は押しても受け付けず、案内が出る） */
  busy?: boolean;
  /** マイルーティンを画像で保存・共有する */
  onExportImage: () => void;
  /** 保存した・共有された画像からマイルーティンを読み込む */
  onImportImage: (file: File) => void;
  /** スマホの引き出しを閉じる（デスクトップでは閉じるボタンを出さない） */
  onClose: () => void;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
}

export const RoutineSidebar: React.FC<RoutineSidebarProps> = ({
  badProducts,
  usable,
  staleIds,
  onRemoveBad,
  onRemoveUsable,
  onConfirmUsable,
  onSetInUse,
  onClearBad,
  onClearUsable,
  onCheckCurrentUse,
  onRunDifferential,
  onLoadSample,
  onExportImage,
  onImportImage,
  busy = false,
  onClose,
  closeButtonRef,
}) => {
  const isEmpty = badProducts.length + usable.length === 0;

  return (
    <aside
      aria-labelledby="routine-drawer-title"
      className="h-full w-full bg-white lg:border-l border-sand-200 flex flex-col"
    >
      {/* Header（Material 3 の引き出し：56px、タイトル・閉じる） */}
      <div className="min-h-14 shrink-0 pl-4 pr-1 border-b border-sand-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardList className="w-[22px] h-[22px] shrink-0 text-primary" aria-hidden />
          <div className="min-w-0">
            <h2 id="routine-drawer-title" className="font-semibold text-ink text-lg leading-tight truncate">
              マイルーティン
            </h2>
            <p className="text-xs text-ink-muted truncate">比べて原因候補を絞り込みます</p>
          </div>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="マイルーティンを閉じる"
          className="lg:hidden w-12 h-12 shrink-0 flex items-center justify-center rounded-full text-ink hover:bg-surface-container active:bg-surface-container-high transition-colors"
        >
          <X className="w-6 h-6" aria-hidden />
        </button>
      </div>

      <div className="relative flex-1 overflow-y-auto p-4 space-y-6">
        {/* 肌荒れしたコスメ（このページを開いている間だけ） */}
        <BadProductsSection id={BAD_SECTION_ID} badProducts={badProducts} onRemoveBad={onRemoveBad} onClearBad={onClearBad} />

        {/* 使えるコスメ（比較にはすべて、組み合わせチェックには今も使っているものだけ） */}
        <UsableProductsSection
          id={USABLE_SECTION_ID}
          usable={usable}
          staleIds={staleIds}
          onRemoveUsable={onRemoveUsable}
          onConfirmUsable={onConfirmUsable}
          onSetInUse={onSetInUse}
          onClearUsable={onClearUsable}
          onCheckCurrentUse={onCheckCurrentUse}
          busy={busy}
        />

        {/* バックアップ・共有（画像）と開発用のサンプル */}
        <RoutineImageButtons
          isEmpty={isEmpty}
          onExportImage={onExportImage}
          onImportImage={onImportImage}
          onLoadSample={onLoadSample}
        />
      </div>

      {/* Differential Action Trigger（画面下に固定） */}
      <DifferentialAction badProducts={badProducts} usable={usable} onRunDifferential={onRunDifferential} busy={busy} />
    </aside>
  );
};
