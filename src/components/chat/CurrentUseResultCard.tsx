'use client';

import React from 'react';
import { CurrentUseCheckResult } from '@/lib/types';
import { CalendarClock, CheckCircle2, Layers } from 'lucide-react';
import { STALE_AFTER_MONTHS } from '@/lib/current-use';
import { PairFindingList } from './PairFindingList';
import { MedicalNotice } from './MedicalNotice';
import { card, panel } from '../ui/design';

interface CurrentUseResultCardProps {
  result: CurrentUseCheckResult;
}

/** 今使っているコスメの組み合わせチェックの結果 */
export const CurrentUseResultCard: React.FC<CurrentUseResultCardProps> = ({ result }) => {
  const { productNames, findings, staleProductNames } = result;

  return (
    <div className={`my-3 p-4 sm:p-5 space-y-4 text-ink ${card}`}>
      <div className="flex items-center gap-2 pb-3 border-b border-sand-200">
        <div className="w-8 h-8 shrink-0 rounded-full bg-sky-50 text-sky-700 flex items-center justify-center">
          <Layers className="w-[18px] h-[18px]" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-snug">今使っているコスメの組み合わせ</h2>
          <p className="text-xs text-ink-muted">{productNames.join('、')}</p>
        </div>
      </div>

      {staleProductNames && staleProductNames.length > 0 && (
        <div className={`${panel('notice')} flex gap-2`}>
          <CalendarClock className="w-4 h-4 shrink-0 mt-0.5 text-orange-700" aria-hidden />
          <p>
            調べた時点で、{STALE_AFTER_MONTHS}か月以上前に追加したコスメがありました（{staleProductNames.join('、')}）。今も使っているか確かめてください。使っていないものはリストから外すと、結果が正確になります。
          </p>
        </div>
      )}

      {findings.length > 0 ? (
        <PairFindingList findings={findings} heading="一緒に使うときの注意" />
      ) : (
        <div className={`${panel('safe')} flex gap-2`}>
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" aria-hidden />
          <p>
            このアプリが調べている組み合わせ（レチノール類とサリチル酸などの重ね使い、角質に働く成分の重なり、香料の重なり）は見つかりませんでした。ほかの組み合わせが安全という意味ではありません。
          </p>
        </div>
      )}

      <MedicalNotice subject="この組み合わせのチェック" />
    </div>
  );
};
