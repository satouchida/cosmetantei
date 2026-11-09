'use client';

import React, { useState } from 'react';
import { ImageDown, X } from 'lucide-react';
import { ModalDialog } from '../ui/ModalDialog';
import { buttonPrimary, buttonTonal, iconButton } from '../ui/design';

interface ExportReminderDialogProps {
  /** 「画像で保存する」。dontShowAgain：「今後このお知らせを表示しない」を選んだ */
  onExport: (dontShowAgain: boolean) => void;
  /** 「あとで」・Escape・閉じるボタン */
  onLater: (dontShowAgain: boolean) => void;
  fallbackFocus?: () => HTMLElement | null;
}

/**
 * 「リストを画像で保存しませんか？」（docs/plans/two-lists.md の Step 4b）。肌荒れしたコスメのリストは保存しないので、
 * 比較の結果を出したときに1回すすめる（出す条件は src/lib/client/export-reminder.ts）
 */
export function ExportReminderDialog({ onExport, onLater, fallbackFocus }: ExportReminderDialogProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  return (
    <ModalDialog labelledBy="export-reminder-title" onClose={() => onLater(dontShowAgain)} sheet fallbackFocus={fallbackFocus}>
      <div className="p-4 sm:p-5 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ImageDown className="w-5 h-5 shrink-0 text-primary" aria-hidden />
            <h2 id="export-reminder-title" className="font-semibold text-ink text-lg">
              リストを画像で保存しませんか？
            </h2>
          </div>
          <button type="button" onClick={() => onLater(dontShowAgain)} className={`-mr-2 -mt-1 ${iconButton}`} aria-label="閉じる">
            <X className="w-6 h-6" aria-hidden />
          </button>
        </div>
        <p className="text-sm text-ink leading-relaxed">
          肌荒れしたコスメのリストは、ページを閉じると消えます（端末にも保存しません）。画像で保存しておくと、次回は「保存した画像から読み込む」で、検索し直さずに続きから使えます。
        </p>
        <label className="flex items-center gap-3 min-h-12 cursor-pointer text-sm text-ink">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
            className="w-5 h-5 accent-primary shrink-0"
          />
          今後このお知らせを表示しない
        </label>
        <div className="space-y-2">
          <button type="button" onClick={() => onExport(dontShowAgain)} className={`w-full ${buttonPrimary}`}>
            画像で保存する
          </button>
          <button type="button" onClick={() => onLater(dontShowAgain)} className={`w-full ${buttonTonal}`}>
            あとで
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
