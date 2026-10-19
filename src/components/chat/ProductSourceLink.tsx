'use client';

import React from 'react';
import { ExternalLink, Globe } from 'lucide-react';
import { Product } from '@/lib/types';
import { productSourceInfo } from '@/lib/product-source';
import { badge } from '../ui/design';

/** 製品の成分表示の出典（「出典: kao-kirei.com」）。出典が無い製品では何も出さない */
export const ProductSourceLink: React.FC<{ product: Product; className?: string }> = ({ product, className = '' }) => {
  const source = productSourceInfo(product);
  if (!source) return null;
  const translated = (product.ingredientsEn?.length ?? 0) > 0;
  return (
    <div className={className}>
      <div className="flex items-center gap-1 text-xs text-ink-muted min-w-0">
        <span className="shrink-0">出典:</span>
        {source.href ? (
          <a
            href={source.href}
            target="_blank"
            rel={product.ingredientSource === 'shop_listing' ? 'sponsored noopener noreferrer nofollow' : 'noopener noreferrer nofollow'}
            title={source.label}
            className="flex items-center gap-0.5 min-w-0 min-h-12 -my-2 text-sage-700 hover:text-sage-900 underline underline-offset-2"
          >
            <span className="truncate">{source.label}</span>
            <span className="sr-only">（新しいタブで開く）</span>
            <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
          </a>
        ) : (
          <span className="truncate" title={source.label}>
            {source.label}
          </span>
        )}
      </div>
      {translated && <p className="text-xs text-ink-muted">英語の成分表示を、AIで日本語の成分名に置き換えています。</p>}
      {product.ingredientSource === 'shop_listing' && (
        <div className="text-xs text-ink-muted">
          <p>販売ページの成分表示です。成分はパッケージで確かめてください。</p>
          {/* Rakuten Web Services Attribution Snippet FROM HERE */}
          <a href="https://developers.rakuten.com/" target="_blank" rel="noopener noreferrer">
            Supported by Rakuten Developers
          </a>
          {/* Rakuten Web Services Attribution Snippet TO HERE */}
        </div>
      )}
      {/* 信頼するサイト（src/lib/data/trusted-sites.ts）ではないページ。調べた本人にだけ出している */}
      {product.sharedSource === false && product.ingredientSource !== 'shop_listing' && (
        <p className="text-xs text-ink-muted">ほかのサイトの情報です。成分はパッケージで確かめてください。</p>
      )}
    </div>
  );
};

/** Web 検索で見つけたページから読み取った製品の印 */
export const WebSearchBadge: React.FC<{ product: Product }> = ({ product }) => {
  if (!productSourceInfo(product)?.fromWebSearch) return null;
  return (
    <span
      className={badge('neutral')}
      title="Web検索で見つけたページの全成分表示から読み取りました"
    >
      <Globe className="w-3 h-3" aria-hidden="true" />
      <span>Web検索</span>
    </span>
  );
};
