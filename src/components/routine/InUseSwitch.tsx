'use client';

import React from 'react';

interface InUseSwitchProps {
  /** 製品名（読み上げの名前に入れる） */
  name: string;
  /** 今も使っているか */
  inUse: boolean;
  onChange: (inUse: boolean) => void;
}

/**
 * 今も使っているか（スイッチ）。オフは「以前使っていた」：比較には使い、組み合わせチェックには使わない。
 * 名前と見える文字はいつも「今も使っている」、状態は aria-checked で伝える
 */
export const InUseSwitch: React.FC<InUseSwitchProps> = ({ name, inUse, onChange }) => {
  // 見える文字はいつも「今も使っている」（名前に見える文字を含める。WCAG 2.5.3）。オフのときの説明はスイッチの外に書く
  return (
    <div className="mt-1">
      <button
        type="button"
        role="switch"
        aria-checked={inUse}
        aria-label={`今も使っている（${name}）`}
        onClick={() => onChange(!inUse)}
        className="-ml-1 min-h-12 pr-2 pl-1 inline-flex items-center gap-2 rounded-lg text-xs text-ink hover:bg-surface-container-low active:bg-surface-container transition-colors"
      >
        <span
          aria-hidden
          className={`relative w-9 h-5 shrink-0 rounded-full transition-colors ${inUse ? 'bg-sky-700' : 'bg-gray-400'}`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-xs transition-[left] motion-reduce:transition-none ${
              inUse ? 'left-[18px]' : 'left-0.5'
            }`}
          />
        </span>
        <span>今も使っている</span>
      </button>
      {!inUse && <p className="text-xs text-ink-muted">以前使っていた製品です（比べるときだけ使い、組み合わせチェックには使いません）</p>}
    </div>
  );
};
