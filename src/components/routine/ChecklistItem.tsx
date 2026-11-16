'use client';

import React from 'react';
import { CheckCircle2, Circle } from 'lucide-react';

interface ChecklistItemProps {
  /** 済んだか */
  done: boolean;
  /** 任意の手順（済んでいなくても押せる） */
  optional?: boolean;
  children: React.ReactNode;
}

/** 差分分析のボタンを押せるようになるまでの手順の1行 */
export const ChecklistItem: React.FC<ChecklistItemProps> = ({ done, optional = false, children }) => (
  <li className="flex items-center gap-1.5">
    {done ? (
      <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" aria-hidden />
    ) : (
      <Circle className="w-4 h-4 shrink-0 text-gray-500" aria-hidden />
    )}
    <span>
      {/* 説明文として続けて読まれるので、必須・任意の別と区切りの「。」を入れる */}
      <span className="sr-only">{done ? '済み：' : optional ? '任意・未：' : '必須・未：'}</span>
      {children}
      <span className="sr-only">。</span>
    </span>
  </li>
);
