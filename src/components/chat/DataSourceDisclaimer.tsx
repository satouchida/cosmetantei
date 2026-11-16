'use client';

import React from 'react';
import { Info } from 'lucide-react';
import { panel } from '../ui/design';

interface DataSourceDisclaimerProps {
  /** 成分をオンラインマーケットプレイスから集めたときの注意の文 */
  dataSourceDisclaimer: string;
}

/** Online Marketplace Disclaimer Banner（成分を Web・マーケットプレイスから集めたとき） */
export const DataSourceDisclaimer: React.FC<DataSourceDisclaimerProps> = ({ dataSourceDisclaimer }) => (
  <div className={`flex items-start gap-2 animate-fade-in ${panel('caution', 'small')}`}>
    <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" aria-hidden />
    <div className="space-y-0.5">
      <span className="font-semibold block">
        <span aria-hidden>🌐 </span>オンラインマーケットプレイス収集情報に関するご注意
      </span>
      <p>{dataSourceDisclaimer}</p>
    </div>
  </div>
);
