import type { ProductAnalysisResult } from './types';

/**
 * 「やや注意」の理由が軽度の注意の成分だけのとき、その成分の名前（成分の並び順。AI が評価した成分は印付き）。
 * 注意・刺激成分の枠（warningsJa）に何かあれば、そこに理由があるので空。
 * 数えるのは総合判定と同じ成分（表示指定成分で引き上げただけの成分は除く）。
 * カードの外でも試せるよう、画面の部品から分けている（docs/plans/live-review-3-fixes.md の step 4）
 */
export function mildCautionNames(analysis: ProductAnalysisResult): string[] {
  if (analysis.overallRiskLevel !== 'caution' || analysis.warningsJa.length > 0) return [];
  return analysis.ingredients
    .filter((i) => i.riskLevel === 'low_caution' && !i.raisedForLabel)
    .map((i) => (i.aiEvaluated ? `${i.normalizedJa}（AIの評価）` : i.normalizedJa));
}
