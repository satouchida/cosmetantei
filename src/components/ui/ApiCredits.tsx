import React from 'react';
import type { PriceApiCredit } from '@/lib/types';

/**
 * 楽天・Yahoo! ショッピングの API のクレジット表示。
 * 各社のスニペットは公開されている HTML のまま置く（Yahoo! は HTML の改変・CSS での色や大きさの変更を禁止：
 * https://developer.yahoo.co.jp/attribution/ ）。整えるのは外側の並べ方だけ。
 *
 * Yahoo! のスニペットの span には margin:15px がある。flex の中に置くと span が flex アイテムになって
 * 上下の margin も効き、楽天のクレジットより下・右にずれる。そこで1行に1つ、中央寄せのふつうのブロックの
 * 中に置く（行内の span なので上下の margin は効かず、左右の margin は中央寄せで打ち消し合う）。
 * 色は外側でも変えない（Yahoo! は CSS で色を変えることも禁止。親の色は受け継がれるので、ここで薄い色にしない）。
 * 大きさは「極端に小さく」しなければよいので text-sm（14px）。既定の 16px のままだと、クレジットが画面で
 * いちばん目立つ要素になりかねない（これも禁止）
 */
export function ApiCredits({ credits, className = '' }: { credits: readonly PriceApiCredit[]; className?: string }) {
  if (credits.length === 0) return null;
  return (
    // data-allow-small-target：スニペットのリンクは変えられないので、押せる範囲を 44px に広げられない（scripts/check-responsive.mjs）
    <div data-allow-small-target className={`space-y-1 text-center text-sm text-ink ${className}`}>
      {credits.includes('rakuten') && (
        // 英語の文なので読み上げの言語を外側で指定する（スニペットには属性を足さない）
        <div lang="en">
          {/* Rakuten Web Services Attribution Snippet FROM HERE */}
          <a href="https://developers.rakuten.com/" target="_blank">
            Supported by Rakuten Developers
          </a>
          {/* Rakuten Web Services Attribution Snippet TO HERE */}
        </div>
      )}
      {credits.includes('yahoo') && (
        <div>
          {/* Begin Yahoo! JAPAN Web Services Attribution Snippet */}
          <span style={{ margin: '15px 15px 15px 15px' }}>
            <a href="https://developer.yahoo.co.jp/sitemap/">Webサービス by Yahoo! JAPAN</a>
          </span>
          {/* End Yahoo! JAPAN Web Services Attribution Snippet */}
        </div>
      )}
    </div>
  );
}
