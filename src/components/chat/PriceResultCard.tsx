'use client';

import React from 'react';
import { PriceResult } from '@/lib/types';
import { ExternalLink, Tag } from 'lucide-react';
import { badge, buttonPrimary, buttonSecondaryCompact, card, innerCard } from '../ui/design';

interface PriceResultCardProps {
  result: PriceResult;
}

/** http(s) のリンクだけを開けるようにする */
function safeHref(url: string): string | undefined {
  return /^https?:\/\//i.test(url) ? url : undefined;
}

/**
 * 販売ページで確認した価格（安い順）。価格は保存せず、調べた時点のものとして表示する
 * - アフィリエイトリンクがあれば「PR」と書く（景品表示法のステルスマーケティング規制）
 * - 楽天・Yahoo! の API で取得した価格を出すときは、各社の決まったクレジットを表示する（そのままの文言で）
 */
export const PriceResultCard: React.FC<PriceResultCardProps> = ({ result }) => {
  const checkedAt = new Date(result.checkedAt).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const sponsored = result.offers.some((o) => o.sponsored) || !!safeHref(result.amazonUrl);
  const credits = result.credits ?? [];

  return (
    <div className={`my-3 p-4 space-y-3 text-ink ${card}`}>
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 shrink-0 rounded-full bg-primary text-on-primary flex items-center justify-center">
          <Tag className="w-4 h-4" aria-hidden />
        </div>
        <div>
          <h2 className="text-[15px] font-semibold">
            販売価格（{checkedAt}時点）
            {sponsored && (
              <span className={`ml-1.5 align-middle ${badge('neutral')}`}>PR</span>
            )}
          </h2>
          <p className="text-xs text-ink-muted">
            {result.offers.length > 0
              ? '販売ページに書かれていた価格です。購入前にページでご確認ください。'
              : '販売ページで確認できた価格はありません。'}
          </p>
        </div>
      </div>

      {result.offers.length > 0 && (
        <ul role="list" className="space-y-2">
          {result.offers.map((offer, i) => {
            const href = safeHref(offer.href ?? offer.sourceUrl);
            return (
              <li
                key={`${offer.sourceUrl}-${i}`}
                className={`${innerCard} p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3`}
              >
                <div className="min-w-0">
                  <div className="text-base font-semibold">
                    {offer.priceYen.toLocaleString('ja-JP')}円
                    <span className="ml-1 text-xs font-normal text-ink-muted">
                      {offer.taxIncluded === true ? '税込' : offer.taxIncluded === false ? '税抜' : '税表示なし'}
                    </span>
                  </div>
                  <div className="text-xs text-ink truncate">{offer.productName}</div>
                  <div className="text-xs text-ink-muted truncate">
                    {offer.marketplace && offer.marketplace !== offer.shop
                      ? `${offer.marketplace}・${offer.shop}`
                      : offer.shop}
                  </div>
                </div>
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel={offer.sponsored ? 'noopener noreferrer sponsored nofollow' : 'noopener noreferrer nofollow'}
                    className={`shrink-0 w-full sm:w-auto ${buttonSecondaryCompact}`}
                  >
                    <span>{offer.marketplace || 'お店'}で見る</span>
                    <ExternalLink className="w-4 h-4" aria-hidden />
                    <span className="sr-only">（新しいタブで開く）</span>
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
          className={`w-full ${buttonPrimary}`}
        >
          <span>Amazonで探す</span>
          <ExternalLink className="w-4 h-4" aria-hidden />
          <span className="sr-only">（新しいタブで開く）</span>
        </a>
      )}

      {sponsored && (
        <p className="text-xs text-ink-muted">
          PR：このカードのリンクから購入されると、コスメ探偵が紹介料を受け取ることがあります。価格や表示の順番は紹介料に関係ありません。
        </p>
      )}

      {credits.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
          {credits.includes('rakuten') && (
            <>
              {/* Rakuten Web Services Attribution Snippet FROM HERE */}
              <a href="https://developers.rakuten.com/" target="_blank">
                Supported by Rakuten Developers
              </a>
              {/* Rakuten Web Services Attribution Snippet TO HERE */}
            </>
          )}
          {credits.includes('yahoo') && (
            <>
              {/* Begin Yahoo! JAPAN Web Services Attribution Snippet */}
              <span style={{ margin: '15px 15px 15px 15px' }}>
                <a href="https://developer.yahoo.co.jp/sitemap/">Webサービス by Yahoo! JAPAN</a>
              </span>
              {/* End Yahoo! JAPAN Web Services Attribution Snippet */}
            </>
          )}
        </div>
      )}
    </div>
  );
};
