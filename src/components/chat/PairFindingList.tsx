'use client';

import React, { useId } from 'react';
import { PairFinding } from '@/lib/types';

interface PairFindingListProps {
  findings: PairFinding[];
  heading: string;
}

/** 製品をまたぐ組み合わせの注意（差分分析と、今使っているコスメの組み合わせチェック） */
export const PairFindingList: React.FC<PairFindingListProps> = ({ findings, heading }) => {
  // チャットに同じカードが何枚あっても見出しの ID が重ならないように
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="p-3.5 bg-amber-50/80 rounded-xl border border-amber-200 space-y-2.5">
      <h3 id={headingId} className="text-xs font-bold text-amber-900">{heading}</h3>
      {findings.map((f) => (
        <div key={f.id} className="space-y-1">
          <h4 className="text-xs font-semibold text-amber-900">{f.titleJa}</h4>
          <p className="text-xs text-amber-900/90 leading-relaxed">{f.textJa}</p>
          <p className="text-[11px] text-gray-700 break-words">
            製品: {f.products.join('、')} ／ 成分: {f.ingredients.slice(0, 8).join('、')}
            {f.ingredients.length > 8 && ` ほか${f.ingredients.length - 8}件`}
          </p>
          <ul className="text-[11px] text-gray-600 space-y-0.5">
            {f.sources.map((src) => (
              <li key={src.url}>
                出典:{' '}
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 text-sage-700 hover:text-sage-900 break-all"
                >
                  {src.title}
                  <span className="sr-only">（新しいタブで開く）</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
};
