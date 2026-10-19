'use client';

import React from 'react';
import { Product } from '@/lib/types';
import { AlertTriangle, ShieldCheck, Layers, Search } from 'lucide-react';
import { getDisplayBrand } from '@/lib/display-brand';
import { productSourceInfo } from '@/lib/product-source';
import { ProductSourceLink, WebSearchBadge } from './ProductSourceLink';
import { badge, busyLook, buttonPrimary, countryLabel, innerCard, routineAction, routineActionCompact } from '../ui/design';

interface ProductSuggestionCardProps {
  products: Product[];
  onSelectToAnalyze: (product: Product) => void;
  onAddToBad: (product: Product) => void;
  onAddToSafe: (product: Product) => void;
  onAddToCurrent: (product: Product) => void;
  /** 原因成分を含まない代わりの商品（見出しと注意書きを変える） */
  isAlternatives?: boolean;
  /** 応答を待っている（押しても受け付けず、案内が出る） */
  busy?: boolean;
}

export const ProductSuggestionCard: React.FC<ProductSuggestionCardProps> = ({
  products,
  onSelectToAnalyze,
  onAddToBad,
  onAddToSafe,
  onAddToCurrent,
  isAlternatives = false,
  busy = false,
}) => {
  if (!products || products.length === 0) return null;
  const anyFromWeb = products.some((p) => productSourceInfo(p)?.fromWebSearch);

  return (
    <div className="my-3 space-y-2.5">
      <p className="text-sm font-semibold text-ink-muted">
        {isAlternatives ? '避けたい成分を含まないコスメ:' : '該当するコスメ（タップして選択）:'}
      </p>
      {isAlternatives && anyFromWeb && (
        <p className="text-xs text-ink-muted leading-relaxed">
          「Web検索」の商品は、Web検索で見つけたページの全成分表示を読み取り、アプリで成分を確かめたものです。出典のページと、購入時のパッケージの表示もご確認ください。
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {products.map((p) => {
          return (
            <div
              key={p.id}
              className={`${innerCard} p-3.5 shadow-xs flex flex-col justify-between text-ink`}
            >
              <div>
                <div className="flex items-center justify-between gap-1.5 mb-1.5">
                  <span className={badge('neutral')}>{countryLabel(p.country, true)}</span>
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    <WebSearchBadge product={p} />
                    {p.isQuasiDrug && (
                      <span className={badge('brand')}>医薬部外品</span>
                    )}
                  </div>
                </div>

                <div className="text-xs font-semibold text-sage-700">{getDisplayBrand(p.brand, p.name)}</div>
                <h2 className="text-[15px] font-semibold line-clamp-2 mt-0.5 leading-snug break-keep [overflow-wrap:anywhere]">
                  {p.name}
                </h2>
                <ProductSourceLink product={p} className="mt-1" />

                {p.activeIngredientsJa && p.activeIngredientsJa.length > 0 && (
                  <div className="mt-1.5 text-xs text-emerald-900 bg-tint-safe px-2 py-1 rounded-lg">
                    <span className="font-semibold">有効成分:</span> {p.activeIngredientsJa.join(', ')}
                  </div>
                )}

                <div className="mt-2 flex flex-wrap gap-1">
                  {p.fragranceFree && (
                    <span className={badge('neutral')}>無香料</span>
                  )}
                  {p.alcoholFree && (
                    <span className={badge('neutral')}>アルコールフリー</span>
                  )}
                  {p.barcode && (
                    <span className="text-xs text-ink-muted font-mono">
                      JAN:{p.barcode}
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-3.5 pt-3 border-t border-sand-200 space-y-2">
                <button
                  type="button"
                  onClick={() => onSelectToAnalyze(p)}
                  // 同じ文のボタンが並ぶので、読み上げでは商品名を足す（見えている文は先頭に残す）
                  aria-label={`成分を詳しくチェック（${p.name}）`}
                  aria-disabled={busy || undefined}
                  className={`w-full ${buttonPrimary} ${busyLook}`}
                >
                  <Search className="w-4 h-4" aria-hidden />
                  <span>成分を詳しくチェック</span>
                </button>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => onAddToBad(p)}
                    aria-label={`肌荒れした（${p.name}）`}
                    className={`${routineActionCompact} ${routineAction.bad}`}
                  >
                    <AlertTriangle className="w-4 h-4" aria-hidden />
                    <span>肌荒れした</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddToSafe(p)}
                    aria-label={`普段使えている（${p.name}）`}
                    className={`${routineActionCompact} ${routineAction.safe}`}
                  >
                    <ShieldCheck className="w-4 h-4" aria-hidden />
                    <span>普段使えている</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddToCurrent(p)}
                    aria-label={`今使っている（${p.name}）`}
                    className={`${routineActionCompact} ${routineAction.current}`}
                  >
                    <Layers className="w-4 h-4" aria-hidden />
                    <span>今使っている</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
