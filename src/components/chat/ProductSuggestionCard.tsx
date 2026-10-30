'use client';

import React from 'react';
import { ApiCredits } from '../ui/ApiCredits';
import { PriceApiCredit, Product } from '@/lib/types';
import { AlertTriangle, ShieldCheck, Layers, Search, ExternalLink } from 'lucide-react';
import { buildAmazonAffiliateUrl } from '@/lib/services/amazon-affiliate';
import { buildQoo10AffiliateUrl } from '@/lib/services/qoo10-affiliate';
import { getDisplayBrand } from '@/lib/display-brand';
import { productSourceInfo } from '@/lib/product-source';
import { quasiDrugActives } from '@/lib/quasi-drug';
import { ProductSourceLink, WebSearchBadge } from './ProductSourceLink';
import {
  activesLine,
  badge,
  busyLook,
  buttonPrimary,
  buttonSecondary,
  innerCard,
  routineAction,
  routineActionCompact,
  routineActionGrid,
  cardActionsBox,
  textLink,
} from '../ui/design';

interface ProductSuggestionCardProps {
  products: Product[];
  onSelectToAnalyze: (product: Product) => void;
  onAddToBad: (product: Product) => void;
  onAddToSafe: (product: Product) => void;
  onAddToCurrent: (product: Product) => void;
  /** 原因成分を含まない代わりの商品（見出しと注意書きを変える） */
  isAlternatives?: boolean;
  /** 応答を待っている（押しても受け付けず、案内が出る） */
  busy?: boolean;
  /** お店の商品があるときに表示するクレジット（楽天ウェブサービス・Yahoo! JAPAN） */
  credits?: PriceApiCredit[];
}

/**
 * 出してよい販売ページのリンク：https だけ。楽天のページは楽天アフィリエイトのリンクのときだけ（楽天ウェブサービスの規約。
 * サーバー側でも外しているが、ここでも確かめる）
 */
function showableShopLink(link: Product['shopLink']): link is NonNullable<Product['shopLink']> {
  if (!link) return false;
  try {
    const u = new URL(link.href);
    return u.protocol === 'https:' && (link.sponsored || !/(^|\.)rakuten\.(co|ne)\.jp$/.test(u.hostname));
  } catch {
    return false;
  }
}

/** お店の写真（お店の画像サーバーのものだけがサーバーから届く）。読めなければ出さない */
const ShopPhoto: React.FC<{ src: string }> = ({ src }) => {
  const [failed, setFailed] = React.useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- お店の画像サーバーの写真をそのまま表示する
    <img
      src={src}
      alt=""
      width={64}
      height={64}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="w-16 h-16 shrink-0 rounded-lg object-contain bg-white border border-sand-200"
    />
  );
};

export const ProductSuggestionCard: React.FC<ProductSuggestionCardProps> = ({
  products,
  onSelectToAnalyze,
  onAddToBad,
  onAddToSafe,
  onAddToCurrent,
  isAlternatives = false,
  busy = false,
  credits = [],
}) => {
  if (!products || products.length === 0) return null;
  const anyFromWeb = products.some((p) => productSourceInfo(p)?.fromWebSearch);

  return (
    <div className="my-3 space-y-2.5">
      {/* 代わりの商品は販売ページ・Amazon へのアフィリエイトのリンクを含むので、冒頭に「PR」を出す（ステマ規制の運用基準） */}
      <div className="flex items-center gap-1.5">
        <p className="text-sm font-semibold text-ink-muted">
          {isAlternatives ? '避けたい成分を含まないコスメ:' : '該当するコスメ（タップして選択）:'}
        </p>
        {isAlternatives && <span className={badge('neutral')}>PR</span>}
      </div>
      {isAlternatives && anyFromWeb && (
        <p className="text-xs text-ink-muted leading-relaxed">
          「Web検索」の商品は、Web検索で見つけたページの全成分表示を読み取り、アプリで成分を確かめたものです。出典のページと、購入時のパッケージの表示もご確認ください。
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {products.map((p) => {
          const actives = quasiDrugActives(p);
          return (
            <div
              key={p.id}
              className={`${innerCard} p-3.5 shadow-xs flex flex-col justify-between text-ink`}
            >
              <div>
                <div className="flex items-start gap-2.5">
                  {isAlternatives && p.imageUrl && <ShopPhoto src={p.imageUrl} />}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-sage-700">{getDisplayBrand(p.brand, p.name)}</div>
                    <h2 className="text-[15px] font-semibold line-clamp-2 mt-0.5 leading-snug break-keep [overflow-wrap:anywhere]">
                      {p.name}
                    </h2>
                    {isAlternatives && p.shopPrice && (
                      <p className="text-sm font-semibold text-ink mt-0.5">
                        ¥{p.shopPrice.yen.toLocaleString('ja-JP')}
                        <span className="ml-1 text-xs font-normal text-ink-muted">
                          （{[p.shopPrice.taxIncluded === true ? '税込' : p.shopPrice.taxIncluded === false ? '税別' : null, '検索時点']
                            .filter(Boolean)
                            .join('・')}）
                        </span>
                      </p>
                    )}
                  </div>
                </div>
                <ProductSourceLink product={p} className="mt-1" />

                {/* バッジは名前の下にまとめる（上に置くと、バッジのないカードと隣どうしでブランド名の高さがずれる） */}
                <div className="mt-1.5 flex flex-wrap items-center gap-1 empty:hidden">
                  <WebSearchBadge product={p} />
                  {p.isQuasiDrug && (
                    <span className={badge('brand')}>医薬部外品</span>
                  )}
                  {p.fragranceFree && (
                    <span className={badge('neutral')}>無香料</span>
                  )}
                  {p.alcoholFree && (
                    <span className={badge('neutral')}>アルコールフリー</span>
                  )}
                </div>

                {actives.length > 0 && (
                  <div className={`mt-1.5 ${activesLine}`}>
                    <span className="font-semibold">有効成分:</span> {actives.join(', ')}
                  </div>
                )}

                {p.barcode && (
                  <div className="mt-2 text-xs text-ink-muted font-mono">
                    JAN:{p.barcode}
                  </div>
                )}
              </div>

              {/* 代わりの商品：販売ページ（アフィリエイトのリンク）と Amazon の検索 */}
              {isAlternatives && (
                <div className="mt-3 space-y-1.5">
                  {showableShopLink(p.shopLink) && (
                    <a
                      href={p.shopLink.href}
                      target="_blank"
                      rel={p.shopLink.sponsored ? 'sponsored noopener noreferrer nofollow' : 'noopener noreferrer nofollow'}
                      className={`w-full ${buttonSecondary}`}
                    >
                      <span>販売ページを見る</span>
                      <ExternalLink className="w-4 h-4" aria-hidden />
                      <span className="sr-only">（{p.name}、新しいタブで開く）</span>
                    </a>
                  )}
                  {/* 検索のリンクは横に並べる（狭い画面では折り返す） */}
                  <div className="flex flex-wrap gap-x-4">
                    <a
                      href={buildAmazonAffiliateUrl(p.brand, p.name)}
                      target="_blank"
                      rel="sponsored noopener noreferrer nofollow"
                      className={`inline-flex min-h-12 items-center gap-1 text-sm ${textLink}`}
                    >
                      Amazonで探す
                      <span className="sr-only">（{p.name}、新しいタブで開く）</span>
                    </a>
                    <a
                      href={buildQoo10AffiliateUrl(p.brand, p.name)}
                      target="_blank"
                      rel="sponsored noopener noreferrer nofollow"
                      className={`inline-flex min-h-12 items-center gap-1 text-sm ${textLink}`}
                    >
                      Qoo10で探す
                      <span className="sr-only">（{p.name}、新しいタブで開く）</span>
                    </a>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className={`mt-3.5 ${cardActionsBox}`}>
                <button
                  type="button"
                  onClick={() => onSelectToAnalyze(p)}
                  // 同じ文のボタンが並ぶので、読み上げでは商品名を足す（見えている文は先頭に残す）
                  aria-label={`成分を詳しくチェック（${p.name}）`}
                  aria-disabled={busy || undefined}
                  className={`w-full ${buttonPrimary} ${busyLook}`}
                >
                  <Search className="w-4 h-4" aria-hidden />
                  <span>成分を<wbr />詳しく<wbr />チェック</span>
                </button>
                <div className={routineActionGrid}>
                  <button
                    type="button"
                    onClick={() => onAddToBad(p)}
                    aria-label={`肌荒れした（${p.name}）`}
                    className={`${routineActionCompact} ${routineAction.bad}`}
                  >
                    <AlertTriangle className="w-4 h-4" aria-hidden />
                    <span>肌荒れ<wbr />した</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddToSafe(p)}
                    aria-label={`普段使えている（${p.name}）`}
                    className={`${routineActionCompact} ${routineAction.safe}`}
                  >
                    <ShieldCheck className="w-4 h-4" aria-hidden />
                    <span>普段<wbr />使えている</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddToCurrent(p)}
                    aria-label={`今使っている（${p.name}）`}
                    className={`${routineActionCompact} ${routineAction.current}`}
                  >
                    <Layers className="w-4 h-4" aria-hidden />
                    <span>今<wbr />使っている</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {isAlternatives && (
        <p className="text-xs text-ink-muted">
          PR：「販売ページを見る」「Amazonで探す」「Qoo10で探す」のリンクから購入されると、コスメ探偵が紹介料を受け取ることがあります。価格は検索した時点のものです。
        </p>
      )}
      <ApiCredits credits={credits} />
    </div>
  );
};
