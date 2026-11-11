'use client';

import React, { useRef } from 'react';
import { Product, ProductAnalysisResult, AnalyzedIngredient } from '@/lib/types';
import { ShieldCheck, AlertTriangle, AlertCircle, Info, Sparkles, HelpCircle, Globe, Loader2, Search } from 'lucide-react';
import { AmazonAlternativeCard } from './AmazonAlternativeCard';
import { useUnregisteredProducts } from './RegisteredProducts';
import { ProductSourceLink } from './ProductSourceLink';
import { MedicalNotice } from './MedicalNotice';
import { IngredientDetailPanel } from './IngredientDetailPanel';
import { useAIAnalysis } from './useAIAnalysis';
import { useIngredientExplanation } from './useIngredientExplanation';
import { isUserLabelProduct } from '@/lib/product-source';
import { mildCautionNames } from '@/lib/caution-reason';
import { isIrritantLevel, legendEntries, outsideStandard, pillMark, riskLabelFor } from './ingredient-marks';
import { productCategory } from '@/lib/analyzer/product-category';
import {
  badge as badgeClass,
  busyLook,
  buttonSecondary,
  card,
  panel,
  riskBadge,
  riskOf,
  routineAction,
  routineActionWide,
  textLink,
  type Tone,
} from '../ui/design';

interface IngredientAnalysisCardProps {
  analysis: ProductAnalysisResult;
  onAddToBadRoutine?: () => void;
  onAddToUsableRoutine?: () => void;
  /** 「同じ種類で原因成分を含まない商品を探す」（お店の商品検索で探す。docs/plans/alternative-recommendations.md の step 3） */
  onFindAlternatives?: () => void;
  /** 代わりの商品の価格を調べる */
  onPriceLookup?: (product: Product) => void;
  /** 応答を待っている（押しても受け付けず、案内が出る） */
  busy?: boolean;
}

/** 肌を整える・うるおいを保つ成分のうち、開かずに見える数 */
const SOOTHING_SHOWN = 2;

export const IngredientAnalysisCard: React.FC<IngredientAnalysisCardProps> = ({
  analysis: initialAnalysis,
  onAddToBadRoutine,
  onAddToUsableRoutine,
  onFindAlternatives,
  onPriceLookup,
  busy = false,
}) => {
  // 成分の解説の見出し（開いたとき・AI の解説が届いたときにフォーカスを移す）
  const detailTitleRef = useRef<HTMLDivElement | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  // カード（「もう一度調べる」を押したとき、ボタンが消えるのでここへフォーカスを移す）
  const cardRef = useRef<HTMLDivElement | null>(null);
  // 未評価の成分の AI の評価（useAIAnalysis.ts）。届いたら analysis が差し替わる
  const { analysis, aiStatus, aiError, aiRejected, aiEvaluation, retryAIAnalysis } = useAIAnalysis(initialAnalysis, cardRef);
  // 代わりの商品のうち、比較リストに登録していないもの（カードに出る数。RegisteredProducts.tsx）
  const shownAlternatives = useUnregisteredProducts(analysis.safeAlternatives ?? []);
  // 開いている成分と「AIでさらに詳しく調べる」（useIngredientExplanation.ts）
  const { selectedIngredient, explainingName, explainError, explainStatus, selectIngredient, closeIngredient, handleExplainWithAI } =
    useIngredientExplanation(analysis, detailTitleRef, detailRef);
  const {
    product,
    overallRiskLevel,
    summaryJa,
    warningsJa,
    soothingHighlightsJa,
    ingredients,
    safeAlternatives,
    isEstimatedFromMarketplaces,
    dataSourceDisclaimer,
    labelNotesJa,
    labelReferences,
    outsideJpStandard,
  } = analysis;
  const mildNames = mildCautionNames(analysis);
  const legend = legendEntries(ingredients);

  const getOverallBadge = (): { title: string; tone: Tone; icon: typeof ShieldCheck } => {
    switch (overallRiskLevel) {
      case 'safe':
        // 日本の化粧品基準で配合できない成分があるときは、緑の見出しにしない（成分の注意は下の欄に出る）
        if (outsideJpStandard) return { title: '日本の化粧品基準の注意あり', tone: 'neutral', icon: AlertCircle };
        return { title: '刺激になりやすい成分なし（目安）', tone: 'safe', icon: ShieldCheck };
      case 'caution':
        return { title: '敏感肌はやや注意', tone: 'caution', icon: AlertTriangle };
      case 'warning':
        return { title: '刺激・アレルゲン成分あり', tone: 'warning', icon: AlertCircle };
      case 'insufficient_data':
        return { title: '成分データ不足で判定できません', tone: 'neutral', icon: HelpCircle };
    }
  };

  const aiIngredients = ingredients.filter((i) => i.aiEvaluated);

  const badge = getOverallBadge();
  const IconComponent = badge.icon;

  const getPillStyle = (ing: AnalyzedIngredient) => {
    // 化粧品基準で配合できない成分は、見出しの理由なので白地に赤の枠（「高」の赤い塗り・未評価の点線と分ける）
    // 刺激の段階（高・刺・活）の成分は、その段階の色のまま（印に「基準」を足す）
    if (outsideStandard(ing) && !isIrritantLevel(ing)) return 'bg-white text-rose-900 border-rose-400 hover:bg-rose-50 font-semibold';
    // 表示指定成分で引き上げただけの成分（「表」）は白地に黄の枠（黄の塗りの「注」と分ける。緑とも並べない）
    if (ing.raisedForLabel) return 'bg-white text-amber-900 border-amber-400 hover:bg-amber-50';
    // 肌を整える・うるおいを保つ成分は安全の緑で目立たせる
    if (ing.riskLevel === 'safe' && (ing.category === 'soothing' || ing.category === 'barrier_support')) {
      return 'bg-tint-safe text-emerald-900 border-emerald-300 hover:bg-emerald-100 font-semibold';
    }
    return riskOf(ing.riskLevel).pill;
  };

  return (
    <div ref={cardRef} tabIndex={-1} data-analysis-card className={`my-3 p-4 sm:p-5 space-y-4 text-ink focus:outline-none ${card}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 pb-3 border-b border-sand-200">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-sage-700">{product.brand}</span>
            {isEstimatedFromMarketplaces && (
              <span className={badgeClass('brand')}>
                <Globe className="w-3 h-3" aria-hidden />
                <span>Web探索成分データ</span>
              </span>
            )}
          </div>
          <h2 className="text-lg font-semibold text-ink leading-snug mt-0.5 break-keep [overflow-wrap:anywhere]">
            {product.name}
          </h2>
          <ProductSourceLink product={product} className="mt-1" />
        </div>
        <div className={`self-start ${badgeClass(badge.tone, 'large')}`}>
          <IconComponent className="w-4 h-4" aria-hidden />
          <span>{badge.title}</span>
        </div>
      </div>

      {/* Summary Box */}
      <p className="text-sm leading-relaxed">{summaryJa}</p>
      {/* 「やや注意」の理由が軽度の注意の成分だけのときは、その名前を出す（注意・刺激成分の枠には出ない）。
          軽い段階なので、色の付いた枠にはしない */}
      {mildNames.length > 0 && (
        <p className="text-sm leading-relaxed">
          {riskOf('low_caution').label}の成分（{mildNames.length}成分）: {mildNames.join('、')}
        </p>
      )}

      {/* 成分データに無い成分の AI の評価（読み上げで知らせる枠は先に置いておく） */}
      {/* 空のときは間隔を取らない（親の space-y の下余白を消す） */}
      <div role="status" className="empty:mb-0">
        {aiStatus === 'loading' && (
          <p className={`flex items-center gap-2 ${panel('neutral', 'small')}`}>
            <Loader2 className="w-4 h-4 shrink-0 animate-spin motion-reduce:animate-none text-ink-muted" aria-hidden />
            <span>成分データに無い{analysis.riskCounts.unknown}成分を、AIで調べています…</span>
          </p>
        )}
        {aiStatus === 'failed' && (
          <div className={`space-y-2 ${panel('neutral', 'small')}`}>
            {/* 回数の制限など、サーバーが理由を付けたときはそれを出す（「1つずつ調べて」と勧めても同じ制限に当たる） */}
            <p>{aiError ?? '成分データに無い成分を、AIで調べられませんでした。成分をタップすると、1つずつAIで調べられます。'}</p>
            {!aiRejected && (
              <button type="button" onClick={retryAIAnalysis} className={buttonSecondary}>
                もう一度調べる
              </button>
            )}
          </div>
        )}
      </div>
      {/* 完了の読み上げは、見えない別の枠で（上の枠に入れると、空でなくなって余白ができる） */}
      <div role="status" className="sr-only">
        {aiEvaluation && `AIで${aiEvaluation.evaluatedCount}成分を評価し、結果に反映しました。`}
      </div>
      {/* 「AIでさらに詳しく調べる」の開始・完了の読み上げ（いつも置いておく） */}
      <div role="status" className="sr-only">
        {explainStatus}
      </div>
      {/* 変わらない案内は、読み上げの枠の外に置く（描き直すたびに読み上げない） */}
      {isUserLabelProduct(analysis.product) && analysis.riskCounts.unknown > 0 && (
        <p className={panel('neutral', 'small')}>
          入力した成分表示は、まとめてAIに送りません。未評価の成分は、タップすると1つずつAIで調べられます。
        </p>
      )}

      {/* 医薬部外品の成分表示の読み方（記載順・名称が表示されていない成分） */}
      {labelNotesJa && labelNotesJa.length > 0 && (
        <div className={`flex items-start gap-2 ${panel('neutral', 'small')}`}>
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-ink-muted" aria-hidden />
          <div className="space-y-0.5 text-ink-muted">
            {labelNotesJa.map((note, i) => (
              <p key={i}>{note}</p>
            ))}
            {labelReferences && labelReferences.length > 0 && (
              <p className="pt-0.5">
                成分名と表示のきまり:{' '}
                {labelReferences.map((ref, i) => (
                  <span key={ref.url}>
                    {i > 0 && '、'}
                    <a href={ref.url} target="_blank" rel="noopener noreferrer" className={textLink}>
                      {ref.title}
                      <span className="sr-only">（新しいタブで開く）</span>
                    </a>
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Online Marketplace Disclaimer Banner (if ingredients were retrieved from web/marketplace) */}
      {dataSourceDisclaimer && (
        <div className={`flex items-start gap-2 animate-fade-in ${panel('caution', 'small')}`}>
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" aria-hidden />
          <div className="space-y-0.5">
            <span className="font-semibold block">
              <span aria-hidden>🌐 </span>オンラインマーケットプレイス収集情報に関するご注意
            </span>
            <p>{dataSourceDisclaimer}</p>
          </div>
        </div>
      )}

      {/* Warnings & Highlights */}
      {warningsJa.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-rose-800">
            <AlertCircle className="w-4 h-4" aria-hidden />
            <span>敏感肌への注意・刺激成分</span>
          </h3>
          <ul role="list" className="space-y-1.5">
            {warningsJa.map((w, i) => (
              <li key={i} className={panel('warning')}>
                {w}
              </li>
            ))}
          </ul>
        </section>
      )}

      {soothingHighlightsJa.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-emerald-800">
            <Sparkles className="w-4 h-4" aria-hidden />
            <span>肌を整える・うるおいを保つ成分</span>
          </h3>
          {/* スマホで全成分リストが画面の外に押し出されないよう、最初の2つだけ出し、残りは開いて読む */}
          <ul role="list" className="space-y-1.5">
            {soothingHighlightsJa.slice(0, SOOTHING_SHOWN).map((h, i) => (
              <li key={i} className={panel('safe')}>
                {h}
              </li>
            ))}
          </ul>
          {soothingHighlightsJa.length > SOOTHING_SHOWN && (
            <details>
              <summary className="py-3 cursor-pointer text-sm leading-5 font-semibold text-emerald-800">
                ほか{soothingHighlightsJa.length - SOOTHING_SHOWN}成分の説明
              </summary>
              <ul role="list" className="space-y-1.5">
                {soothingHighlightsJa.slice(SOOTHING_SHOWN).map((h, i) => (
                  <li key={i} className={panel('safe')}>
                    {h}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {aiIngredients.length > 0 && (
        <details className={panel('neutral')}>
          <summary className="min-h-12 -my-3 flex items-center gap-1.5 cursor-pointer font-semibold">
            <Sparkles className="w-4 h-4 shrink-0" aria-hidden />
            <span>AIが評価した成分（{aiIngredients.length}成分）</span>
          </summary>
          <p className="mt-2 text-xs text-ink-muted">
            成分データに無い成分を、AIが皮膚科学の知見や公的な安全性評価をもとに評価しました。AIが作成したもので、誤りを含む可能性があります。気になる成分は、医師・薬剤師にご相談ください。
          </p>
          <ul role="list" className="mt-2 space-y-2">
            {aiIngredients.map((ing, i) => (
              <li key={i} className="pt-2 border-t border-sand-200">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold">{ing.rawName}</span>
                  <span className={riskBadge(ing.riskLevel)}>{riskLabelFor(ing)}</span>
                </div>
                <p className="mt-0.5 leading-relaxed">{ing.reasonJa}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Full Ingredients Cloud（成分が分からない製品は出さない。理由は上のまとめにある） */}
      {ingredients.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between gap-2 mb-2">
            {/* 件数の途中で折り返さない（「(8成」「分)」にしない） */}
            <h3 className="text-[15px] font-semibold">
              全成分リスト <span className="whitespace-nowrap">({ingredients.length}成分)</span>
            </h3>
            <span className="text-xs text-ink-muted">タップで成分解説を表示</span>
          </div>
          {/* 段階は色だけでなく、ボタンの1文字でも示す（この一覧にある段階の凡例） */}
          {legend.length > 0 && (
            <p className="mb-2 text-xs text-ink-muted" aria-hidden>
              {legend.join('　')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {ingredients.map((ing, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => selectIngredient(ing)}
                data-ingredient={ing.rawName}
                aria-pressed={selectedIngredient?.rawName === ing.rawName}
                // 選んでいる成分は、色だけでなく枠でも分かるように
                className={`min-h-12 min-w-12 text-[13px] px-3 rounded-lg border transition-colors aria-pressed:ring-2 aria-pressed:ring-primary aria-pressed:ring-offset-1 ${getPillStyle(ing)}`}
              >
                {ing.isActive && <span className="mr-1 text-xs font-semibold text-sage-700">有効成分</span>}
                {pillMark(ing) && (
                  <span className="mr-1 text-xs font-semibold" aria-hidden>
                    {pillMark(ing)}
                  </span>
                )}
                {ing.rawName}
                {ing.aiEvaluated && (
                  <span className="ml-1 text-xs font-semibold text-ink-muted" aria-hidden>
                    AI
                  </span>
                )}
                {ing.riskLevel !== 'safe' && <span className="sr-only">（{riskLabelFor(ing)}）</span>}
                {outsideStandard(ing) && <span className="sr-only">（日本の化粧品基準で配合できない成分）</span>}
                {ing.aiEvaluated && <span className="sr-only">（AIによる評価）</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Ingredient Detail Modal / Popup */}
      {selectedIngredient && (
        <IngredientDetailPanel
          selectedIngredient={selectedIngredient}
          explainingName={explainingName}
          explainError={explainError}
          onClose={closeIngredient}
          onExplainWithAI={handleExplainWithAI}
          detailRef={detailRef}
          detailTitleRef={detailTitleRef}
        />
      )}

      {/* Amazon Safe Alternatives (if warning/caution) */}
      {safeAlternatives && safeAlternatives.length > 0 && (
        <AmazonAlternativeCard products={safeAlternatives} onPriceLookup={onPriceLookup} busy={busy} />
      )}
      {/* 保存済みの製品だけでは3件に満たないとき、お店で同じ種類の商品を探す（種類が分かるときだけ） */}
      {onFindAlternatives && safeAlternatives !== undefined && shownAlternatives.length < 3 && productCategory(product) && (
        <button
          type="button"
          onClick={onFindAlternatives}
          aria-disabled={busy || undefined}
          className={`w-full ${buttonSecondary} ${busyLook}`}
        >
          <Search className="w-4 h-4" aria-hidden />
          <span>同じ種類で原因候補の成分を含まない商品を探す</span>
          {/* 探した商品には販売ページ（アフィリエイト）のリンクが付く */}
          <span className={badgeClass('neutral')}>PR</span>
        </button>
      )}

      <MedicalNotice subject="この成分チェック" />

      {/* Routine Quick Actions */}
      <div className="pt-3 border-t border-sand-200 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {onAddToBadRoutine && (
          <button type="button" onClick={onAddToBadRoutine} className={`${routineActionWide} ${routineAction.bad}`}>
            <AlertTriangle className="w-4 h-4" aria-hidden />
            <span>「肌荒れしたコスメ」に登録</span>
          </button>
        )}
        {onAddToUsableRoutine && (
          <button type="button" onClick={onAddToUsableRoutine} className={`${routineActionWide} ${routineAction.safe}`}>
            <ShieldCheck className="w-4 h-4" aria-hidden />
            <span>「使えるコスメ」に登録</span>
          </button>
        )}
      </div>
    </div>
  );
};
