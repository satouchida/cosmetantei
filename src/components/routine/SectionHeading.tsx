'use client';

import React from 'react';

interface SectionHeadingProps {
  icon: React.ReactNode;
  title: string;
  /** リストの点数 */
  count: number;
  /** 1点以上のときの点数の色 */
  countClassName: string;
}

/** リストの見出しと点数 */
export const SectionHeading: React.FC<SectionHeadingProps> = ({ icon, title, count, countClassName }) => (
  <div className="flex items-center justify-between gap-2">
    {/* tabIndex -1：画面のボタンからこの見出しへフォーカスを送れるように（Tab の順番には入らない） */}
    <h3 tabIndex={-1} className="flex items-center gap-1.5 text-[0.9375rem] font-semibold text-ink outline-none">
      {icon}
      <span>{title}</span>
    </h3>
    {/* 0点のときは色をつけない（赤の 0 がエラーに見えないように） */}
    <span
      className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${
        count === 0 ? 'bg-surface-container text-ink-muted' : countClassName
      }`}
    >
      {count}点
    </span>
  </div>
);
