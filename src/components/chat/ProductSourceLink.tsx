'use client';

import React from 'react';
import { ExternalLink, Globe } from 'lucide-react';
import { Product } from '@/lib/types';
import { productSourceInfo } from '@/lib/product-source';

/** 製品の成分表示の出典（「出典: kao-kirei.com」）。出典が無い製品では何も出さない */
export const ProductSourceLink: React.FC<{ product: Product; className?: string }> = ({ product, className = '' }) => {
  const source = productSourceInfo(product);
  if (!source) return null;
  return (
    <div className={`flex items-center gap-1 text-[10px] text-gray-500 min-w-0 ${className}`}>
      <span className="shrink-0">出典:</span>
      {source.href ? (
        <a
          href={source.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title={source.label}
          className="flex items-center gap-0.5 min-w-0 py-1 text-sage-700 hover:text-sage-900 focus-visible:outline-2 focus-visible:outline-sage-600 underline underline-offset-2"
        >
          <span className="truncate">{source.label}</span>
          <span className="sr-only">（新しいタブで開く）</span>
          <ExternalLink className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
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
      className="shrink-0 whitespace-nowrap text-[10px] bg-sky-50 text-sky-800 border border-sky-200 px-1.5 py-0.5 rounded-md font-medium flex items-center gap-0.5"
      title="Web検索で見つけたページの全成分表示から読み取りました"
    >
      <Globe className="w-2.5 h-2.5" aria-hidden="true" />
      <span>Web検索</span>
    </span>
  );
};
