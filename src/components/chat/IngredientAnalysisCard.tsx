'use client';

import React, { useState } from 'react';
import { ProductAnalysisResult, AnalyzedIngredient } from '@/lib/types';
import { ShieldCheck, Layers, AlertTriangle, AlertCircle, Info, Sparkles, HelpCircle, X, Globe, Loader2 } from 'lucide-react';
import { AmazonAlternativeCard } from './AmazonAlternativeCard';
import { ProductSourceLink } from './ProductSourceLink';
import {
  badge as badgeClass,
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
  onAddToSafeRoutine?: () => void;
  onAddToCurrentRoutine?: () => void;
}

export const IngredientAnalysisCard: React.FC<IngredientAnalysisCardProps> = ({
  analysis,
  onAddToBadRoutine,
  onAddToSafeRoutine,
  onAddToCurrentRoutine,
}) => {
  const [selectedIngredient, setSelectedIngredient] = useState<AnalyzedIngredient | null>(null);
  const [isExplainingWithAI, setIsExplainingWithAI] = useState<boolean>(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  const selectIngredient = (ing: AnalyzedIngredient | null) => {
    setSelectedIngredient(ing);
    setExplainError(null);
  };

  const handleExplainWithAI = async (ingredientName: string) => {
    if (!ingredientName || isExplainingWithAI) return;
    setIsExplainingWithAI(true);
    setExplainError(null);
    try {
      const res = await fetch('/api/ingredients/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientName }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ingredient) {
          // 調べている間に別の成分を選んでいたら、その成分には書き込まない
          setSelectedIngredient((current) =>
            current && current.rawName === ingredientName
              ? {
                  ...current,
                  matchedKnown: data.ingredient,
                  riskLevel: data.ingredient.riskLevel,
                  category: data.ingredient.category,
                  reasonJa: data.ingredient.reasonJa,
                }
              : current
          );
        }
      } else {
        const data = await res.json().catch(() => null);
        setExplainError(data?.error || 'AI解説を取得できませんでした。しばらくしてからお試しください。');
      }
    } catch (err) {
      console.error('Failed to explain ingredient with AI:', err);
      setExplainError('AI解説を取得できませんでした。通信環境をご確認ください。');
    } finally {
      setIsExplainingWithAI(false);
    }
  };
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
  } = analysis;

  const getOverallBadge = (): { title: string; tone: Tone; icon: typeof ShieldCheck } => {
    switch (overallRiskLevel) {
      case 'safe':
        return { title: '低刺激・安心設計', tone: 'safe', icon: ShieldCheck };
      case 'caution':
        return { title: '敏感肌はやや注意', tone: 'caution', icon: AlertTriangle };
      case 'warning':
        return { title: '刺激・アレルゲン成分あり', tone: 'warning', icon: AlertCircle };
      case 'insufficient_data':
        return { title: '成分データ不足で判定できません', tone: 'neutral', icon: HelpCircle };
    }
  };

  const badge = getOverallBadge();
  const IconComponent = badge.icon;

  const getPillStyle = (ing: AnalyzedIngredient) => {
    // 鎮静・バリアを助ける成分は安全の緑で目立たせる
    if (ing.riskLevel === 'safe' && (ing.category === 'soothing' || ing.category === 'barrier_support')) {
      return 'bg-tint-safe text-emerald-900 border-emerald-300 hover:bg-emerald-100 font-semibold';
    }
    return riskOf(ing.riskLevel).pill;
  };

  return (
    <div className={`my-3 p-4 sm:p-5 space-y-4 text-ink ${card}`}>
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
            <span className="font-semibold block">🌐 オンラインマーケットプレイス収集情報に関するご注意</span>
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
          <ul className="space-y-1.5">
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
            <span>鎮静・バリア修復サポート成分</span>
          </h3>
          <ul className="space-y-1.5">
            {soothingHighlightsJa.map((h, i) => (
              <li key={i} className={panel('safe')}>
                {h}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Full Ingredients Cloud */}
      <section>
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <h3 className="text-[15px] font-semibold">全成分リスト ({ingredients.length}成分)</h3>
          <span className="text-xs text-ink-muted">タップで成分解説を表示</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {ingredients.map((ing, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => selectIngredient(ing)}
              aria-pressed={selectedIngredient?.rawName === ing.rawName}
              className={`min-h-12 min-w-12 text-[13px] px-3 rounded-lg border transition-colors ${getPillStyle(ing)}`}
            >
              {ing.isActive && <span className="mr-1 text-xs font-semibold text-sage-700">有効成分</span>}
              {ing.rawName}
              {ing.riskLevel !== 'safe' && <span className="sr-only">（{riskOf(ing.riskLevel).label}）</span>}
            </button>
          ))}
        </div>
      </section>

      {/* Ingredient Detail Modal / Popup */}
      {selectedIngredient && (
        <div
          role="region"
          aria-label="成分の解説"
          className="p-4 bg-surface-container-low rounded-xl border border-sand-200 relative animate-fade-in text-sm space-y-2"
        >
          <button
            type="button"
            onClick={() => selectIngredient(null)}
            aria-label="成分の解説を閉じる"
            className="absolute top-0 right-0 w-12 h-12 flex items-center justify-center rounded-full text-ink-muted hover:text-ink hover:bg-surface-container"
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
          <div className="flex items-center gap-2 flex-wrap pr-10">
            <span className="font-semibold text-ink text-base">
              {selectedIngredient.matchedKnown?.nameJa || selectedIngredient.rawName}
            </span>
            <span className="text-xs text-ink-muted">
              ({selectedIngredient.matchedKnown?.nameEn || selectedIngredient.rawName})
            </span>
            {selectedIngredient.isActive && <span className={badgeClass('neutral')}>医薬部外品の有効成分</span>}
            <span className={riskBadge(selectedIngredient.riskLevel)}>{riskOf(selectedIngredient.riskLevel).label}</span>
          </div>
          <p className="leading-relaxed">
            {selectedIngredient.matchedKnown?.reasonJa ||
              selectedIngredient.reasonJa ||
              'この成分の解説データはまだありません。'}
          </p>
          <p className="text-sage-800 font-medium leading-relaxed">
            💡 アドバイス: {selectedIngredient.matchedKnown?.sensitiveSkinAdviceJa ||
              '刺激性を評価できていないため、気になる場合は「AIでさらに詳しく調べる」で確認するか、パッチテストを行ってから使用してください。'}
          </p>
          {selectedIngredient.wheatDerived && (
            <p className={panel('caution', 'small')}>
              🌾 小麦由来の成分です。小麦アレルギーがある方は注意し、使用中にかゆみやはれが出たら使用をやめて医師に相談してください。
            </p>
          )}
          {selectedIngredient.jpStandard && (
            <p
              className={`text-xs leading-relaxed ${
                selectedIngredient.jpStandard.notAllowedHere ? 'text-rose-800 font-semibold' : 'text-ink-muted'
              }`}
            >
              📋 {selectedIngredient.jpStandard.textJa}{' '}
              <a
                href={selectedIngredient.jpStandard.referenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={textLink}
              >
                告示を見る<span className="sr-only">（新しいタブで開く）</span>
              </a>
            </p>
          )}
          {selectedIngredient.jpDesignated && (
            <p className="text-xs leading-relaxed text-ink-muted">
              🏷️ {selectedIngredient.jpDesignated.textJa}
              {selectedIngredient.jpDesignated.references.map((ref, i) => (
                <React.Fragment key={ref.url}>
                  {' '}
                  <a href={ref.url} target="_blank" rel="noopener noreferrer" title={ref.title} className={textLink}>
                    {i === 0 ? '成分の一覧' : '通知'}
                    <span className="sr-only">（{ref.title}。新しいタブで開く）</span>
                  </a>
                </React.Fragment>
              ))}
            </p>
          )}
          {selectedIngredient.matchedKnown?.id.startsWith('ai_') && (
            <p className="text-xs text-ink-muted">この解説はAIが作成した参考情報です。</p>
          )}
          <div className="pt-2 border-t border-sand-200">
            <button
              type="button"
              disabled={isExplainingWithAI}
              onClick={() => handleExplainWithAI(selectedIngredient.rawName)}
              className={buttonSecondary}
            >
              {isExplainingWithAI ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                  <span>AIで解析中...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" aria-hidden />
                  <span>AIでさらに詳しく調べる</span>
                </>
              )}
            </button>
          </div>
          {explainError && (
            <p role="alert" className="text-xs text-rose-800">
              {explainError}
            </p>
          )}
        </div>
      )}

      {/* Amazon Safe Alternatives (if warning/caution) */}
      {safeAlternatives && safeAlternatives.length > 0 && (
        <AmazonAlternativeCard products={safeAlternatives} />
      )}

      {/* Routine Quick Actions */}
      <div className="pt-3 border-t border-sand-200 grid grid-cols-1 sm:grid-cols-3 gap-2">
        {onAddToBadRoutine && (
          <button type="button" onClick={onAddToBadRoutine} className={`${routineActionWide} ${routineAction.bad}`}>
            <AlertTriangle className="w-4 h-4" aria-hidden />
            <span>「肌荒れしたコスメ」に登録</span>
          </button>
        )}
        {onAddToSafeRoutine && (
          <button type="button" onClick={onAddToSafeRoutine} className={`${routineActionWide} ${routineAction.safe}`}>
            <ShieldCheck className="w-4 h-4" aria-hidden />
            <span>「安全なコスメ」に登録</span>
          </button>
        )}
        {onAddToCurrentRoutine && (
          <button
            type="button"
            onClick={onAddToCurrentRoutine}
            className={`${routineActionWide} ${routineAction.current}`}
          >
            <Layers className="w-4 h-4" aria-hidden />
            <span>「今使っている」に登録</span>
          </button>
        )}
      </div>
    </div>
  );
};
