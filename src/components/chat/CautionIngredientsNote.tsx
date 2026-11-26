'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { panel } from '../ui/design';

/** 名前を並べる数の上限（多い商品は「ほか n つ」。カードの高さをそろえすぎないため） */
const MAX_NAMES = 3;

/**
 * 代わりの商品のうち、香料・精油・アルコールの強い刺激成分を含む商品の注意（Product.cautionIngredients。
 * 避けると言われていない種類なので外さず、ここで知らせる）。色だけでなく、印と文で示す
 */
export const CautionIngredientsNote: React.FC<{ names?: string[]; className?: string }> = ({ names, className = '' }) => {
  if (!names || names.length === 0) return null;
  const shown = names.slice(0, MAX_NAMES);
  const more = names.length - shown.length;
  return (
    <p className={`${panel('caution', 'small')} flex items-start gap-1.5 ${className}`}>
      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden />
      <span>
        <span className="font-semibold">注意：</span>
        {shown.join('、')}
        {more > 0 && ` ほか${more}つ`}
        を含みます。香料・精油・アルコールは、敏感肌には刺激になることがあります。
      </span>
    </p>
  );
};
