'use client';

import React from 'react';
import { Info } from 'lucide-react';
import { ProductAnalysisResult } from '@/lib/types';
import { panel, textLink } from '../ui/design';

interface LabelNotesPanelProps {
  /** 成分表示の読み方の注意（1つ以上） */
  labelNotesJa: string[];
  /** 成分表示の読み方の出典 */
  labelReferences: ProductAnalysisResult['labelReferences'];
}

/** 医薬部外品の成分表示の読み方（記載順・名称が表示されていない成分）と、その出典 */
export const LabelNotesPanel: React.FC<LabelNotesPanelProps> = ({ labelNotesJa, labelReferences }) => (
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
);
