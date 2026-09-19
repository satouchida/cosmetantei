'use client';

import React, { useState } from 'react';
import { ProductAnalysisResult, AnalyzedIngredient } from '@/lib/types';
import { ShieldCheck, AlertTriangle, AlertCircle, Info, Sparkles, HelpCircle, Check, X, Globe } from 'lucide-react';
import { AmazonAlternativeCard } from './AmazonAlternativeCard';

interface IngredientAnalysisCardProps {
  analysis: ProductAnalysisResult;
  onAddToBadRoutine?: () => void;
  onAddToSafeRoutine?: () => void;
}

export const IngredientAnalysisCard: React.FC<IngredientAnalysisCardProps> = ({
  analysis,
  onAddToBadRoutine,
  onAddToSafeRoutine,
}) => {
  const [selectedIngredient, setSelectedIngredient] = useState<AnalyzedIngredient | null>(null);
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
  } = analysis;

  const getOverallBadge = () => {
    switch (overallRiskLevel) {
      case 'safe':
        return {
          title: '低刺激・安心設計',
          bg: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          icon: ShieldCheck,
          iconColor: 'text-emerald-600',
        };
      case 'caution':
        return {
          title: '敏感肌はやや注意',
          bg: 'bg-amber-50 text-amber-800 border-amber-200',
          icon: AlertTriangle,
          iconColor: 'text-amber-600',
        };
      case 'warning':
        return {
          title: '刺激・アレルゲン成分あり',
          bg: 'bg-rose-50 text-rose-800 border-rose-200',
          icon: AlertCircle,
          iconColor: 'text-rose-600',
        };
    }
  };

  const badge = getOverallBadge();
  const IconComponent = badge.icon;

  const getPillStyle = (ing: AnalyzedIngredient) => {
    switch (ing.riskLevel) {
      case 'high_irritant':
        return 'bg-rose-100/90 text-rose-800 border-rose-300 hover:bg-rose-200';
      case 'moderate_irritant':
        return 'bg-orange-100/90 text-orange-800 border-orange-300 hover:bg-orange-200';
      case 'active_caution':
        return 'bg-purple-100/90 text-purple-800 border-purple-300 hover:bg-purple-200';
      case 'low_caution':
        return 'bg-amber-100/90 text-amber-800 border-amber-300 hover:bg-amber-200';
      case 'safe':
        if (ing.category === 'soothing' || ing.category === 'barrier_support') {
          return 'bg-emerald-100/90 text-emerald-800 border-emerald-300 hover:bg-emerald-200 font-semibold';
        }
        return 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200';
    }
  };

  return (
    <div className="my-3 bg-white rounded-2xl p-4 sm:p-5 border border-sand-200 shadow-sm space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-sand-100">
        <div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-sage-700">{product.brand}</span>
            {isEstimatedFromMarketplaces && (
              <span className="text-[10px] bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.2 rounded-md font-medium flex items-center gap-0.5">
                <Globe className="w-2.5 h-2.5" />
                <span>Web探索成分データ</span>
              </span>
            )}
          </div>
          <h3 className="text-base font-bold text-gray-900 leading-snug mt-0.5">{product.name}</h3>
        </div>
        <div
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-bold self-start sm:self-auto ${badge.bg}`}
        >
          <IconComponent className={`w-4 h-4 ${badge.iconColor}`} />
          <span>{badge.title}</span>
        </div>
      </div>

      {/* Summary Box */}
      <div className="text-xs sm:text-sm text-gray-700 leading-relaxed bg-sand-50 p-3.5 rounded-xl border border-sand-200/70">
        {summaryJa}
      </div>

      {/* Online Marketplace Disclaimer Banner (if ingredients were retrieved from web/marketplace) */}
      {dataSourceDisclaimer && (
        <div className="p-3 bg-amber-50/90 rounded-xl border border-amber-200/80 text-[11px] text-amber-900 leading-relaxed flex items-start gap-2 animate-fade-in">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-700" />
          <div className="space-y-0.5">
            <span className="font-bold text-amber-950 block">
              🌐 オンラインマーケットプレイス収集情報に関するご注意
            </span>
            <p className="text-amber-900/90">{dataSourceDisclaimer}</p>
          </div>
        </div>
      )}

      {/* Warnings & Highlights */}
      {warningsJa.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-rose-700">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>敏感肌への注意・刺激成分:</span>
          </div>
          <div className="space-y-1">
            {warningsJa.map((w, i) => (
              <div
                key={i}
                className="text-xs text-rose-900 bg-rose-50/70 p-2 rounded-lg border border-rose-100 leading-relaxed"
              >
                {w}
              </div>
            ))}
          </div>
        </div>
      )}

      {soothingHighlightsJa.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700">
            <Sparkles className="w-3.5 h-3.5" />
            <span>鎮静・バリア修復サポート成分:</span>
          </div>
          <div className="space-y-1">
            {soothingHighlightsJa.map((h, i) => (
              <div
                key={i}
                className="text-xs text-emerald-900 bg-emerald-50/70 p-2 rounded-lg border border-emerald-100 leading-relaxed"
              >
                {h}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Full Ingredients Cloud */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-gray-700">
            全成分リスト ({ingredients.length}成分)
          </span>
          <span className="text-[11px] text-gray-400">タップで成分解説を表示</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ingredients.map((ing, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setSelectedIngredient(ing)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-all cursor-pointer ${getPillStyle(
                ing
              )}`}
            >
              {ing.rawName}
            </button>
          ))}
        </div>
      </div>

      {/* Ingredient Detail Modal / Popup */}
      {selectedIngredient && selectedIngredient.matchedKnown && (
        <div className="p-3.5 bg-sand-100/90 rounded-xl border border-sand-300 relative animate-fade-in text-xs space-y-1.5">
          <button
            onClick={() => setSelectedIngredient(null)}
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 p-1"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
            <span>{selectedIngredient.matchedKnown.nameJa}</span>
            <span className="text-[11px] text-gray-500 font-normal">
              ({selectedIngredient.matchedKnown.nameEn})
            </span>
          </div>
          <p className="text-gray-700 leading-relaxed">
            {selectedIngredient.matchedKnown.reasonJa}
          </p>
          <p className="text-sage-800 font-medium pt-1">
            💡 アドバイス: {selectedIngredient.matchedKnown.sensitiveSkinAdviceJa}
          </p>
        </div>
      )}

      {/* Amazon Safe Alternatives (if warning/caution) */}
      {safeAlternatives && safeAlternatives.length > 0 && (
        <AmazonAlternativeCard products={safeAlternatives} />
      )}

      {/* Routine Quick Actions */}
      <div className="pt-2 border-t border-sand-100 flex flex-wrap gap-2">
        {onAddToBadRoutine && (
          <button
            type="button"
            onClick={onAddToBadRoutine}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold transition-colors"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
            <span>「肌荒れしたコスメ」に登録</span>
          </button>
        )}
        {onAddToSafeRoutine && (
          <button
            type="button"
            onClick={onAddToSafeRoutine}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-semibold transition-colors"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>「安全なコスメ」に登録</span>
          </button>
        )}
      </div>
    </div>
  );
};
