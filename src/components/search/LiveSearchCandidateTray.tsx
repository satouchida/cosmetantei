'use client';

import React from 'react';
import { ApiCredits } from '../ui/ApiCredits';
import { Product, SHOP_ID_PREFIX } from '@/lib/types';
import { Search, X, Sparkles, AlertTriangle, ShieldCheck, Tag } from 'lucide-react';
import { getDisplayBrand } from '@/lib/display-brand';
import { isSellerTextProduct } from '@/lib/product-source';
import { ordinaryIngredients, quasiDrugActives } from '@/lib/quasi-drug';
import {
  activesLine,
  badge,
  buttonPrimary,
  iconButton,
  innerCard,
  routineAction,
  routineActionCompact,
  routineActionGrid,
  cardActionsBox,
  busyLook,
} from '../ui/design';
import { ShopProductSummary } from './ShopProductSummary';
import { ScrollWithFade } from './ScrollWithFade';

interface LiveSearchCandidateTrayProps {
  query: string;
  candidates: Product[];
  /** 検索語で始まるブランド（タップでブランド名を入力し、そのブランドの製品に絞り込む） */
  brands?: { name: string; kana?: string }[];
  onSelectBrand?: (brand: string) => void;
  /**
   * お店の商品検索の製品・Yahoo! の商品説明から成分を読んだ製品を出しているときのクレジット
   * （楽天・Yahoo! の規約で表示が必要）
   */
  credits?: ('rakuten' | 'yahoo')[];
  isOpen: boolean;
  onClose: () => void;
  onSelectProduct: (product: Product) => void;
  /** 応答を待っている（押しても受け付けず、案内が出る） */
  busy?: boolean;
  onAddToBad: (product: Product) => void;
  onAddToUsable: (product: Product) => void;
  /** 入力欄の aria-controls と同じ id */
  id?: string;
}

/** お店の商品検索の製品（src/lib/services/shop-lineup.ts）。成分はまだ分からない */
const isShopProduct = (p: Product) => p.id.startsWith(SHOP_ID_PREFIX);

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
  onAddToUsable,
  id,
}) => {
  if (!isOpen || (candidates.length === 0 && brands.length === 0)) return null;
  const hasSponsored = candidates.some((p) => p.shopLink?.sponsored);

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
              className="flex items-center gap-1.5 min-h-12 px-4 bg-white hover:bg-tint-safe active:bg-emerald-100 text-ink border border-sand-300 hover:border-emerald-500 rounded-full text-[0.8125rem] font-semibold transition-colors"
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
        <ScrollWithFade className="max-h-[min(420px,50dvh)]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {candidates.map((product) => {
              const actives = quasiDrugActives(product);
              const listed = actives.length > 0 ? [] : ordinaryIngredients(product);
              return (
                <div
                  key={product.id}
                  className={`${innerCard} p-3 text-ink flex flex-col justify-between`}
                >
                  {isShopProduct(product) ? (
                    <ShopProductSummary product={product} />
                  ) : (
                    <div>
                      <div className="text-xs font-semibold text-sage-700 truncate">
                        {getDisplayBrand(product.brand, product.name)}
                      </div>
                      <h3 className="text-[0.9375rem] font-semibold text-ink line-clamp-2 leading-snug mt-0.5 break-keep [overflow-wrap:anywhere]">
                        {product.name}
                      </h3>

                      {/* バッジは名前の下（ProductSuggestionCard と同じ並び） */}
                      <div className="mt-1 flex flex-wrap items-center gap-1 empty:hidden">
                        {product.isQuasiDrug && (
                          <span className={badge('brand')}>医薬部外品</span>
                        )}
                        {product.fragranceFree && (
                          <span className={badge('neutral')}>無香料</span>
                        )}
                      </div>

                      {/* 出品者が書いた成分表示（カードの出典と同じ。src/components/chat/ProductSourceLink.tsx） */}
                      {isSellerTextProduct(product) && (
                        <div className="mt-1 text-xs text-ink-muted">販売ページの成分表示</div>
                      )}

                      {actives.length > 0 ? (
                        <div className={`mt-1 ${activesLine}`}>
                          {/* 2 行で切る箱は余白の内側に置く（余白に 3 行目がのぞかない） */}
                          <div className="line-clamp-2">
                            <span className="font-semibold">有効成分:</span> {actives.join(', ')}
                          </div>
                        </div>
                      ) : listed.length > 0 ? (
                        <div className="mt-1 text-xs text-ink-muted truncate">
                          {/* 先頭の 3 つを出すだけ（医薬部外品の「その他の成分」は配合量の順とは限らないので「主成分」とは書かない） */}
                          全成分（先頭3つ）: {listed.slice(0, 3).join(', ')}
                        </div>
                      ) : null}
                    </div>
                  )}

                  {/* Card Actions */}
                  <div className={`mt-3 ${cardActionsBox}`}>
                    <button
                      type="button"
                      onClick={() => onSelectProduct(product)}
                      aria-label={`${product.name}の成分を詳しくチェック`}
                      aria-disabled={busy || undefined}
                      className={`w-full ${buttonPrimary} ${busyLook}`}
                    >
                      <Sparkles className="w-4 h-4" aria-hidden />
                      <span>成分を<wbr />詳しく<wbr />チェック</span>
                    </button>
                    {/* 成分の分からない製品はリストに入れない（比較・組み合わせのチェックに使えない） */}
                    {product.ingredients.length > 0 && (
                      <div className={routineActionGrid}>
                        <button
                          type="button"
                          onClick={() => onAddToBad(product)}
                          aria-label={`肌荒れした（${product.name}）`}
                          className={`${routineActionCompact} ${routineAction.bad}`}
                        >
                          <AlertTriangle className="w-4 h-4" aria-hidden />
                          <span>肌荒れ<wbr />した</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onAddToUsable(product)}
                          aria-label={`使えている（${product.name}）`}
                          className={`${routineActionCompact} ${routineAction.safe}`}
                        >
                          <ShieldCheck className="w-4 h-4" aria-hidden />
                          <span>使えて<wbr />いる</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollWithFade>
      )}

      {/* 候補の一覧（スクロールする）と区切って、PR の説明とクレジットを置く */}
      {(hasSponsored || credits.length > 0) && (
        <div className="px-4 pt-2 pb-2 border-t border-sand-200 space-y-1">
          {hasSponsored && (
            <p className="text-xs text-ink-muted">
              PR：「PR」と書かれた「商品ページ」のリンクから購入されると、コスメ探偵が紹介料を受け取ることがあります。
            </p>
          )}
          <ApiCredits credits={credits} />
        </div>
      )}
    </div>
  );
};
