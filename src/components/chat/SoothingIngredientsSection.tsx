'use client';

import React from 'react';
import { Sparkles } from 'lucide-react';
import { panel } from '../ui/design';

interface SoothingIngredientsSectionProps {
  /** 肌を整える・うるおいを保つ成分の説明（1つ以上） */
  soothingHighlightsJa: string[];
}

/** 肌を整える・うるおいを保つ成分のうち、開かずに見える数 */
const SOOTHING_SHOWN = 2;

/** 肌を整える・うるおいを保つ成分（緑の枠） */
export const SoothingIngredientsSection: React.FC<SoothingIngredientsSectionProps> = ({ soothingHighlightsJa }) => (
  <section className="space-y-2">
    <h3 className="flex items-center gap-1.5 text-[0.9375rem] font-semibold text-emerald-800">
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
);
