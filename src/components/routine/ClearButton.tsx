'use client';

import React from 'react';
import { Trash2 } from 'lucide-react';

interface ClearButtonProps {
  onClick: () => void;
  /** ボタンの文字（どのリストをクリアするかを書く） */
  children: React.ReactNode;
}

/** リストをクリアするボタン（押すと確かめるダイアログが開く） */
export const ClearButton: React.FC<ClearButtonProps> = ({ onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full min-h-12 px-3 rounded-xl text-sm font-semibold text-ink-muted hover:text-rose-700 hover:bg-tint-warning active:bg-rose-100 inline-flex items-center justify-center gap-1.5 transition-colors"
  >
    <Trash2 className="w-4 h-4 shrink-0" aria-hidden />
    <span>{children}</span>
  </button>
);
