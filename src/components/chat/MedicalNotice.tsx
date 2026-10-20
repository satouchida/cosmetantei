import React from 'react';

/**
 * 分析の結果のカードに、いつも出す注意（docs/review/legal-review-by-gemini.md）。
 * 結果だけが共有されても伝わるよう、カードの中に置く。医師法17条：成分表示を機械的に比べた参考情報で、診断ではない。
 * 受診のおすすめも添える
 */
export const MedicalNotice: React.FC<{ subject: string }> = ({ subject }) => (
  <p className="text-xs text-ink-muted leading-relaxed">
    ※{subject}は、全成分表示などの公開情報をもとにした化粧品選びの参考情報で、接触皮膚炎などの原因を医学的に特定・診断するものではありません。皮膚に異常がある場合や症状が続く場合は、皮膚科専門医にご相談ください。
  </p>
);
