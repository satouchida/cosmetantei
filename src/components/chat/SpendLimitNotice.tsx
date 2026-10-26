import React from 'react';
import { Info, X } from 'lucide-react';
import { SpendLimitReason, spendLimitMessage } from '@/lib/spend-limit';

/**
 * 有料の呼び出しが上限で断られたときの案内（入力欄の上）。エラーではなく、使える機能を伝える。
 * 出す・消すは src/lib/client/spend-limit-store.ts（上限が戻る時刻に消える。閉じることもできる）
 */
export const SpendLimitNotice: React.FC<{ reason: SpendLimitReason; onDismiss: () => void }> = ({ reason, onDismiss }) => (
  <div role="status" className="mb-2 flex items-start gap-2 rounded-xl border border-sand-300 bg-white pl-3 pr-1 py-1 shadow-xs">
    <Info className="mt-2.5 w-4 h-4 shrink-0 text-sage-700" aria-hidden />
    <p className="flex-1 min-w-0 py-2 text-xs text-ink leading-relaxed">{spendLimitMessage(reason)}</p>
    <button
      type="button"
      onClick={onDismiss}
      aria-label="案内を閉じる"
      className="min-h-11 min-w-11 flex items-center justify-center rounded-full text-ink-muted hover:bg-surface-container hover:text-ink shrink-0"
    >
      <X className="w-4 h-4" aria-hidden />
    </button>
  </div>
);
