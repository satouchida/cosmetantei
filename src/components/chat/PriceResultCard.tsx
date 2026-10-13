'use client';

import React from 'react';
import { PriceResult } from '@/lib/types';
import { ExternalLink, Tag } from 'lucide-react';

interface PriceResultCardProps {
  result: PriceResult;
}

/** http(s) のリンクだけを開けるようにする */
function safeHref(url: string): string | undefined {
  return /^https?:\/\//i.test(url) ? url : undefined;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * 販売ページで確認した価格（安い順）。価格は保存せず、調べた時点のものとして表示する
 */
export const PriceResultCard: React.FC<PriceResultCardProps> = ({ result }) => {
  const checkedAt = new Date(result.checkedAt).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="my-3 p-4 bg-sand-50 rounded-2xl border border-sand-200 shadow-xs space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-sage-600 text-white flex items-center justify-center shadow-xs">
          <Tag className="w-4 h-4" />
        </div>
        <div>
          <h4 className="text-xs sm:text-sm font-bold text-gray-900">販売価格（{checkedAt}時点）</h4>
          <p className="text-[11px] text-gray-500">
            {result.offers.length > 0
              ? '販売ページに書かれていた価格です。購入前にページでご確認ください。'
              : '販売ページで確認できた価格はありません。'}
          </p>
        </div>
      </div>

      {result.offers.length > 0 && (
        <ul className="space-y-2">
          {result.offers.map((offer, i) => {
            const href = safeHref(offer.sourceUrl);
            return (
              <li
                key={`${offer.sourceUrl}-${i}`}
                className="bg-white rounded-xl p-3 border border-sand-200 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-bold text-gray-900">
                    {offer.priceYen.toLocaleString('ja-JP')}円
                    <span className="ml-1 text-[10px] font-medium text-gray-500">
                      {offer.taxIncluded === true ? '税込' : offer.taxIncluded === false ? '税抜' : '税表示なし'}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-600 truncate">{offer.productName}</div>
                  <div className="text-[10px] text-gray-400 truncate">{offer.shop}</div>
                </div>
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="shrink-0 flex items-center gap-1 text-[11px] text-sage-700 hover:text-sage-900 border border-sage-200 rounded-lg px-2 py-1"
                  >
                    <span>出典: {hostOf(href)}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {safeHref(result.amazonUrl) && (
        <a
          href={result.amazonUrl}
          target="_blank"
          rel="noopener noreferrer sponsored nofollow"
          className="w-full py-2 px-3 bg-linear-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-xs font-bold shadow-xs flex items-center justify-center gap-1.5"
        >
          <span>Amazonで探す</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  );
};
