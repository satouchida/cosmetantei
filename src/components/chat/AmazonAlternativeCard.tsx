'use client';

import React from 'react';
import { Product } from '@/lib/types';
import { ShoppingBag, ExternalLink, ShieldCheck } from 'lucide-react';
import { ProductSourceLink, WebSearchBadge } from './ProductSourceLink';
import { badge, buttonPrimary, innerCard, panel } from '../ui/design';
import { CATEGORY_LABELS_JA, productCategory } from '@/lib/analyzer/product-category';

interface AmazonAlternativeCardProps {
  products: Product[];
  avoidedIngredients?: string[];
}

export const AmazonAlternativeCard: React.FC<AmazonAlternativeCardProps> = ({
  products,
}) => {
  if (!products || products.length === 0) return null;
  // 「同じ種類」と書くのは、全商品の種類がそろうときだけ（src/lib/analyzer/product-category.ts）
  const categories = new Set(products.map((p) => productCategory(p)));
  const category = categories.size === 1 ? [...categories][0] : undefined;
  const sameKind = category ? `同じ種類（${CATEGORY_LABELS_JA[category]}）で、` : '';

  return (
    <section className={`my-3 space-y-3 text-ink ${panel('safe', 'roomy')}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 shrink-0 rounded-full bg-primary text-on-primary flex items-center justify-center">
            <ShoppingBag className="w-4 h-4" aria-hidden />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold flex flex-wrap items-center gap-1.5">
              <span>原因成分を含まない安心の代替アイテム</span>
              <span className={badge('brand')}>Amazon</span>
              <span className={badge('neutral')}>PR</span>
            </h3>
            <p className="text-xs text-ink-muted">
              {sameKind}原因候補の成分と強い刺激成分を含まず、全成分を確認できた商品です
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {products.map((p) => {
          const amazonUrl = p.amazonSearchUrl || `https://www.amazon.co.jp/s?k=${encodeURIComponent(p.brand + ' ' + p.name)}&tag=cosmetantei-22`;

          return (
            <div
              key={p.id}
              className={`${innerCard} p-3.5 shadow-xs flex flex-col justify-between`}
            >
              <div>
                <div className="flex items-center justify-between gap-1 text-xs mb-1">
                  <span className="font-semibold text-sage-700 min-w-0 truncate">{p.brand}</span>
                  <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
                    <WebSearchBadge product={p} />
                    {p.isQuasiDrug && (
                      <span className={badge('brand')}>医薬部外品</span>
                    )}
                  </div>
                </div>

                <h4 className="text-[15px] font-semibold line-clamp-2 leading-snug break-keep [overflow-wrap:anywhere]">
                  {p.name}
                </h4>
                <ProductSourceLink product={p} className="mt-1" />

                <p className="text-xs text-ink-muted line-clamp-2 mt-1 leading-relaxed">
                  {p.descriptionJa}
                </p>

                <div className="mt-2 flex flex-wrap gap-1">
                  <span className={badge('safe')}>
                    <ShieldCheck className="w-3 h-3" aria-hidden />
                    <span>原因成分フリー</span>
                  </span>
                  {p.fragranceFree && (
                    <span className={badge('neutral')}>無香料</span>
                  )}
                  {p.alcoholFree && (
                    <span className={badge('neutral')}>ノンアルコール</span>
                  )}
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-sand-200">
                <a
                  href={amazonUrl}
                  target="_blank"
                  rel="noopener noreferrer sponsored nofollow"
                  className={`w-full ${buttonPrimary}`}
                >
                  <span>Amazonで詳細・価格を見る</span>
                  <ExternalLink className="w-4 h-4" aria-hidden />
                  <span className="sr-only">（新しいタブで開く）</span>
                </a>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ink-muted">
        PR：「Amazonで詳細・価格を見る」のリンクから購入されると、コスメ探偵が紹介料を受け取ることがあります。
      </p>
    </section>
  );
};
