'use client';

import React from 'react';
import { DifferentialAnalysisResult } from '@/lib/types';
import { AlertCircle, CheckCircle2, Flame, ShieldAlert, Sparkles } from 'lucide-react';
import { AmazonAlternativeCard } from './AmazonAlternativeCard';

interface DifferentialResultCardProps {
  result: DifferentialAnalysisResult;
}

export const DifferentialResultCard: React.FC<DifferentialResultCardProps> = ({ result }) => {
  const { badProducts, safeProducts, culprits, summaryJa, adviceJa, safeAlternatives } = result;

  return (
    <div className="my-3 bg-white rounded-2xl p-4 sm:p-5 border-2 border-rose-200/80 shadow-md space-y-4">
      {/* Header Badge */}
      <div className="flex items-center gap-2 pb-3 border-b border-rose-100">
        <div className="w-8 h-8 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center">
          <Flame className="w-4 h-4 text-rose-600" />
        </div>
        <div>
          <h3 className="text-sm sm:text-base font-bold text-gray-900">
            肌荒れ成分の差分あぶり出し結果
          </h3>
          <p className="text-xs text-gray-500">
            安全なコスメに含まれる成分を除外し、原因成分を特定
          </p>
        </div>
      </div>

      {/* Comparison Overview Chips */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div className="bg-rose-50/70 p-2.5 rounded-xl border border-rose-200">
          <div className="font-bold text-rose-800 flex items-center gap-1 mb-1">
            <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
            <span>肌荒れしたコスメ ({badProducts.length}品):</span>
          </div>
          <ul className="list-disc list-inside text-gray-700 space-y-0.5">
            {badProducts.map((p) => (
              <li key={p.id} className="truncate">
                {p.brand} {p.name}
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-emerald-50/70 p-2.5 rounded-xl border border-emerald-200">
          <div className="font-bold text-emerald-800 flex items-center gap-1 mb-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>安全に使えているコスメ ({safeProducts.length}品):</span>
          </div>
          {safeProducts.length > 0 ? (
            <ul className="list-disc list-inside text-gray-700 space-y-0.5">
              {safeProducts.map((p) => (
                <li key={p.id} className="truncate">
                  {p.brand} {p.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500 italic">安全なコスメが未登録（登録するとより精度向上）</p>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="bg-sand-50 p-3.5 rounded-xl border border-sand-200 text-xs sm:text-sm text-gray-800 leading-relaxed font-medium">
        {summaryJa}
      </div>

      {/* Culprit Ingredients Ranking */}
      <div>
        <h4 className="text-xs font-bold text-gray-800 mb-2 flex items-center gap-1.5">
          <ShieldAlert className="w-4 h-4 text-rose-600" />
          <span>あぶり出された疑わしい成分一覧:</span>
        </h4>

        {culprits.length === 0 ? (
          <div className="text-xs text-gray-500 p-3 bg-gray-50 rounded-lg">
            明確な特有刺激成分は検出されませんでした。
          </div>
        ) : (
          <div className="space-y-2">
            {culprits.map((c, i) => {
              const isHigh = c.riskLevel === 'high_irritant';
              const isMod = c.riskLevel === 'moderate_irritant';
              const isActive = c.riskLevel === 'active_caution';

              const badgeColor = isHigh
                ? 'bg-rose-100 text-rose-800 border-rose-300'
                : isMod
                ? 'bg-orange-100 text-orange-800 border-orange-300'
                : isActive
                ? 'bg-purple-100 text-purple-800 border-purple-300'
                : 'bg-amber-100 text-amber-800 border-amber-300';

              const riskLabel = isHigh
                ? '高刺激・アレルゲン'
                : isMod
                ? '乾燥・刺激リスク'
                : isActive
                ? '高濃度アクティブ'
                : '注意成分';

              return (
                <div
                  key={i}
                  className="p-3 bg-white rounded-xl border border-sand-200 shadow-2xs space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-sand-200 text-gray-700 font-bold text-[11px] flex items-center justify-center">
                        {i + 1}
                      </span>
                      <span className="font-bold text-sm text-gray-900">{c.nameJa}</span>
                      {c.nameEn && c.nameEn !== c.nameJa && (
                        <span className="text-[11px] text-gray-500">({c.nameEn})</span>
                      )}
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeColor}`}>
                      {riskLabel}
                    </span>
                  </div>

                  <p className="text-xs text-gray-600 leading-relaxed">{c.reasonJa}</p>

                  <div className="text-[11px] text-gray-500 bg-sand-50 px-2 py-1 rounded-md">
                    <span className="font-semibold text-gray-700">含まれる肌荒れ製品:</span>{' '}
                    {c.foundInProducts.join(', ')}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Amazon Safe Alternative Recommendations */}
      {safeAlternatives && safeAlternatives.length > 0 && (
        <AmazonAlternativeCard
          products={safeAlternatives}
          avoidedIngredients={culprits.map((c) => c.nameJa)}
        />
      )}

      {/* Dermatological Advice */}
      {adviceJa.length > 0 && (
        <div className="p-3.5 bg-sage-50/80 rounded-xl border border-sage-200 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-sage-900">
            <Sparkles className="w-4 h-4 text-sage-700" />
            <span>スキンケア改善アドバイス:</span>
          </div>
          <ul className="text-xs text-sage-800 space-y-1 list-disc list-inside leading-relaxed">
            {adviceJa.map((adv, idx) => (
              <li key={idx}>{adv}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
