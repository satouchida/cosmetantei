'use client';

import React, { useId } from 'react';
import { PairFinding } from '@/lib/types';
import { panel, textLink } from '../ui/design';

interface PairFindingListProps {
  findings: PairFinding[];
  heading: string;
}

/** 製品をまたぐ組み合わせの注意（差分分析と、今使っているコスメの組み合わせチェック） */
export const PairFindingList: React.FC<PairFindingListProps> = ({ findings, heading }) => {
  // チャットに同じカードが何枚あっても見出しの ID が重ならないように
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={`${panel('caution')} space-y-3`}>
      <h3 id={headingId} className="text-[15px] font-semibold text-amber-950">
        {heading}
      </h3>
      {findings.map((f) => (
        <div key={f.id} className="space-y-1">
          <h4 className="font-semibold text-amber-950">{f.titleJa}</h4>
          <p className="leading-relaxed">{f.textJa}</p>
          <p className="text-xs text-ink-muted break-words">
            製品: {f.products.join('、')} ／ 成分: {f.ingredients.slice(0, 8).join('、')}
            {f.ingredients.length > 8 && ` ほか${f.ingredients.length - 8}件`}
          </p>
          <ul className="text-xs text-ink-muted space-y-0.5">
            {f.sources.map((src) => (
              <li key={src.url}>
                出典:{' '}
                <a href={src.url} target="_blank" rel="noopener noreferrer" className={`${textLink} break-all`}>
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
