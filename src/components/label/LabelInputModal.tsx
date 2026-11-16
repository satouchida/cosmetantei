'use client';

import React, { useRef, useState } from 'react';
import { Camera, FileText, ImagePlus, Loader2, X, AlertCircle } from 'lucide-react';
import { ModalDialog } from '../ui/ModalDialog';
import { buttonPrimary, buttonPrimaryCompact, buttonSecondaryCompact, iconButton, panel } from '../ui/design';
import { MAX_TEXT_LENGTH, useLabelReader } from './useLabelReader';

export interface LabelInput {
  text: string;
  name?: string;
  brand?: string;
}

interface LabelInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * 分析を依頼する。成功したら true（入力欄を空にする。失敗したときは入力を残してやり直せるようにする）。
   * 受け付けられないとき（前の返答を待っている等）は、この画面に出す理由の文
   */
  onSubmit: (label: LabelInput) => Promise<boolean | string>;
  /** 閉じたとき、開いたボタンが見えなくなっていれば代わりにフォーカスする要素 */
  fallbackFocus?: () => HTMLElement | null;
}

/** サーバーの上限（src/lib/services/label-reader.ts）と同じ */
const MAX_NAME_LENGTH = 100;

/**
 * 成分表示の入力（貼り付け・写真）。写真は文字に起こして入力欄に入れ、ユーザーが確認・修正してから分析する
 */
export const LabelInputModal: React.FC<LabelInputModalProps> = ({ isOpen, onClose, onSubmit, fallbackFocus }) => {
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const { isReading, notice, canRetryPhoto, close, handlePhoto, retryPhoto, submit } = useLabelReader({
    text,
    name,
    brand,
    setText,
    setName,
    setBrand,
    onSubmit,
    onClose,
  });

  if (!isOpen) return null;

  return (
    <ModalDialog labelledBy="label-input-title" onClose={close} sheet fallbackFocus={fallbackFocus}>
      <form onSubmit={submit} className="p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" aria-hidden />
            <h2 id="label-input-title" className="font-semibold text-ink text-lg">
              成分表示を入力
            </h2>
          </div>
          <button type="button" onClick={close} className={`-mr-2 ${iconButton}`} aria-label="閉じる">
            <X className="w-6 h-6" aria-hidden />
          </button>
        </div>

        <p className="text-sm text-ink-muted leading-relaxed">
          パッケージの「全成分」を貼り付けるか、写真を撮ってください。写真は成分の読み取りだけに使い、保存しません。
        </p>

        <div className="grid grid-cols-2 gap-2">
          {/* 読み取り中も disabled にはしない（押したボタンからフォーカスが失われるため）。押しても何もしない */}
          <button
            type="button"
            aria-disabled={isReading || undefined}
            onClick={() => !isReading && cameraInputRef.current?.click()}
            className={`${buttonPrimaryCompact} aria-disabled:opacity-60 aria-disabled:active:bg-primary aria-disabled:cursor-not-allowed`}
          >
            <Camera className="w-5 h-5" aria-hidden />
            <span>写真を<wbr />撮る</span>
          </button>
          <button
            type="button"
            aria-disabled={isReading || undefined}
            onClick={() => !isReading && fileInputRef.current?.click()}
            className={`${buttonSecondaryCompact} aria-disabled:opacity-60 aria-disabled:active:bg-white aria-disabled:cursor-not-allowed`}
          >
            <ImagePlus className="w-5 h-5" aria-hidden />
            <span>画像を<wbr />選ぶ</span>
          </button>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              handlePhoto(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              handlePhoto(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        {/* ステータスの入れ物は常に置き、中身だけ替える（中身ごと作ると読み上げられないことがある） */}
        <div role="status" className="space-y-3 empty:mb-0">
          {isReading && (
            <div className="flex items-center gap-2 text-sm text-sage-800">
              <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden />
              写真から成分表示を読み取っています…
            </div>
          )}
          {notice?.kind === 'info' && (
            <div className={`flex items-start gap-2 ${panel('caution')}`}>
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
              <span>{notice.text}</span>
            </div>
          )}
        </div>
        <div role="alert" className="empty:mb-0">
          {notice?.kind === 'error' && (
            <div className={`flex items-start gap-2 ${panel('warning')}`}>
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
              <span>{notice.text}</span>
            </div>
          )}
        </div>
        {notice?.kind === 'error' && canRetryPhoto && !isReading && (
          <button
            type="button"
            onClick={() => {
              // 押したボタンは読み取りの間は消えるので、成分表示の入力欄へフォーカスを移す
              textAreaRef.current?.focus();
              void retryPhoto();
            }}
            className={`w-full ${buttonSecondaryCompact}`}
          >
            同じ写真をもう一度読み取る
          </button>
        )}

        <label className="block space-y-1">
          <span className="text-sm font-semibold text-ink">成分表示</span>
          <textarea
            ref={textAreaRef}
            value={text}
            // 写真の読み取り中は、結果で入力途中の文章を消さないよう編集を止める（フォーカスは残す）
            readOnly={isReading}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_TEXT_LENGTH}
            rows={7}
            placeholder={'例）水、BG、グリセリン、ナイアシンアミド、フェノキシエタノール\n医薬部外品は「有効成分：…」「その他の成分：…」のまま貼り付けられます'}
            className="w-full px-3 py-2.5 text-sm bg-white border-[1.5px] border-outline rounded-xl focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary text-ink placeholder:text-gray-500 read-only:bg-surface-container-low"
          />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-ink">商品名（任意）</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME_LENGTH}
              className="w-full h-12 px-3 text-sm bg-white border-[1.5px] border-outline rounded-xl focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary text-ink"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-ink">ブランド（任意）</span>
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              maxLength={MAX_NAME_LENGTH}
              className="w-full h-12 px-3 text-sm bg-white border-[1.5px] border-outline rounded-xl focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary text-ink"
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={!text.trim() || isReading}
          className={`w-full ${buttonPrimary}`}
        >
          分析する
        </button>
      </form>
    </ModalDialog>
  );
};
