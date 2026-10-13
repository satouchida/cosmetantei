'use client';

import React from 'react';
import { Product } from '@/lib/types';
import { AlertTriangle, ShieldCheck, Search } from 'lucide-react';
import { getDisplayBrand } from '@/lib/display-brand';
import { productSourceInfo } from '@/lib/product-source';
import { ProductSourceLink, WebSearchBadge } from './ProductSourceLink';

interface ProductSuggestionCardProps {
  products: Product[];
  onSelectToAnalyze: (product: Product) => void;
  onAddToBad: (product: Product) => void;
  onAddToSafe: (product: Product) => void;
  /** 原因成分を含まない代わりの商品（見出しと注意書きを変える） */
  isAlternatives?: boolean;
}

export const ProductSuggestionCard: React.FC<ProductSuggestionCardProps> = ({
  products,
  onSelectToAnalyze,
  onAddToBad,
  onAddToSafe,
  isAlternatives = false,
}) => {
  if (!products || products.length === 0) return null;
  const anyFromWeb = products.some((p) => productSourceInfo(p)?.fromWebSearch);

  const getCountryBadge = (country: string) => {
    switch (country) {
      case 'JP':
        return { label: '🇯🇵 日本 (J-Beauty)', color: 'bg-red-50 text-red-700 border-red-200' };
      case 'KR':
        return { label: '🇰🇷 韓国 (K-Beauty)', color: 'bg-blue-50 text-blue-700 border-blue-200' };
      case 'US':
        return { label: '🇺🇸 アメリカ (US)', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
      case 'EU':
        return { label: '🇪🇺 欧州 (EU)', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
      default:
        return { label: '🌐 コスメ', color: 'bg-gray-50 text-gray-700 border-gray-200' };
    }
  };

  return (
    <div className="my-3 space-y-2.5">
      <p className="text-xs font-semibold text-gray-500 tracking-wide">
        {isAlternatives ? '避けたい成分を含まないコスメ:' : '該当するコスメ（タップして選択）:'}
      </p>
      {isAlternatives && anyFromWeb && (
        <p className="text-[11px] text-gray-500 leading-relaxed">
          「Web検索」の商品は、Web検索で見つけたページの全成分表示を読み取り、アプリで成分を確かめたものです。出典のページと、購入時のパッケージの表示もご確認ください。
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
        {products.map((p) => {
          const countryBadge = getCountryBadge(p.country);
          return (
            <div
              key={p.id}
              className="bg-white rounded-xl p-3.5 border border-sand-200 shadow-xs hover:shadow-md hover:border-sage-400 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-1.5 mb-1.5">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${countryBadge.color}`}>
                    {countryBadge.label}
                  </span>
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    <WebSearchBadge product={p} />
                    {p.isQuasiDrug && (
                      <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-md font-medium">
                        医薬部外品
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-xs font-bold text-sage-800">{getDisplayBrand(p.brand, p.name)}</div>
                <h4 className="text-sm font-bold text-gray-900 line-clamp-2 mt-0.5 leading-snug">
                  {p.name}
                </h4>
                <ProductSourceLink product={p} className="mt-1" />

                {p.activeIngredientsJa && p.activeIngredientsJa.length > 0 && (
                  <div className="mt-1.5 text-[11px] text-emerald-700 bg-emerald-50/80 px-2 py-1 rounded-md">
                    <span className="font-semibold">有効成分:</span> {p.activeIngredientsJa.join(', ')}
                  </div>
                )}

                <div className="mt-2 flex flex-wrap gap-1">
                  {p.fragranceFree && (
                    <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-sm">
                      無香料
                    </span>
                  )}
                  {p.alcoholFree && (
                    <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-sm">
                      アルコールフリー
                    </span>
                  )}
                  {p.barcode && (
                    <span className="text-[10px] text-gray-400 font-mono">
                      JAN:{p.barcode}
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-3.5 pt-2.5 border-t border-sand-100 space-y-1.5">
                <button
                  type="button"
                  onClick={() => onSelectToAnalyze(p)}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 bg-sage-600 hover:bg-sage-700 text-white rounded-lg text-xs font-medium transition-colors shadow-xs"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>成分を詳しくチェック</span>
                </button>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onAddToBad(p)}
                    className="flex items-center justify-center gap-1 py-1 px-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-[11px] font-medium transition-colors"
                  >
                    <AlertTriangle className="w-3 h-3 text-rose-500" />
                    <span>肌荒れした</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddToSafe(p)}
                    className="flex items-center justify-center gap-1 py-1 px-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-[11px] font-medium transition-colors"
                  >
                    <ShieldCheck className="w-3 h-3 text-emerald-600" />
                    <span>普段使えている</span>
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
