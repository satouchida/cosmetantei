'use client';

import React, { useRef } from 'react';
import { Product, ProductAnalysisResult } from '@/lib/types';
import { Search } from 'lucide-react';
import { AmazonAlternativeCard } from './AmazonAlternativeCard';
import { useUnregisteredProducts } from './RegisteredProducts';
import { MedicalNotice } from './MedicalNotice';
import { IngredientDetailPanel } from './IngredientDetailPanel';
import { useAIAnalysis } from './useAIAnalysis';
import { useIngredientExplanation } from './useIngredientExplanation';
import { AnalysisCardHeader } from './AnalysisCardHeader';
import { AIStatusNotices } from './AIStatusNotices';
import { LabelNotesPanel } from './LabelNotesPanel';
import { DataSourceDisclaimer } from './DataSourceDisclaimer';
import { WarningsSection } from './WarningsSection';
import { SoothingIngredientsSection } from './SoothingIngredientsSection';
import { AIRatedIngredients } from './AIRatedIngredients';
import { FullIngredientList } from './FullIngredientList';
import { AnalysisRoutineActions } from './AnalysisRoutineActions';
import { mildCautionNames } from '@/lib/caution-reason';
import { productCategory } from '@/lib/analyzer/product-category';
import { badge as badgeClass, busyLook, buttonSecondary, card, riskOf } from '../ui/design';

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

  const aiIngredients = ingredients.filter((i) => i.aiEvaluated);

  return (
    <div ref={cardRef} tabIndex={-1} data-analysis-card className={`my-3 p-4 sm:p-5 space-y-4 text-ink focus:outline-none ${card}`}>
      {/* Header */}
      <AnalysisCardHeader
        product={product}
        isEstimatedFromMarketplaces={isEstimatedFromMarketplaces}
        overallRiskLevel={overallRiskLevel}
        outsideJpStandard={outsideJpStandard}
      />

      {/* Summary Box */}
      <p className="text-sm leading-relaxed">{summaryJa}</p>
      {/* 「やや注意」の理由が軽度の注意の成分だけのときは、その名前を出す（注意・刺激成分の枠には出ない）。
          軽い段階なので、色の付いた枠にはしない */}
      {mildNames.length > 0 && (
        <p className="text-sm leading-relaxed">
          {riskOf('low_caution').label}の成分（{mildNames.length}成分）: {mildNames.join('、')}
        </p>
      )}

      {/* AI の評価の進み具合・読み上げの枠・入力した成分表示の案内 */}
      <AIStatusNotices
        analysis={analysis}
        aiStatus={aiStatus}
        aiError={aiError}
        aiRejected={aiRejected}
        aiEvaluation={aiEvaluation}
        retryAIAnalysis={retryAIAnalysis}
        explainStatus={explainStatus}
      />

      {/* 医薬部外品の成分表示の読み方（記載順・名称が表示されていない成分） */}
      {labelNotesJa && labelNotesJa.length > 0 && (
        <LabelNotesPanel labelNotesJa={labelNotesJa} labelReferences={labelReferences} />
      )}

      {/* Online Marketplace Disclaimer Banner (if ingredients were retrieved from web/marketplace) */}
      {dataSourceDisclaimer && <DataSourceDisclaimer dataSourceDisclaimer={dataSourceDisclaimer} />}

      {/* Warnings & Highlights */}
      {warningsJa.length > 0 && <WarningsSection warningsJa={warningsJa} />}

      {soothingHighlightsJa.length > 0 && <SoothingIngredientsSection soothingHighlightsJa={soothingHighlightsJa} />}

      {aiIngredients.length > 0 && <AIRatedIngredients aiIngredients={aiIngredients} />}

      {/* Full Ingredients Cloud（成分が分からない製品は出さない。理由は上のまとめにある） */}
      {ingredients.length > 0 && (
        <FullIngredientList ingredients={ingredients} selectedIngredient={selectedIngredient} selectIngredient={selectIngredient} />
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
      {/* 保存済みの製品だけでは3件に満たないとき、お店で同じ種類の商品を探す（種類が分かるときだけ）。香料・精油・アルコールの
          注意を付けた製品は数えない（注意の無い商品をお店で探せるように） */}
      {onFindAlternatives &&
        safeAlternatives !== undefined &&
        shownAlternatives.filter((p) => !p.cautionIngredients?.length).length < 3 &&
        productCategory(product) && (
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
      <AnalysisRoutineActions onAddToBadRoutine={onAddToBadRoutine} onAddToUsableRoutine={onAddToUsableRoutine} />
    </div>
  );
};
