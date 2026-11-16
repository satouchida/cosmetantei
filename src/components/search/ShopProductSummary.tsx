'use client';

import React from 'react';
import { ExternalLink, Package } from 'lucide-react';
import { Product } from '@/lib/types';
import { displayListingName } from '@/lib/search/listing-name';
import { badge } from '../ui/design';

interface ShopProductSummaryProps {
  /** お店の商品検索の製品（src/lib/services/shop-lineup.ts） */
  product: Product;
}

/**
 * 出してよいリンク：https だけ。楽天のページは楽天アフィリエイトのリンクのときだけ（楽天ウェブサービスの規約。
 * サーバー側の shop-lineup.ts でも外しているが、ここでも確かめる）
 */
function isShowableLink({ href, sponsored }: NonNullable<Product['shopLink']>): boolean {
  try {
    const u = new URL(href);
    return u.protocol === 'https:' && (sponsored || !/(^|\.)rakuten\.(co|ne)\.jp$/.test(u.hostname));
  } catch {
    return false;
  }
}

const formatYen = (yen: number) => `¥${yen.toLocaleString('ja-JP')}`;

/**
 * お店の商品検索の製品のカード上部：写真・ブランド・商品名・価格。
 * 商品名は【公式】・送料無料などの飾りを外して出す（写真に重ねたときの説明と、ボタンの読み上げは元の名前のまま）。
 * お店の名前は出さない
 */
export const ShopProductSummary: React.FC<ShopProductSummaryProps> = ({ product }) => {
  // 写真が読めなければ代わりの絵にする（alt の文字が出ると商品名が見えてしまうので、alt は空）
  const [failed, setFailed] = React.useState(false);
  return (
    <div className="flex items-start gap-2.5">
      {product.imageUrl && !failed ? (
        // お店の画像サーバーの写真をそのまま表示する（next/image の変換は通さない）
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.imageUrl}
          alt=""
          title={product.name}
          width={64}
          height={64}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="w-16 h-16 shrink-0 rounded-lg object-contain bg-white border border-sand-200"
        />
      ) : (
        <div
          aria-hidden="true"
          title={product.name}
          className="w-16 h-16 shrink-0 rounded-lg bg-surface-container-low border border-sand-200 flex items-center justify-center"
        >
          <Package className="w-6 h-6 text-ink-muted" />
        </div>
      )}
      <div className="min-w-0">
        <div className="text-xs font-semibold text-sage-700 truncate">{product.brand}</div>
        <h3 className="text-[0.9375rem] font-semibold text-ink line-clamp-2 leading-snug mt-0.5 break-keep [overflow-wrap:anywhere]">
          {displayListingName(product.name, product.brand)}
        </h3>
        {product.shopPrice && (
          <div className="text-sm font-semibold text-ink mt-1">
            {formatYen(product.shopPrice.yen)}
            {product.shopPrice.taxIncluded === false && <span className="text-xs font-normal text-ink-muted">（税別）</span>}
          </div>
        )}
        <div className="mt-0.5 text-xs text-ink-muted">成分は選ぶと調べます</div>
        {product.shopLink && isShowableLink(product.shopLink) && (
          // 見えている文字（PR 商品ページ）を読み上げの頭に残し、商品名と新しいタブで開くことを後に足す
          <a
            href={product.shopLink.href}
            target="_blank"
            rel={product.shopLink.sponsored ? 'noopener noreferrer sponsored nofollow' : 'noopener noreferrer nofollow'}
            className="mt-1 inline-flex flex-wrap items-center gap-1 min-h-12 pr-2 text-sm font-semibold text-sage-700 hover:text-sage-900 underline underline-offset-2"
          >
            {product.shopLink.sponsored && (
              <span className={badge('neutral')}>PR</span>
            )}
            <span>商品ページ</span>
            <ExternalLink aria-hidden="true" className="w-3 h-3" />
            <span className="sr-only">（{product.name}、新しいタブで開く）</span>
          </a>
        )}
      </div>
    </div>
  );
};
