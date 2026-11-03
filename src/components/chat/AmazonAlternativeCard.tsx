'use client';

import React from 'react';
import { Product } from '@/lib/types';
import { ShoppingBag, ExternalLink, ShieldCheck, JapaneseYen } from 'lucide-react';
import { ProductSourceLink, WebSearchBadge } from './ProductSourceLink';
import { badge, buttonPrimaryCompact, buttonSecondaryCompact, busyLook, innerCard, panel } from '../ui/design';
import { CATEGORY_LABELS_JA, productCategory } from '@/lib/analyzer/product-category';
import { buildAmazonAffiliateUrl } from '@/lib/services/amazon-affiliate';
import { buildQoo10AffiliateUrl } from '@/lib/services/qoo10-affiliate';
import { isPersistable } from '@/lib/current-use';

interface AmazonAlternativeCardProps {
  products: Product[];
  avoidedIngredients?: string[];
  /** 楽天・Yahoo! などの価格を調べる（チャットの「この商品の価格を調べる」と同じ） */
  onPriceLookup?: (product: Product) => void;
  busy?: boolean;
}

export const AmazonAlternativeCard: React.FC<AmazonAlternativeCardProps> = ({
  products,
  onPriceLookup,
  busy = false,
}) => {
  if (!products || products.length === 0) return null;
  // 「同じ種類」と書くのは、全商品の種類がそろうときだけ（src/lib/analyzer/product-category.ts）
  const categories = new Set(products.map((p) => productCategory(p)));
  const category = categories.size === 1 ? [...categories][0] : undefined;
  const sameKind = category ? `同じ種類（${CATEGORY_LABELS_JA[category]}）で、` : '';

  return (
    <section className={`my-3 space-y-3 text-ink ${panel('safe', 'roomy')}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <div className="w-8 h-8 shrink-0 rounded-full bg-primary text-on-primary flex items-center justify-center">
            <ShoppingBag className="w-4 h-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold flex flex-wrap items-center gap-1.5">
              <span>原因候補の成分を含まない代わりの商品</span>
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
          // いつもその場で作る（保存された製品のリンクには、前のタグが付いていることがある）
          const amazonUrl = buildAmazonAffiliateUrl(p.brand, p.name);
          const qoo10Url = buildQoo10AffiliateUrl(p.brand, p.name);
          // サーバーが持っている製品だけ（入力した成分表示・お店の説明から読んだ製品は、サーバーが価格を調べない）
          const canPrice = !!onPriceLookup && isPersistable(p);

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
                    <span>原因候補の成分を含まない</span>
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
                  // 2列のカードの中なので左右の余白の小さいボタン（文字を大きくした画面でも入るように）
                  className={`w-full ${buttonPrimaryCompact}`}
                >
                  <span>Amazonで<wbr />詳細・価格を<wbr />見る</span>
                  <ExternalLink className="w-4 h-4" aria-hidden />
                  <span className="sr-only">（{p.name}、新しいタブで開く）</span>
                </a>
                {(canPrice || qoo10Url) && (
                  // 補助の操作は枠線のボタンで横に並べる（片方だけなら1つで幅いっぱい）
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {canPrice && (
                      <button
                        type="button"
                        onClick={() => onPriceLookup(p)}
                        aria-label={`価格を比べる（${p.name}）`}
                        aria-disabled={busy || undefined}
                        className={`${qoo10Url ? '' : 'col-span-2'} ${buttonSecondaryCompact} ${busyLook}`}
                      >
                        <JapaneseYen className="w-4 h-4 shrink-0" aria-hidden />
                        <span>価格を<wbr />比べる</span>
                      </button>
                    )}
                    {qoo10Url && (
                      <a
                        href={qoo10Url}
                        target="_blank"
                        rel="noopener noreferrer sponsored nofollow"
                        className={`${canPrice ? '' : 'col-span-2'} ${buttonSecondaryCompact}`}
                      >
                        <span>Qoo10で<wbr />探す</span>
                        <ExternalLink className="w-4 h-4 shrink-0" aria-hidden />
                        <span className="sr-only">（{p.name}、新しいタブで開く）</span>
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ink-muted">
        PR：「Amazonで詳細・価格を見る」「Qoo10で探す」のリンクから購入されると、コスメ探偵が紹介料を受け取ることがあります。<br />
        ※「Amazonで詳細・価格を見る」「Qoo10で探す」は商品名での検索結果のページを開きます。別の商品や、成分の違う並行輸入品などが含まれることがあるため、購入前に販売ページ・パッケージの全成分表示をご確認ください。
      </p>
    </section>
  );
};
