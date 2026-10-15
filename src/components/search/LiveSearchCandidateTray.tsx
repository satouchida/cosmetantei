'use client';

import React from 'react';
import { Product } from '@/lib/types';
import { Search, X, Sparkles, AlertTriangle, ShieldCheck, Layers, Tag } from 'lucide-react';
import { getDisplayBrand } from '@/lib/display-brand';

interface LiveSearchCandidateTrayProps {
  query: string;
  candidates: Product[];
  /** 検索語で始まるブランド（タップでブランド名を入力し、そのブランドの製品に絞り込む） */
  brands?: { name: string; kana?: string }[];
  onSelectBrand?: (brand: string) => void;
  isOpen: boolean;
  onClose: () => void;
  onSelectProduct: (product: Product) => void;
  onAddToBad: (product: Product) => void;
  onAddToSafe: (product: Product) => void;
  onAddToCurrent: (product: Product) => void;
}

export const LiveSearchCandidateTray: React.FC<LiveSearchCandidateTrayProps> = ({
  query,
  candidates,
  brands = [],
  onSelectBrand,
  isOpen,
  onClose,
  onSelectProduct,
  onAddToBad,
  onAddToSafe,
  onAddToCurrent,
}) => {
  if (!isOpen || (candidates.length === 0 && brands.length === 0)) return null;

  const getCountryBadge = (country: string) => {
    switch (country) {
      case 'JP':
        return { label: '🇯🇵 日本', color: 'bg-red-50 text-red-700 border-red-200' };
      case 'KR':
        return { label: '🇰🇷 韓国', color: 'bg-blue-50 text-blue-700 border-blue-200' };
      case 'US':
        return { label: '🇺🇸 アメリカ', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
      case 'EU':
        return { label: '🇪🇺 欧州', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
      default:
        return { label: '🌐 コスメ', color: 'bg-gray-50 text-gray-700 border-gray-200' };
    }
  };

  return (
    <div className="mb-2 bg-white/95 backdrop-blur-md rounded-2xl border border-sage-300 shadow-xl overflow-hidden animate-fade-in transition-all">
      {/* Tray Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-sand-50/90 border-b border-sand-200">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-sage-100 text-sage-700 flex items-center justify-center">
            <Search className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold text-gray-800">
            {candidates.length > 0
              ? `${query ? `「${query}」に関連するコスメ候補` : 'おすすめの低刺激コスメ候補'} (${candidates.length}件)`
              : 'ブランドを選ぶと、そのブランドの製品に絞り込めます'}
          </span>
          {candidates.length > 0 && (
            <span className="text-[10px] text-gray-500 hidden sm:inline">
              — タップして成分解析やリスト追加が可能です
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-sand-200/60 transition-colors"
          title="閉じる"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Brand chips */}
      {brands.length > 0 && onSelectBrand && (
        <div role="group" aria-label="ブランドの候補" className="flex flex-wrap items-center gap-1.5 px-3 pt-3">
          {brands.map((brand) => (
            <button
              key={brand.name}
              type="button"
              // 入力欄からフォーカスを外さない（スマートフォンのキーボードを閉じない）
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelectBrand(brand.name)}
              aria-label={`${brand.name}の製品から探す`}
              className="flex items-center gap-1 min-h-8 py-1.5 px-3 bg-sand-50 hover:bg-sage-50 text-gray-800 border border-sand-300 hover:border-sage-400 rounded-full text-xs font-medium transition-colors"
              title={`${brand.name}の製品から探す`}
            >
              <Tag className="w-3 h-3 text-sage-600" />
              <span>{brand.name}</span>
              {brand.kana && <span className="text-[10px] text-gray-500">{brand.kana}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Candidates List / Cards Grid */}
      {candidates.length > 0 && (
        <div className="p-3 max-h-[340px] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {candidates.map((product) => {
              const countryBadge = getCountryBadge(product.country);
              return (
                <div
                  key={product.id}
                  className="bg-white rounded-xl p-3 border border-sand-200 hover:border-sage-400 hover:shadow-md transition-all flex flex-col justify-between group"
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span
                        className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-sm border ${countryBadge.color}`}
                      >
                        {countryBadge.label}
                      </span>
                      <div className="flex items-center gap-1">
                        {product.isQuasiDrug && (
                          <span className="text-[9px] bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.2 rounded-sm font-medium">
                            医薬部外品
                          </span>
                        )}
                        {product.fragranceFree && (
                          <span className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.2 rounded-sm">
                            無香料
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-[11px] font-bold text-sage-700 truncate">
                      {getDisplayBrand(product.brand, product.name)}
                    </div>
                    <h4 className="text-xs font-bold text-gray-900 line-clamp-2 leading-snug mt-0.5 group-hover:text-sage-800">
                      {product.name}
                    </h4>

                    {product.activeIngredientsJa && product.activeIngredientsJa.length > 0 ? (
                      <div className="mt-1 text-[10px] text-emerald-700 truncate bg-emerald-50 px-1.5 py-0.5 rounded-sm">
                        有効成分: {product.activeIngredientsJa.join(', ')}
                      </div>
                    ) : (
                      <div className="mt-1 text-[10px] text-gray-500 truncate">
                        主成分: {product.ingredients.slice(0, 3).join(', ')}
                      </div>
                    )}
                  </div>

                  {/* Card Actions */}
                  <div className="mt-2.5 pt-2 border-t border-sand-100 space-y-1.5">
                    <button
                      type="button"
                      onClick={() => onSelectProduct(product)}
                      className="w-full flex items-center justify-center gap-1 py-1.5 px-2 bg-sage-600 hover:bg-sage-700 text-white rounded-lg text-xs font-bold transition-colors shadow-2xs"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>成分を詳しくチェック</span>
                    </button>
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={() => onAddToBad(product)}
                        className="flex items-center justify-center gap-1 py-1 px-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-[10px] font-medium transition-colors"
                      >
                        <AlertTriangle className="w-3 h-3 text-rose-500" />
                        <span>肌荒れした</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onAddToSafe(product)}
                        className="flex items-center justify-center gap-1 py-1 px-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-[10px] font-medium transition-colors"
                      >
                        <ShieldCheck className="w-3 h-3 text-emerald-600" />
                        <span>普段使えている</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onAddToCurrent(product)}
                        className="flex items-center justify-center gap-1 py-1 px-1.5 bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded-lg text-[10px] font-medium transition-colors"
                      >
                        <Layers className="w-3 h-3 text-sky-600" />
                        <span>今使っている</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
