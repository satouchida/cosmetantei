'use client';

import React from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { AnalyzedIngredient } from '@/lib/types';
import { riskLabelFor } from './ingredient-marks';
import { panel, riskBadge } from '../ui/design';

interface AIRatedIngredientsProps {
  /** AI が評価した成分（1つ以上） */
  aiIngredients: AnalyzedIngredient[];
}

/** AIが評価した成分（開くと評価と理由。AI が作成したことを書く） */
export const AIRatedIngredients: React.FC<AIRatedIngredientsProps> = ({ aiIngredients }) => (
  <details className={`group ${panel('neutral')}`}>
    {/* flex の summary は Chrome・Firefox で三角が消えるので、開閉の印を自前で出す（Safari の印は二重になるので消す） */}
    <summary className="min-h-12 -my-3 flex items-center gap-1.5 cursor-pointer font-semibold [&::-webkit-details-marker]:hidden">
      <Sparkles className="w-4 h-4 shrink-0" aria-hidden />
      <span>AIが評価した成分（{aiIngredients.length}成分）</span>
      <ChevronDown
        className="w-4 h-4 shrink-0 ml-auto transition-transform motion-reduce:transition-none group-open:rotate-180"
        aria-hidden
      />
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
);
