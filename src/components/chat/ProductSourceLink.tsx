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
  return (
    <div className={`flex items-center gap-1 text-xs text-ink-muted min-w-0 ${className}`}>
      <span className="shrink-0">出典:</span>
      {source.href ? (
        <a
          href={source.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
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
