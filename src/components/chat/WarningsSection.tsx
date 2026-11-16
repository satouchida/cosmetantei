'use client';

import React from 'react';
import { AlertCircle } from 'lucide-react';
import { panel } from '../ui/design';

interface WarningsSectionProps {
  /** 敏感肌への注意・刺激成分の説明（1つ以上） */
  warningsJa: string[];
}

/** 敏感肌への注意・刺激成分（赤の枠） */
export const WarningsSection: React.FC<WarningsSectionProps> = ({ warningsJa }) => (
  <section className="space-y-2">
    <h3 className="flex items-center gap-1.5 text-[0.9375rem] font-semibold text-rose-800">
      <AlertCircle className="w-4 h-4" aria-hidden />
      <span>敏感肌への注意・刺激成分</span>
    </h3>
    <ul role="list" className="space-y-1.5">
      {warningsJa.map((w, i) => (
        <li key={i} className={panel('warning')}>
          {w}
        </li>
      ))}
    </ul>
  </section>
);
