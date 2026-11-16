'use client';

import React, { useRef } from 'react';
import { ImageDown, ImageUp } from 'lucide-react';
import { buttonTonal } from '../ui/design';

interface RoutineImageButtonsProps {
  /** 2つのリストがどちらも空（保存するものが無い） */
  isEmpty: boolean;
  /** マイルーティンを画像で保存・共有する */
  onExportImage: () => void;
  /** 保存した・共有された画像からマイルーティンを読み込む */
  onImportImage: (file: File) => void;
  /** 開発用のサンプル（使えるコスメは保存しない） */
  onLoadSample: () => void;
}

/**
 * バックアップ・共有（画像。docs/plans/routine-image.md）と、開発用のサンプルのボタン。
 * 読み込みはまれなので、文字だけのボタンにする
 */
export const RoutineImageButtons: React.FC<RoutineImageButtonsProps> = ({
  isEmpty,
  onExportImage,
  onImportImage,
  onLoadSample,
}) => {
  const importInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="space-y-1">
      <div>
        <button type="button" onClick={onExportImage} disabled={isEmpty} className={`w-full ${buttonTonal}`}>
          <ImageDown className="w-5 h-5 shrink-0" aria-hidden />
          <span>リストを<wbr />画像で<wbr />保存・共有</span>
        </button>
        <button
          type="button"
          onClick={() => importInputRef.current?.click()}
          className="w-full min-h-11 px-3 rounded-xl text-sm text-ink-muted hover:text-ink hover:underline inline-flex items-center justify-center gap-1.5 transition-colors"
        >
          <ImageUp className="w-4 h-4 shrink-0" aria-hidden />
          <span>保存した画像から読み込む</span>
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onImportImage(file);
          }}
        />
      </div>

      {/* 開発用：本番のビルドには出さない */}
      {process.env.NODE_ENV !== 'production' && (
        <button
          type="button"
          onClick={onLoadSample}
          className="w-full min-h-12 px-3 bg-surface-container-low hover:bg-surface-container active:bg-surface-container-high text-ink-muted rounded-xl text-sm font-medium transition-colors text-center"
        >
          🧪 テスト用比較データを自動セット（開発用）
        </button>
      )}
    </div>
  );
};
