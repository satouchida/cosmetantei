'use client';

import React from 'react';
import { CurrentUseCheckResult } from '@/lib/types';
import { CalendarClock, CheckCircle2, Layers } from 'lucide-react';
import { STALE_AFTER_MONTHS } from '@/lib/current-use';
import { PairFindingList } from './PairFindingList';

interface CurrentUseResultCardProps {
  result: CurrentUseCheckResult;
}

/** 今使っているコスメの組み合わせチェックの結果 */
export const CurrentUseResultCard: React.FC<CurrentUseResultCardProps> = ({ result }) => {
  const { productNames, findings, staleProductNames } = result;

  return (
    <div className="my-3 bg-white rounded-2xl p-4 sm:p-5 border-2 border-sky-200/80 shadow-md space-y-4">
      <div className="flex items-center gap-2 pb-3 border-b border-sky-100">
        <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center">
          <Layers className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-sm sm:text-base font-bold text-gray-900">今使っているコスメの組み合わせ</h3>
          <p className="text-xs text-gray-500">{productNames.join('、')}</p>
        </div>
      </div>

      {staleProductNames && staleProductNames.length > 0 && (
        <div className="p-3 bg-orange-50 rounded-xl border border-orange-200 text-xs text-orange-900 flex gap-2">
          <CalendarClock className="w-4 h-4 shrink-0 text-orange-600" />
          <p>
            調べた時点で、{STALE_AFTER_MONTHS}か月以上前に追加したコスメがありました（{staleProductNames.join('、')}）。今も使っているか確かめてください。使っていないものはリストから外すと、結果が正確になります。
          </p>
        </div>
      )}

      {findings.length > 0 ? (
        <PairFindingList findings={findings} heading="一緒に使うときの注意" />
      ) : (
        <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-200 text-xs text-emerald-900 flex gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <p>
            このアプリが調べている組み合わせ（レチノール類とサリチル酸などの重ね使い、角質に働く成分の重なり、香料の重なり）は見つかりませんでした。ほかの組み合わせが安全という意味ではありません。
          </p>
        </div>
      )}
    </div>
  );
};
