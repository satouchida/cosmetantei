'use client';

import React from 'react';
import { AnalyzedIngredient } from '@/lib/types';
import { isIrritantLevel, legendEntries, outsideStandard, pillMark, riskLabelFor } from './ingredient-marks';
import { riskOf } from '../ui/design';

interface FullIngredientListProps {
  /** 全成分（1つ以上） */
  ingredients: AnalyzedIngredient[];
  /** 解説を開いている成分 */
  selectedIngredient: AnalyzedIngredient | null;
  /** 成分をタップしたとき（解説を開く。useIngredientExplanation.ts） */
  selectIngredient: (ing: AnalyzedIngredient) => void;
}

/** Full Ingredients Cloud：全成分のボタン（段階の色と1文字の印）と、その凡例 */
export const FullIngredientList: React.FC<FullIngredientListProps> = ({ ingredients, selectedIngredient, selectIngredient }) => {
  const legend = legendEntries(ingredients);

  const getPillStyle = (ing: AnalyzedIngredient) => {
    // 化粧品基準で配合できない成分は、見出しの理由なので白地に赤の枠（「高」の赤い塗り・未評価の点線と分ける）
    // 刺激の段階（高・刺・活）の成分は、その段階の色のまま（印に「基準」を足す）
    if (outsideStandard(ing) && !isIrritantLevel(ing)) return 'bg-white text-rose-900 border-rose-400 hover:bg-rose-50 active:bg-rose-100 font-semibold';
    // 表示指定成分で引き上げただけの成分（「表」）は白地に黄の枠（黄の塗りの「注」と分ける。緑とも並べない）
    if (ing.raisedForLabel) return 'bg-white text-amber-900 border-amber-400 hover:bg-amber-50 active:bg-amber-100';
    // 肌を整える・うるおいを保つ成分は安全の緑で目立たせる
    if (ing.riskLevel === 'safe' && (ing.category === 'soothing' || ing.category === 'barrier_support')) {
      return 'bg-tint-safe text-emerald-900 border-emerald-300 hover:bg-emerald-100 active:bg-emerald-200 font-semibold';
    }
    return riskOf(ing.riskLevel).pill;
  };

  return (
    <section>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        {/* 件数の途中で折り返さない（「(8成」「分)」にしない） */}
        <h3 className="text-[0.9375rem] font-semibold">
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
            className={`min-h-12 min-w-12 text-[0.8125rem] px-3 rounded-lg border transition-colors aria-pressed:ring-2 aria-pressed:ring-primary aria-pressed:ring-offset-1 ${getPillStyle(ing)}`}
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
  );
};
