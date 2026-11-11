'use client';

import { AlertTriangle, X } from 'lucide-react';
import { ModalDialog } from '../ui/ModalDialog';
import { buttonDanger, buttonPrimary, buttonSecondary, buttonTonal, iconButton } from '../ui/design';

export interface Choice {
  label: string;
  onSelect: () => void;
  /** danger：取り消せない操作（赤）。primary：主な操作。secondary：ほかの操作 */
  tone: 'danger' | 'primary' | 'secondary';
}

interface ChoiceDialogProps {
  title: string;
  message: string;
  choices: Choice[];
  /** 「やめる」・Escape・閉じるボタン */
  onCancel: () => void;
  /** 取り消せない操作を含む（見出しに注意のアイコンを付ける） */
  warning?: boolean;
  fallbackFocus?: () => HTMLElement | null;
}

const TONE = { danger: buttonDanger, primary: buttonPrimary, secondary: buttonSecondary } as const;

/**
 * 確かめてから進めるダイアログ（docs/plans/two-lists.md）。リストのクリア（取り消せないので赤の確定ボタン）と、
 * もう一方のリストにある製品を登録しようとしたとき（移す・削除する）に使う。最後に必ず「やめる」がある
 */
export function ChoiceDialog({ title, message, choices, onCancel, warning = false, fallbackFocus }: ChoiceDialogProps) {
  return (
    <ModalDialog labelledBy="choice-dialog-title" onClose={onCancel} sheet fallbackFocus={fallbackFocus}>
      <div className="p-4 sm:p-5 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {warning && <AlertTriangle className="w-5 h-5 shrink-0 text-rose-700" aria-hidden />}
            <h2 id="choice-dialog-title" className="font-semibold text-ink text-lg break-words">
              {title}
            </h2>
          </div>
          <button type="button" onClick={onCancel} className={`-mr-2 -mt-1 ${iconButton}`} aria-label="閉じる">
            <X className="w-6 h-6" aria-hidden />
          </button>
        </div>
        <p className="text-sm text-ink leading-relaxed break-words">{message}</p>
        <div className="space-y-2">
          {choices.map((c) => (
            <button key={c.label} type="button" onClick={c.onSelect} className={`w-full ${TONE[c.tone]}`}>
              {c.label}
            </button>
          ))}
          <button type="button" onClick={onCancel} className={`w-full ${buttonTonal}`}>
            やめる
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
