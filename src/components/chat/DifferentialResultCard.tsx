'use client';

import React from 'react';
import { DifferentialAnalysisResult } from '@/lib/types';
import { AlertCircle, CheckCircle2, Flame, ShieldAlert, Sparkles } from 'lucide-react';
import { AmazonAlternativeCard } from './AmazonAlternativeCard';
import { PairFindingList } from './PairFindingList';
import { card, panel, RISK_SCALE, riskBadge } from '../ui/design';

interface DifferentialResultCardProps {
  result: DifferentialAnalysisResult;
}

export const DifferentialResultCard: React.FC<DifferentialResultCardProps> = ({ result }) => {
  const { badProducts, safeProducts, culprits, summaryJa, adviceJa, safeAlternatives, pairFindings } = result;

  return (
    <div className={`my-3 p-4 sm:p-5 space-y-4 text-ink ${card}`}>
      {/* Header Badge */}
      <div className="flex items-center gap-2 pb-3 border-b border-sand-200">
        <div className="w-8 h-8 shrink-0 rounded-full bg-tint-warning text-rose-700 flex items-center justify-center">
          <Flame className="w-[18px] h-[18px]" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink leading-snug">差分分析の結果（原因候補の成分）</h2>
          <p className="text-xs text-ink-muted">普段問題なく使えているコスメに含まれる成分を除外し、原因になりうる成分の候補を絞り込みます</p>
        </div>
      </div>

      {/* Comparison Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className={panel('warning')}>
          <h3 className="font-semibold text-rose-800 flex items-center gap-1 mb-1">
            <AlertCircle className="w-4 h-4" aria-hidden />
            <span>肌荒れしたコスメ ({badProducts.length}品)</span>
          </h3>
          <ul className="list-disc pl-5 text-ink space-y-0.5">
            {badProducts.map((p) => (
              <li key={p.id} className="break-keep [overflow-wrap:anywhere]">
                {p.brand} {p.name}
              </li>
            ))}
          </ul>
        </div>

        <div className={panel('safe')}>
          <h3 className="font-semibold text-emerald-800 flex items-center gap-1 mb-1">
            <CheckCircle2 className="w-4 h-4" aria-hidden />
            <span>普段使えているコスメ ({safeProducts.length}品)</span>
          </h3>
          {safeProducts.length > 0 ? (
            <ul className="list-disc pl-5 text-ink space-y-0.5">
              {safeProducts.map((p) => (
                <li key={p.id} className="break-keep [overflow-wrap:anywhere]">
                  {p.brand} {p.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-muted">普段使えているコスメが未登録（登録すると候補を絞り込めます）</p>
          )}
        </div>
      </div>

      {/* Summary */}
      <p className="text-sm leading-relaxed font-medium">{summaryJa}</p>

      {/* Culprit Ingredients Ranking */}
      <section>
        <h3 className="text-[15px] font-semibold mb-2 flex items-center gap-1.5">
          <ShieldAlert className="w-4 h-4 text-rose-700" aria-hidden />
          <span>原因候補の成分</span>
        </h3>

        {culprits.length === 0 ? (
          <p className={panel('neutral')}>明確な特有刺激成分は検出されませんでした。</p>
        ) : (
          <ol role="list" className="space-y-2">
            {culprits.map((c, i) => {
              // 高・中・アクティブはそのままの段階、未評価は「未評価成分」、それ以外は「注意成分」
              const level =
                c.riskLevel === 'high_irritant' || c.riskLevel === 'moderate_irritant' || c.riskLevel === 'active_caution' || c.riskLevel === 'unknown'
                  ? c.riskLevel
                  : 'low_caution';
              const riskLabel = level === 'unknown' ? '未評価成分' : level === 'low_caution' ? '注意成分' : RISK_SCALE[level].label;

              return (
                <li key={i} className="p-3 bg-white rounded-xl border border-sand-200 space-y-1.5">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        aria-hidden
                        className="w-6 h-6 shrink-0 rounded-full bg-surface-container text-ink font-semibold text-xs flex items-center justify-center"
                      >
                        {i + 1}
                      </span>
                      <span className="font-semibold text-[15px]">{c.nameJa}</span>
                      {c.nameEn && c.nameEn !== c.nameJa && (
                        <span className="text-xs text-ink-muted" lang={/^[\x20-\x7E]+$/.test(c.nameEn) ? 'en' : undefined}>
                          ({c.nameEn})
                        </span>
                      )}
                    </div>
                    <span className={riskBadge(level)}>{riskLabel}</span>
                  </div>

                  <p className="text-sm text-ink-muted leading-relaxed">{c.reasonJa}</p>

                  <p className="text-xs text-ink-muted bg-surface-container-low px-2 py-1.5 rounded-lg">
                    <span className="font-semibold text-ink">含まれる肌荒れ製品:</span> {c.foundInProducts.join(', ')}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* 製品をまたぐ組み合わせの注意 */}
      {pairFindings && pairFindings.length > 0 && (
        <PairFindingList findings={pairFindings} heading="一緒に使っていた場合の注意" />
      )}

      {/* Amazon Safe Alternative Recommendations */}
      {safeAlternatives && safeAlternatives.length > 0 && (
        <AmazonAlternativeCard
          products={safeAlternatives}
          avoidedIngredients={culprits.map((c) => c.nameJa)}
        />
      )}

      {/* Dermatological Advice */}
      {adviceJa.length > 0 && (
        <section className={`${panel('safe')} space-y-1.5`}>
          <h3 className="flex items-center gap-1.5 font-semibold text-emerald-900">
            <Sparkles className="w-4 h-4" aria-hidden />
            <span>スキンケア見直しのヒント</span>
          </h3>
          <ul className="space-y-1 list-disc pl-5">
            {adviceJa.map((adv, idx) => (
              <li key={idx}>{adv}</li>
            ))}
          </ul>
        </section>
      )}

      {/* 結果だけが共有されても伝わるよう、カードの中にいつも出す（docs/review/legal-review-by-gemini.md） */}
      <p className="text-xs text-ink-muted leading-relaxed">
        ※本分析は、入力された全成分表示を機械的に比べた結果で、接触皮膚炎などの原因を医学的に特定・診断するものではありません。皮膚に異常がある場合や症状が続く場合は、皮膚科専門医にご相談ください。
      </p>
    </div>
  );
};
