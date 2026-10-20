'use client';

import React from 'react';
import { Product, SHOP_ID_PREFIX } from '@/lib/types';
import { Search, X, Sparkles, AlertTriangle, ShieldCheck, Layers, Tag, Package, ExternalLink } from 'lucide-react';
import { getDisplayBrand } from '@/lib/display-brand';
import {
  badge,
  buttonPrimary,
  countryLabel,
  iconButton,
  innerCard,
  routineAction,
  routineActionCompact,
  busyLook,
} from '../ui/design';

interface LiveSearchCandidateTrayProps {
  query: string;
  candidates: Product[];
  /** 検索語で始まるブランド（タップでブランド名を入力し、そのブランドの製品に絞り込む） */
  brands?: { name: string; kana?: string }[];
  onSelectBrand?: (brand: string) => void;
  /** お店の商品検索の製品を出しているときのクレジット（楽天・Yahoo! の規約で表示が必要） */
  credits?: ('rakuten' | 'yahoo')[];
  isOpen: boolean;
  onClose: () => void;
  onSelectProduct: (product: Product) => void;
  /** 応答を待っている（押しても受け付けず、案内が出る） */
  busy?: boolean;
  onAddToBad: (product: Product) => void;
  onAddToSafe: (product: Product) => void;
  onAddToCurrent: (product: Product) => void;
  /** 入力欄の aria-controls と同じ id */
  id?: string;
}

/** お店の商品検索の製品（src/lib/services/shop-lineup.ts）。成分はまだ分からない */
const isShopProduct = (p: Product) => p.id.startsWith(SHOP_ID_PREFIX);

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
 * お店の商品検索の製品のカード上部：写真・ブランド・価格。
 * 商品名には【公式】・送料無料などが付くので出さない（変えずに、写真に重ねたときの説明と、ボタンの読み上げにだけ使う）。
 * お店の名前も出さない
 */
const ShopProductSummary: React.FC<{ product: Product }> = ({ product }) => {
  // 写真が読めなければ代わりの絵にする（alt の文字が出ると商品名が見えてしまうので、alt は空）
  const [failed, setFailed] = React.useState(false);
  return (
  <div className="flex items-center gap-2.5">
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
      {product.shopPrice && (
        <div className="text-base font-semibold text-ink mt-0.5">
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
          className="mt-1 inline-flex items-center gap-1 min-h-12 pr-2 text-sm font-semibold text-sage-700 hover:text-sage-900 underline underline-offset-2"
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

export const LiveSearchCandidateTray: React.FC<LiveSearchCandidateTrayProps> = ({
  query,
  candidates,
  brands = [],
  onSelectBrand,
  credits = [],
  isOpen,
  onClose,
  onSelectProduct,
  busy = false,
  onAddToBad,
  onAddToSafe,
  onAddToCurrent,
  id,
}) => {
  if (!isOpen || (candidates.length === 0 && brands.length === 0)) return null;

  return (
    <div
      id={id}
      role="region"
      aria-labelledby={id ? `${id}-title` : undefined}
      // 候補の中で Escape を押したら閉じて入力欄に戻る（onClose が入力欄にフォーカスを戻す）
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      className="mb-2 bg-white rounded-2xl border border-sand-200 shadow-lg overflow-hidden animate-fade-in motion-reduce:animate-none transition-all"
    >
      {/* Tray Header */}
      <div className="flex items-center justify-between gap-2 pl-4 pr-1 py-1 bg-surface-container-low border-b border-sand-200">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 shrink-0 rounded-full bg-tint-safe text-primary flex items-center justify-center">
            <Search className="w-4 h-4" aria-hidden />
          </div>
          {/* 件数の読み上げは、常に置いてある入力欄側のステータスが行う（ここは開くたびに作り直されるため） */}
          <h2 id={id ? `${id}-title` : undefined} className="text-sm font-semibold text-ink">
            {candidates.length > 0
              ? `${query ? `「${query}」に関連するコスメ候補` : 'よく調べられているコスメ候補'} (${candidates.length}件)`
              : 'ブランドを選ぶと、そのブランドの製品に絞り込めます'}
          </h2>
          {candidates.length > 0 && (
            <span className="text-xs text-ink-muted hidden sm:inline">
              — タップして成分解析やリスト追加が可能です
            </span>
          )}
        </div>
        <button
          type="button"
          // 入力欄のフォーカスを保つ（タップでスマートフォンのキーボードを閉じたり開き直したりしない）
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClose}
          data-tray-close
          className={iconButton}
          title="閉じる"
          aria-label="候補を閉じる"
        >
          <X className="w-5 h-5" aria-hidden />
        </button>
      </div>

      {/* Brand chips */}
      {brands.length > 0 && onSelectBrand && (
        <div role="group" aria-label="ブランドの候補" className="flex flex-wrap items-center gap-2 px-3 pt-3">
          {brands.map((brand) => (
            <button
              key={brand.name}
              type="button"
              // 入力欄からフォーカスを外さない（スマートフォンのキーボードを閉じない）
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelectBrand(brand.name)}
              // 見えている読み仮名も名前に入れる（音声で操作する人が見えている文字で呼べるように）
              aria-label={`${brand.name}${brand.kana ? ` ${brand.kana}` : ''}の製品から探す`}
              className="flex items-center gap-1.5 min-h-12 px-4 bg-white hover:bg-tint-safe text-ink border border-sand-300 hover:border-emerald-500 rounded-full text-[13px] font-semibold transition-colors"
              title={`${brand.name}の製品から探す`}
            >
              <Tag className="w-4 h-4 text-primary" aria-hidden />
              <span>{brand.name}</span>
              {brand.kana && <span className="text-xs font-normal text-ink-muted">{brand.kana}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Candidates List / Cards Grid */}
      {candidates.length > 0 && (
        <div className="p-3 max-h-[min(420px,50dvh)] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {candidates.map((product) => {
              return (
                <div
                  key={product.id}
                  className={`${innerCard} p-3 text-ink flex flex-col justify-between`}
                >
                  {isShopProduct(product) ? (
                    <ShopProductSummary product={product} />
                  ) : (
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className={badge('neutral')}>{countryLabel(product.country)}</span>
                        <div className="flex items-center gap-1">
                          {product.isQuasiDrug && (
                            <span className={badge('brand')}>医薬部外品</span>
                          )}
                          {product.fragranceFree && (
                            <span className={badge('neutral')}>無香料</span>
                          )}
                        </div>
                      </div>

                      <div className="text-xs font-semibold text-sage-700 truncate">
                        {getDisplayBrand(product.brand, product.name)}
                      </div>
                      <h3 className="text-[15px] font-semibold text-ink line-clamp-2 leading-snug mt-0.5 break-keep [overflow-wrap:anywhere]">
                        {product.name}
                      </h3>

                      {product.activeIngredientsJa && product.activeIngredientsJa.length > 0 ? (
                        <div className="mt-1 text-xs text-emerald-900 truncate bg-tint-safe px-2 py-1 rounded-lg">
                          有効成分: {product.activeIngredientsJa.join(', ')}
                        </div>
                      ) : product.ingredients.length > 0 ? (
                        <div className="mt-1 text-xs text-ink-muted truncate">
                          主成分: {product.ingredients.slice(0, 3).join(', ')}
                        </div>
                      ) : null}
                    </div>
                  )}

                  {/* Card Actions */}
                  <div className="mt-3 pt-3 border-t border-sand-200 space-y-2">
                    <button
                      type="button"
                      onClick={() => onSelectProduct(product)}
                      aria-label={`${product.name}の成分を詳しくチェック`}
                      aria-disabled={busy || undefined}
                      className={`w-full ${buttonPrimary} ${busyLook}`}
                    >
                      <Sparkles className="w-4 h-4" aria-hidden />
                      <span>成分を詳しくチェック</span>
                    </button>
                    {/* 成分の分からない製品はリストに入れない（比較・組み合わせのチェックに使えない） */}
                    {product.ingredients.length > 0 && (
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => onAddToBad(product)}
                          aria-label={`肌荒れした（${product.name}）`}
                          className={`${routineActionCompact} ${routineAction.bad}`}
                        >
                          <AlertTriangle className="w-4 h-4" aria-hidden />
                          <span>肌荒れした</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onAddToSafe(product)}
                          aria-label={`普段使えている（${product.name}）`}
                          className={`${routineActionCompact} ${routineAction.safe}`}
                        >
                          <ShieldCheck className="w-4 h-4" aria-hidden />
                          <span>普段使えている</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onAddToCurrent(product)}
                          aria-label={`今使っている（${product.name}）`}
                          className={`${routineActionCompact} ${routineAction.current}`}
                        >
                          <Layers className="w-4 h-4" aria-hidden />
                          <span>今使っている</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {candidates.some((p) => p.shopLink?.sponsored) && (
        <p className="px-4 pb-1 text-xs text-ink-muted">
          PR：「PR」と書かれた「商品ページ」のリンクから購入されると、コスメ探偵が紹介料を受け取ることがあります。
        </p>
      )}

      {credits.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-4 pb-2 text-xs text-ink-muted">
          {credits.includes('rakuten') && (
            <>
              {/* Rakuten Web Services Attribution Snippet FROM HERE */}
              <a href="https://developers.rakuten.com/" target="_blank" lang="en">
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
