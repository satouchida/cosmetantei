'use client';

import React from 'react';
import { Product } from '@/lib/types';
import { ShoppingBag, ExternalLink, ShieldCheck, Sparkles } from 'lucide-react';

interface AmazonAlternativeCardProps {
  products: Product[];
  avoidedIngredients?: string[];
}

export const AmazonAlternativeCard: React.FC<AmazonAlternativeCardProps> = ({
  products,
  avoidedIngredients = [],
}) => {
  if (!products || products.length === 0) return null;

  return (
    <div className="my-3 p-4 bg-gradient-to-br from-amber-50/60 via-sand-50 to-sage-50/60 rounded-2xl border border-amber-200/80 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-500 text-white flex items-center justify-center shadow-xs">
            <ShoppingBag className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs sm:text-sm font-bold text-gray-900 flex items-center gap-1.5">
              <span>原因成分を含まない安心の代替アイテム</span>
              <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-medium">
                Amazon
              </span>
            </h4>
            <p className="text-[11px] text-gray-500">
              敏感肌でも使いやすい低刺激・無香料処方の厳選コスメ
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
        {products.map((p) => {
          const amazonUrl = p.amazonSearchUrl || `https://www.amazon.co.jp/s?k=${encodeURIComponent(p.brand + ' ' + p.name)}&tag=cosmetantei-22`;

          return (
            <div
              key={p.id}
              className="bg-white rounded-xl p-3.5 border border-sand-200 shadow-2xs hover:shadow-md hover:border-amber-400 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                  <span className="font-bold text-sage-800">{p.brand}</span>
                  {p.isQuasiDrug && (
                    <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-medium border border-emerald-200">
                      医薬部外品
                    </span>
                  )}
                </div>

                <h5 className="text-xs sm:text-sm font-bold text-gray-900 line-clamp-2 leading-snug">
                  {p.name}
                </h5>

                <p className="text-[11px] text-gray-600 line-clamp-2 mt-1 leading-relaxed">
                  {p.descriptionJa}
                </p>

                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="text-[10px] bg-emerald-50 text-emerald-800 border border-emerald-200 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                    <ShieldCheck className="w-2.5 h-2.5 text-emerald-600" />
                    <span>原因成分フリー</span>
                  </span>
                  {p.fragranceFree && (
                    <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                      無香料
                    </span>
                  )}
                  {p.alcoholFree && (
                    <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                      ノンアルコール
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-sand-100">
                <a
                  href={amazonUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2 px-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs font-bold shadow-xs flex items-center justify-center gap-1.5 transition-all group"
                >
                  <span>Amazonで詳細・価格を見る</span>
                  <ExternalLink className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
