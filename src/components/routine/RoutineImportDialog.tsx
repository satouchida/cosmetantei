'use client';

import React from 'react';
import { ClipboardList, X } from 'lucide-react';
import { ModalDialog } from '../ui/ModalDialog';
import { buttonPrimaryCompact, buttonSecondaryCompact, buttonTonal, iconButton, panel } from '../ui/design';
import { RoutineSnapshot } from '@/lib/routine-share';

interface RoutineImportDialogProps {
  snapshot: RoutineSnapshot;
  /** QR コード（リンク）から読んだ。製品は名前だけで、成分は入っていない */
  namesOnly: boolean;
  /** 今のリストが空なら「追加」と「置き換え」は同じなので、1つにする */
  hasCurrentLists: boolean;
  /** 置き換えると消える、入力・撮影した成分表示の商品の数（画像・リンクには入らない） */
  typedLabelsLost: number;
  onImport: (mode: 'append' | 'replace') => void;
  onClose: () => void;
  fallbackFocus?: () => HTMLElement | null;
}

/** 読み込むルーティンを確かめてもらう（選ぶまで何も変えない） */
export function RoutineImportDialog({
  snapshot,
  namesOnly,
  hasCurrentLists,
  typedLabelsLost,
  onImport,
  onClose,
  fallbackFocus,
}: RoutineImportDialogProps) {
  const rows: [string, number][] = [
    ['肌荒れしたコスメ', snapshot.badProducts.length],
    ['肌に合っていたコスメ', snapshot.safeProducts.length],
    ['今使っているコスメ', snapshot.currentUse.length],
  ];
  return (
    <ModalDialog labelledBy="routine-import-title" onClose={onClose} sheet fallbackFocus={fallbackFocus}>
      <div className="p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-primary" aria-hidden />
            <h2 id="routine-import-title" className="font-semibold text-ink text-lg">
              マイルーティンを読み込む
            </h2>
          </div>
          <button type="button" onClick={onClose} className={`-mr-2 ${iconButton}`} aria-label="閉じる">
            <X className="w-6 h-6" aria-hidden />
          </button>
        </div>

        <ul role="list" className="rounded-xl border border-sand-200 divide-y divide-sand-200">
          {rows.map(([label, count]) => (
            <li key={label} className="px-3 py-2.5 flex justify-between text-sm">
              <span className="text-ink">{label}</span>
              <span className="font-semibold text-ink">{count}点</span>
            </li>
          ))}
        </ul>

        {namesOnly && (
          <p className={panel('neutral', 'small')}>
            QRコードから読み込む商品は名前だけです。成分は、コスメ探偵に保存されている商品なら分析のときに使われます。成分が分からない商品は、商品名で検索すると調べ直せます。
          </p>
        )}

        {hasCurrentLists && typedLabelsLost > 0 && (
          <p className={panel('notice', 'small')}>
            置き換えると、入力・撮影した成分表示の商品（{typedLabelsLost}点）は消えます。残すときは「今のリストに追加」を選んでください。
          </p>
        )}

        {hasCurrentLists ? (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => onImport('append')} className={buttonPrimaryCompact}>
              今のリストに追加
            </button>
            <button type="button" onClick={() => onImport('replace')} className={buttonSecondaryCompact}>
              置き換える
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => onImport('replace')} className={`w-full ${buttonPrimaryCompact}`}>
            読み込む
          </button>
        )}
        <button type="button" onClick={onClose} className={`w-full ${buttonTonal}`}>
          やめる
        </button>
      </div>
    </ModalDialog>
  );
}
