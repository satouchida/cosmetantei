'use client';

import React from 'react';
import { CalendarClock, Layers, ShieldCheck } from 'lucide-react';
import { isPersistable, STALE_AFTER_MONTHS, UsableEntry } from '@/lib/usable-products';
import { busyLook } from '../ui/design';
import { SectionHeading } from './SectionHeading';
import { EmptyState } from './EmptyState';
import { ProductRow } from './ProductRow';
import { InUseSwitch } from './InUseSwitch';
import { ClearButton } from './ClearButton';

interface UsableProductsSectionProps {
  /** 見出しの ID（RoutineSidebar の USABLE_SECTION_ID） */
  id: string;
  /** 使えるコスメ（追加した日・今も使っているかつき） */
  usable: UsableEntry[];
  /** 今も使っている製品のうち、3か月以上前に追加した製品の ID */
  staleIds: ReadonlySet<string>;
  onRemoveUsable: (productId: string) => void;
  /** 「今も使っている」：追加した日を今日にする */
  onConfirmUsable: (productId: string) => void;
  /** 今も使っているか（false は以前使っていた。組み合わせチェックに使わない） */
  onSetInUse: (productId: string, inUse: boolean) => void;
  /** リストをクリアする（確かめるダイアログを開く） */
  onClearUsable: () => void;
  onCheckCurrentUse: () => void;
  /** 応答を待っている（調べる操作は押しても受け付けず、案内が出る） */
  busy: boolean;
}

/** 使えるコスメのリスト（比較にはすべて、組み合わせチェックには今も使っているものだけ） */
export const UsableProductsSection: React.FC<UsableProductsSectionProps> = ({
  id,
  usable,
  staleIds,
  onRemoveUsable,
  onConfirmUsable,
  onSetInUse,
  onClearUsable,
  onCheckCurrentUse,
  busy,
}) => {
  const inUseCount = usable.filter((e) => e.inUse).length;

  return (
    <section id={id} className="space-y-2 scroll-mt-4">
      <SectionHeading
        icon={<ShieldCheck className="w-4 h-4 text-emerald-600" aria-hidden />}
        title="使えるコスメ"
        count={usable.length}
        countClassName="bg-tint-safe text-emerald-800"
      />

      {/* 読み上げの枠はいつも置いておく（中身が出たときに読み上げる） */}
      <div role="status">
        {staleIds.size > 0 && (
          <div className="p-3 bg-orange-50 rounded-xl border border-orange-200 text-xs text-orange-900 flex gap-1.5">
            <CalendarClock className="w-4 h-4 shrink-0 text-orange-600" aria-hidden />
            <span>
              {STALE_AFTER_MONTHS}か月以上前に追加したコスメがあります。今も使っているか確かめてください。
            </span>
          </div>
        )}
      </div>

      {usable.length === 0 ? (
        <EmptyState>
          問題なく使えるコスメを追加すると、共通の成分を除外して原因の候補を絞り込めます。今使っているものは、一緒に使うときの組み合わせもチェックできます
        </EmptyState>
      ) : (
        <ul role="list" className="space-y-2">
          {usable.map(({ product: p, addedAt, inUse, sessionOnly }) => {
            const stale = staleIds.has(p.id);
            return (
              <li key={p.id}>
                <ProductRow
                  product={p}
                  accentClassName={stale ? 'border-l-orange-600' : inUse ? 'border-l-sky-600' : 'border-l-emerald-600'}
                  brandClassName="text-emerald-800"
                  onRemove={() => onRemoveUsable(p.id)}
                  removeLabel={`「${p.name}」を使えるコスメから削除`}
                  note={
                    <p className={`text-xs ${stale ? 'text-orange-800 font-semibold' : 'text-ink-muted'}`}>
                      {formatAddedDate(addedAt)}に追加{stale && `（${STALE_AFTER_MONTHS}か月以上前）`}
                      {sessionOnly
                        ? '・サンプルなので保存しません'
                        : !isPersistable(p) && '・この商品は保存しません（入力した成分表示・お店の商品説明から読んだ成分）'}
                    </p>
                  }
                >
                  {stale ? (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => onConfirmUsable(p.id)}
                        className="min-h-12 px-2 bg-orange-50 hover:bg-orange-100 active:bg-orange-200 text-orange-900 border border-orange-200 rounded-xl text-sm font-semibold transition-colors"
                      >
                        今も使っている
                      </button>
                      <button
                        type="button"
                        onClick={() => onSetInUse(p.id, false)}
                        className="min-h-12 px-2 bg-white hover:bg-surface-container-low active:bg-surface-container text-ink border border-sand-300 rounded-xl text-sm font-semibold transition-colors"
                      >
                        もう使っていない
                      </button>
                    </div>
                  ) : (
                    <InUseSwitch name={p.name} inUse={inUse} onChange={(next) => onSetInUse(p.id, next)} />
                  )}
                </ProductRow>
              </li>
            );
          })}
        </ul>
      )}

      {usable.length > 0 && (
        <>
          <button
            type="button"
            onClick={onCheckCurrentUse}
            disabled={inUseCount < 2}
            aria-disabled={busy || undefined}
            aria-describedby="usable-hint"
            className={`w-full min-h-12 px-5 border-[1.5px] border-primary text-primary hover:bg-tint-safe active:bg-emerald-100 disabled:border-transparent disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed rounded-2xl text-[0.9375rem] font-semibold flex items-center justify-center gap-2 transition-colors ${busyLook}`}
          >
            <Layers className="w-5 h-5" aria-hidden />
            <span>組み合わせをチェック</span>
          </button>
          <p id="usable-hint" className="text-xs text-ink-muted">
            {inUseCount < 2 && '今も使っているコスメが2点以上あると調べられます。'}
            このリストはこの端末のブラウザにだけ保存されます。
          </p>
          <ClearButton onClick={onClearUsable}>使えるコスメのリストをクリア</ClearButton>
        </>
      )}
    </section>
  );
};

/** 追加した日（例：2026年7月14日） */
function formatAddedDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
