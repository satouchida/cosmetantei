'use client';

import React from 'react';
import { Sparkles } from 'lucide-react';
import type { UsableEntry } from '@/lib/usable-products';
import type { Product } from '@/lib/types';
import { busyLook } from '../ui/design';
import { DIFFERENTIAL_LABEL } from './routine-labels';
import { ChecklistItem } from './ChecklistItem';

interface DifferentialActionProps {
  badProducts: Product[];
  usable: UsableEntry[];
  onRunDifferential: () => void;
  /** 応答を待っている（押しても受け付けず、案内が出る） */
  busy: boolean;
}

/** 差分分析を始めるボタンと、押せるようになるまでの手順（引き出しの下に固定） */
export const DifferentialAction: React.FC<DifferentialActionProps> = ({ badProducts, usable, onRunDifferential, busy }) => (
  <div className="shrink-0 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-sand-200 bg-white space-y-1.5">
    <button
      type="button"
      onClick={onRunDifferential}
      disabled={badProducts.length === 0}
      aria-disabled={busy || undefined}
      aria-describedby="differential-hint"
      className={`w-full min-h-12 px-5 bg-primary hover:bg-primary-active active:bg-sage-800 disabled:bg-gray-100 disabled:text-gray-500 disabled:shadow-none disabled:cursor-not-allowed text-on-primary rounded-2xl text-[0.9375rem] font-semibold shadow-sm flex items-center justify-center gap-2 transition-colors ${busyLook}`}
    >
      <Sparkles className="w-5 h-5" aria-hidden />
      <span>{DIFFERENTIAL_LABEL}</span>
    </button>
    {/* 押せるようになるまでの手順（①は必須、②は任意） */}
    <ul id="differential-hint" role="list" className="text-xs text-ink-muted space-y-0.5">
      <ChecklistItem done={badProducts.length > 0}>
        肌荒れしたコスメ {badProducts.length}点（1点以上）
      </ChecklistItem>
      <ChecklistItem done={usable.length > 0} optional>
        使えるコスメ {usable.length}点（任意・あると候補を絞り込めます）
      </ChecklistItem>
    </ul>
  </div>
);
