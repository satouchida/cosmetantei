'use client';

import React, { useRef, type RefObject } from 'react';
import { UserRoutineState } from '@/lib/types';
import { CurrentUseEntry, isPersistable, STALE_AFTER_MONTHS } from '@/lib/current-use';
import {
  AlertTriangle,
  ShieldCheck,
  Trash2,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  Circle,
  Layers,
  CalendarClock,
  ClipboardList,
  X,
  ImageDown,
  ImageUp,
} from 'lucide-react';
import { busyLook, buttonTonal } from '../ui/design';
import type { Product } from '@/lib/types';

/** 差分分析を始めるボタンの文言（サイドバーとスマホの登録状況バー、案内の文で同じにする） */
export const DIFFERENTIAL_LABEL = '肌荒れの原因候補を調べる';

interface RoutineSidebarProps {
  routine: UserRoutineState;
  /** 今使っているコスメ（追加した日つき） */
  currentUse: CurrentUseEntry[];
  /** 3か月以上前に追加した製品の ID */
  staleIds: ReadonlySet<string>;
  onRemoveBad: (productId: string) => void;
  onRemoveSafe: (productId: string) => void;
  onRemoveCurrent: (productId: string) => void;
  /** 「今も使っている」：追加した日を今日にする */
  onConfirmCurrent: (productId: string) => void;
  onCheckCurrentUse: () => void;
  onRunDifferential: () => void;
  onLoadPreset: (presetType: 'sample_irritation' | 'clear') => void;
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
  routine,
  currentUse,
  staleIds,
  onRemoveBad,
  onRemoveSafe,
  onRemoveCurrent,
  onConfirmCurrent,
  onCheckCurrentUse,
  onRunDifferential,
  onLoadPreset,
  onExportImage,
  onImportImage,
  busy = false,
  onClose,
  closeButtonRef,
}) => {
  const { badProducts, safeProducts } = routine;
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const isEmpty = badProducts.length + safeProducts.length + currentUse.length === 0;

  return (
    <aside
      aria-labelledby="routine-drawer-title"
      className="h-full w-full bg-white lg:border-l border-sand-200 flex flex-col"
    >
      {/* Header（Material 3 の引き出し：56px、タイトル・クリア・閉じる） */}
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
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => onLoadPreset('clear')}
            title="肌荒れしたコスメ・普段使えているコスメのリストを空にする（今使っているコスメはそのまま）"
            aria-label="比較リストをクリア（今使っているコスメはそのまま）"
            className="min-h-12 px-3 rounded-lg text-sm font-semibold text-ink-muted hover:text-rose-700 hover:bg-tint-warning flex items-center gap-1 transition-colors"
          >
            <RefreshCw className="w-4 h-4" aria-hidden />
            <span>クリア</span>
          </button>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="マイルーティンを閉じる"
            className="lg:hidden w-12 h-12 flex items-center justify-center rounded-full text-ink hover:bg-surface-container transition-colors"
          >
            <X className="w-6 h-6" aria-hidden />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-y-auto p-4 space-y-6">
        {/* 🚨 Bad Products Section */}
        <section className="space-y-2">
          <SectionHeading
            icon={<AlertTriangle className="w-4 h-4 text-rose-600" aria-hidden />}
            title="肌荒れしたコスメ"
            count={badProducts.length}
            countClassName="bg-tint-warning text-rose-700"
          />

          {badProducts.length === 0 ? (
            <EmptyState>チャットでコスメを検索、またはバーコードを読み取って追加</EmptyState>
          ) : (
            <ul role="list" className="space-y-2">
              {badProducts.map((p) => (
                <li key={p.id}>
                  <ProductRow
                    product={p}
                    accentClassName="border-l-rose-600"
                    brandClassName="text-rose-700"
                    onRemove={() => onRemoveBad(p.id)}
                    removeLabel={`「${p.name}」を肌荒れしたコスメから削除`}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ✅ Safe Products Section */}
        <section className="space-y-2">
          <SectionHeading
            icon={<ShieldCheck className="w-4 h-4 text-emerald-600" aria-hidden />}
            title="普段使えているコスメ"
            count={safeProducts.length}
            countClassName="bg-tint-safe text-emerald-800"
          />

          {safeProducts.length === 0 ? (
            <EmptyState>普段問題なく使えているコスメを追加すると、共通の成分を除外して、原因の候補を絞り込めます</EmptyState>
          ) : (
            <ul role="list" className="space-y-2">
              {safeProducts.map((p) => (
                <li key={p.id}>
                  <ProductRow
                    product={p}
                    accentClassName="border-l-emerald-600"
                    brandClassName="text-emerald-800"
                    onRemove={() => onRemoveSafe(p.id)}
                    removeLabel={`「${p.name}」を普段使えているコスメから削除`}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 今使っているコスメ（組み合わせチェック） */}
        <section id="current-use-section" className="space-y-2 scroll-mt-4">
          <SectionHeading
            icon={<Layers className="w-4 h-4 text-sky-700" aria-hidden />}
            title="今使っているコスメ"
            count={currentUse.length}
            countClassName="bg-sky-50 text-sky-800"
          />

          {/* 読み上げの枠はいつも置いておく（中身が出たときに読み上げる） */}
          <div role="status">
            {staleIds.size > 0 && (
              <div className="p-3 bg-orange-50 rounded-xl border border-orange-200 text-xs text-orange-900 flex gap-1.5">
                <CalendarClock className="w-4 h-4 shrink-0 text-orange-600" aria-hidden />
                <span>
                  {STALE_AFTER_MONTHS}か月以上前に追加したコスメがあります。今も使っているか確かめて、使っていないものは削除してください。
                </span>
              </div>
            )}
          </div>

          {currentUse.length === 0 ? (
            <EmptyState>
              毎日使っているコスメを「今使っている」で追加すると、一緒に使うときに注意したい組み合わせを調べられます
            </EmptyState>
          ) : (
            <ul role="list" className="space-y-2">
              {currentUse.map(({ product: p, addedAt }) => {
                const stale = staleIds.has(p.id);
                return (
                  <li key={p.id}>
                    <ProductRow
                      product={p}
                      accentClassName={stale ? 'border-l-orange-600' : 'border-l-sky-600'}
                      brandClassName="text-sky-800"
                      onRemove={() => onRemoveCurrent(p.id)}
                      removeLabel={`「${p.name}」を今使っているコスメから削除`}
                      note={
                        <p className={`text-xs ${stale ? 'text-orange-800 font-semibold' : 'text-ink-muted'}`}>
                          {formatAddedDate(addedAt)}に追加{stale && `（${STALE_AFTER_MONTHS}か月以上前）`}
                          {!isPersistable(p) && '・この商品は保存しません（入力した成分表示・お店の商品説明から読んだ成分）'}
                        </p>
                      }
                    >
                      {stale && (
                        <button
                          type="button"
                          onClick={() => onConfirmCurrent(p.id)}
                          className="mt-2 w-full min-h-12 px-3 bg-orange-50 hover:bg-orange-100 text-orange-900 border border-orange-200 rounded-xl text-sm font-semibold transition-colors"
                        >
                          今も使っている
                        </button>
                      )}
                    </ProductRow>
                  </li>
                );
              })}
            </ul>
          )}

          {currentUse.length > 0 && (
            <>
              <button
                type="button"
                onClick={onCheckCurrentUse}
                disabled={currentUse.length < 2}
                aria-disabled={busy || undefined}
                aria-describedby="current-use-hint"
                className={`w-full min-h-12 px-5 border-[1.5px] border-primary text-primary hover:bg-tint-safe disabled:border-transparent disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed rounded-2xl text-[15px] font-semibold flex items-center justify-center gap-2 transition-colors ${busyLook}`}
              >
                <Layers className="w-5 h-5" aria-hidden />
                <span>組み合わせをチェック</span>
              </button>
              <p id="current-use-hint" className="text-xs text-ink-muted">
                {currentUse.length < 2 && '2点以上追加すると調べられます。'}
                このリストはこの端末のブラウザにだけ保存されます。
              </p>
            </>
          )}
        </section>

        {/* バックアップ・共有（画像。docs/plans/routine-image.md）。読み込みはまれなので、文字だけのボタンにする */}
        <div className="space-y-1">
          <div>
            <button type="button" onClick={onExportImage} disabled={isEmpty} className={`w-full ${buttonTonal}`}>
              <ImageDown className="w-5 h-5 shrink-0" aria-hidden />
              <span>リストを<wbr />画像で<wbr />保存・共有</span>
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="w-full min-h-11 px-3 rounded-xl text-sm text-ink-muted hover:text-ink hover:underline inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <ImageUp className="w-4 h-4 shrink-0" aria-hidden />
              <span>保存した画像から読み込む</span>
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) onImportImage(file);
              }}
            />
          </div>

          {/* 開発用：本番のビルドには出さない */}
          {process.env.NODE_ENV !== 'production' && (
            <button
              type="button"
              onClick={() => onLoadPreset('sample_irritation')}
              className="w-full min-h-12 px-3 bg-surface-container-low hover:bg-surface-container text-ink-muted rounded-xl text-sm font-medium transition-colors text-center"
            >
              🧪 テスト用比較データを自動セット（開発用）
            </button>
          )}
        </div>
      </div>

      {/* Differential Action Trigger（画面下に固定） */}
      <div className="shrink-0 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-sand-200 bg-white space-y-1.5">
        <button
          type="button"
          onClick={onRunDifferential}
          disabled={badProducts.length === 0}
          aria-disabled={busy || undefined}
          aria-describedby="differential-hint"
          className={`w-full min-h-12 px-5 bg-primary hover:bg-primary-active disabled:bg-gray-100 disabled:text-gray-500 disabled:shadow-none disabled:cursor-not-allowed text-on-primary rounded-2xl text-[15px] font-semibold shadow-sm flex items-center justify-center gap-2 transition-colors ${busyLook}`}
        >
          <Sparkles className="w-5 h-5" aria-hidden />
          <span>{DIFFERENTIAL_LABEL}</span>
        </button>
        {/* 押せるようになるまでの手順（①は必須、②は任意） */}
        <ul id="differential-hint" role="list" className="text-xs text-ink-muted space-y-0.5">
          <ChecklistItem done={badProducts.length > 0}>
            肌荒れしたコスメ {badProducts.length}点（1点以上）
          </ChecklistItem>
          <ChecklistItem done={safeProducts.length > 0} optional>
            普段使えているコスメ {safeProducts.length}点（任意・あると候補を絞り込めます）
          </ChecklistItem>
        </ul>
      </div>
    </aside>
  );
};

function SectionHeading({
  icon,
  title,
  count,
  countClassName,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  countClassName: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      {/* tabIndex -1：画面のボタンからこの見出しへフォーカスを送れるように（Tab の順番には入らない） */}
      <h3 tabIndex={-1} className="flex items-center gap-1.5 text-[15px] font-semibold text-ink outline-none">
        {icon}
        <span>{title}</span>
      </h3>
      {/* 0点のときは色をつけない（赤の 0 がエラーに見えないように） */}
      <span
        className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${
          count === 0 ? 'bg-surface-container text-ink-muted' : countClassName
        }`}
      >
        {count}点
      </span>
    </div>
  );
}

function ChecklistItem({ done, optional = false, children }: { done: boolean; optional?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      {done ? (
        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" aria-hidden />
      ) : (
        <Circle className="w-4 h-4 shrink-0 text-gray-500" aria-hidden />
      )}
      <span>
        {/* 説明文として続けて読まれるので、必須・任意の別と区切りの「。」を入れる */}
        <span className="sr-only">{done ? '済み：' : optional ? '任意・未：' : '必須・未：'}</span>
        {children}
        <span className="sr-only">。</span>
      </span>
    </li>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="p-3 bg-surface rounded-xl border border-dashed border-sand-300 text-center text-sm text-ink-muted">
      {children}
    </p>
  );
}

function ProductRow({
  product,
  accentClassName,
  brandClassName,
  onRemove,
  removeLabel,
  note,
  children,
}: {
  product: Product;
  accentClassName: string;
  brandClassName: string;
  onRemove: () => void;
  removeLabel: string;
  note?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={`bg-white pl-3 pr-1 py-2 rounded-xl border border-sand-200 border-l-[3px] shadow-xs ${accentClassName}`}>
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1 py-1">
          <div className={`text-xs font-semibold truncate ${brandClassName}`}>{product.brand}</div>
          <div className="text-sm font-semibold text-ink break-keep [overflow-wrap:anywhere] line-clamp-2">
            {product.name}
          </div>
          {note}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="w-12 h-12 shrink-0 flex items-center justify-center rounded-full text-gray-500 hover:text-rose-700 hover:bg-tint-warning transition-colors"
        >
          <Trash2 className="w-5 h-5" aria-hidden />
        </button>
      </div>
      {children && <div className="pr-2">{children}</div>}
    </div>
  );
}

/** 追加した日（例：2026年7月14日） */
function formatAddedDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
