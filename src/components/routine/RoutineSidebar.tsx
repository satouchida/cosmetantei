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
  Barcode,
  Layers,
  CalendarClock,
  ClipboardList,
  X,
  ImageDown,
  ImageUp,
} from 'lucide-react';
import { buttonTonal } from '../ui/design';
import type { Product } from '@/lib/types';

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
  onOpenScanner: () => void;
  onLoadPreset: (presetType: 'sample_irritation' | 'clear') => void;
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
  onOpenScanner,
  onLoadPreset,
  onExportImage,
  onImportImage,
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
              マイルーティン管理
            </h2>
            <p className="text-xs text-ink-muted truncate">コスメを登録して刺激成分を比較・あぶり出し</p>
          </div>
        </div>
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => onLoadPreset('clear')}
            title="肌荒れしたコスメ・安全なコスメのリストを空にする（今使っているコスメはそのまま）"
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
            aria-label="マイルーティン管理を閉じる"
            className="lg:hidden w-12 h-12 flex items-center justify-center rounded-full text-ink hover:bg-surface-container transition-colors"
          >
            <X className="w-6 h-6" aria-hidden />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* 今使っているコスメ（組み合わせチェック） */}
        <section className="space-y-2">
          <SectionHeading
            icon={<Layers className="w-4 h-4 text-sky-700" aria-hidden />}
            title="今使っているコスメ"
            count={currentUse.length}
            countClassName="bg-sky-50 text-sky-800"
          />

          {staleIds.size > 0 && (
            <div role="status" className="p-3 bg-orange-50 rounded-xl border border-orange-200 text-xs text-orange-900 flex gap-1.5">
              <CalendarClock className="w-4 h-4 shrink-0 text-orange-600" aria-hidden />
              <span>
                {STALE_AFTER_MONTHS}か月以上前に追加したコスメがあります。今も使っているか確かめて、使っていないものは削除してください。
              </span>
            </div>
          )}

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
                          {!isPersistable(p) && '・入力した成分表示は保存しません'}
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
                aria-describedby="current-use-hint"
                className="w-full min-h-12 px-5 border-[1.5px] border-primary text-primary hover:bg-tint-safe disabled:border-transparent disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed rounded-2xl text-[15px] font-semibold flex items-center justify-center gap-2 transition-colors"
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

        {/* 🚨 Bad Products Section */}
        <section className="space-y-2">
          <SectionHeading
            icon={<AlertTriangle className="w-4 h-4 text-rose-600" aria-hidden />}
            title="肌荒れしたコスメ"
            count={badProducts.length}
            countClassName="bg-tint-warning text-rose-700"
          />

          {badProducts.length === 0 ? (
            <EmptyState>チャットでコスメを検索、またはバーコードをスキャンして追加</EmptyState>
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
            title="安全に使えているコスメ"
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
                    removeLabel={`「${p.name}」を安全に使えているコスメから削除`}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-2">
          <button
            type="button"
            onClick={onOpenScanner}
            className="w-full min-h-12 px-5 bg-white hover:bg-tint-safe text-primary border-[1.5px] border-primary rounded-2xl text-[15px] font-semibold flex items-center justify-center gap-2 transition-colors"
          >
            <Barcode className="w-5 h-5" aria-hidden />
            <span>JANバーコードをスキャン</span>
          </button>

          {/* バックアップ・共有（画像。docs/plans/routine-image.md） */}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onExportImage} disabled={isEmpty} className={buttonTonal}>
              <ImageDown className="w-5 h-5 shrink-0" aria-hidden />
              <span>画像で保存・共有</span>
            </button>
            <button type="button" onClick={() => importInputRef.current?.click()} className={buttonTonal}>
              <ImageUp className="w-5 h-5 shrink-0" aria-hidden />
              <span>画像から読み込む</span>
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
          aria-describedby="differential-hint"
          className="w-full min-h-12 px-5 bg-primary hover:bg-primary-active disabled:bg-gray-100 disabled:text-gray-500 disabled:shadow-none disabled:cursor-not-allowed text-on-primary rounded-2xl text-[15px] font-semibold shadow-sm flex items-center justify-center gap-2 transition-colors"
        >
          <Sparkles className="w-5 h-5" aria-hidden />
          <span>原因成分をあぶり出す (差分分析)</span>
        </button>
        <p id="differential-hint" className="text-xs text-ink-muted text-center">
          {badProducts.length === 0
            ? '肌荒れしたコスメを1点以上登録すると実行できます'
            : `登録した${badProducts.length + safeProducts.length}点のコスメから共通点・除外成分を解析します`}
        </p>
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
      <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-ink">
        {icon}
        <span>{title}</span>
      </h3>
      <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${countClassName}`}>{count}点</span>
    </div>
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
