'use client';

import React, { useRef, useState } from 'react';
import { Camera, FileText, ImagePlus, Loader2, X, AlertCircle } from 'lucide-react';
import { ModalDialog } from '../ui/ModalDialog';
import { buttonPrimary, buttonPrimaryCompact, buttonSecondaryCompact, iconButton, panel } from '../ui/design';
import { apiFetch } from '@/lib/client/api-fetch';

export interface LabelInput {
  text: string;
  name?: string;
  brand?: string;
}

interface LabelInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 分析を依頼する。成功したら true（入力欄を空にする。失敗したときは入力を残してやり直せるようにする） */
  onSubmit: (label: LabelInput) => Promise<boolean>;
}

/** サーバーの上限（src/lib/services/label-reader.ts）と同じ */
const MAX_TEXT_LENGTH = 5000;
const MAX_NAME_LENGTH = 100;
const MAX_IMAGE_BYTES = 1_500_000;
/** 写真は長い辺をこの大きさまで縮小する（文字が読める大きさで、送る量を減らす） */
const MAX_IMAGE_SIDE = 1600;
/** 縮小前の写真の上限（巨大なファイルを読み込まない） */
const MAX_SOURCE_FILE_BYTES = 30_000_000;

/** 写真を縮小して JPEG の base64 にする。上限に収まらなければ画質を下げる */
async function toJpegBase64(file: File): Promise<string> {
  if (file.size > MAX_SOURCE_FILE_BYTES) throw new Error('file too large');
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  try {
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  } finally {
    bitmap.close();
  }

  for (const quality of [0.85, 0.7, 0.55]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    if ((base64.length * 3) / 4 <= MAX_IMAGE_BYTES) return base64;
  }
  throw new Error('image too large');
}

/**
 * 成分表示の入力（貼り付け・写真）。写真は文字に起こして入力欄に入れ、ユーザーが確認・修正してから分析する
 */
export const LabelInputModal: React.FC<LabelInputModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [isReading, setIsReading] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 閉じたら写真の読み取りを止め、結果を隠れた入力欄に書き込まない
  const readAbortRef = useRef<AbortController | null>(null);

  if (!isOpen) return null;

  const close = () => {
    readAbortRef.current?.abort();
    setNotice(null);
    onClose();
  };

  const handlePhoto = async (file: File | undefined) => {
    if (!file) return;
    setNotice(null);
    setIsReading(true);
    const controller = new AbortController();
    readAbortRef.current = controller;
    try {
      const data = await toJpegBase64(file);
      const res = await apiFetch('/api/label/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: { mimeType: 'image/jpeg', data } }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (controller.signal.aborted) return;
      if (res.ok && body?.text) {
        setText(body.text.slice(0, MAX_TEXT_LENGTH));
        setNotice({
          kind: 'info',
          text: '写真から読み取りました。パッケージと見比べて、違うところがあれば直してから「分析する」を押してください。',
        });
      } else {
        setNotice({ kind: 'error', text: body?.error || '写真を読み取れませんでした。成分表示を文字で入力してください。' });
      }
    } catch {
      if (controller.signal.aborted) return;
      setNotice({ kind: 'error', text: '写真を読み込めませんでした。別の写真を選ぶか、成分表示を文字で入力してください。' });
    } finally {
      if (readAbortRef.current === controller) readAbortRef.current = null;
      setIsReading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || isReading) return;
    setNotice(null);
    const ok = await onSubmit({ text: text.trim(), name: name.trim() || undefined, brand: brand.trim() || undefined });
    if (ok) {
      setText('');
      setName('');
      setBrand('');
    }
  };

  return (
    <ModalDialog labelledBy="label-input-title" onClose={close} sheet>
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
          <button
            type="button"
            disabled={isReading}
            onClick={() => cameraInputRef.current?.click()}
            className={buttonPrimaryCompact}
          >
            <Camera className="w-5 h-5" aria-hidden />
            写真を撮る
          </button>
          <button
            type="button"
            disabled={isReading}
            onClick={() => fileInputRef.current?.click()}
            className={buttonSecondaryCompact}
          >
            <ImagePlus className="w-5 h-5" aria-hidden />
            画像を選ぶ
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

        {isReading && (
          <div role="status" className="flex items-center gap-2 text-sm text-sage-800">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
            写真から成分表示を読み取っています…
          </div>
        )}
        {notice && (
          <div
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={`flex items-start gap-2 ${panel(notice.kind === 'error' ? 'warning' : 'caution')}`}
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
            <span>{notice.text}</span>
          </div>
        )}

        <label className="block space-y-1">
          <span className="text-sm font-semibold text-ink">成分表示</span>
          <textarea
            value={text}
            // 写真の読み取り中は、結果で入力途中の文章を消さないよう編集を止める
            disabled={isReading}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_TEXT_LENGTH}
            rows={7}
            placeholder={'例）水、BG、グリセリン、ナイアシンアミド、フェノキシエタノール\n医薬部外品は「有効成分：…」「その他の成分：…」のまま貼り付けられます'}
            className="w-full px-3 py-2.5 text-sm bg-white border-[1.5px] border-outline rounded-xl focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary text-ink placeholder:text-gray-500 disabled:bg-surface-container-low"
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
