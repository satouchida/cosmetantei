import React, { useRef, useState } from 'react';
import { apiFetch } from '@/lib/client/api-fetch';
import { NETWORK_MESSAGE } from '@/lib/client/chat-request';
import { parseSpendLimit, SPEND_LIMIT_HEADER } from '@/lib/spend-limit';
import type { LabelInput } from './LabelInputModal';

/** サーバーの上限（src/lib/services/label-reader.ts）と同じ */
export const MAX_TEXT_LENGTH = 5000;
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

/** 写真の読み取りの失敗（サーバーが理由を付けなかったとき）の、状態コードごとの案内 */
function readFailureMessage(status: number): string {
  if (status === 429) return '短い間に続けて読み取ったため、少し休んでいます。1分ほど待ってから、もう一度お試しください。';
  if (status >= 500) return 'サーバーで問題が起きました。少し時間をおいて、もう一度お試しください。';
  return '写真を読み取れませんでした。成分表示を文字で入力してください。';
}

type SetField = React.Dispatch<React.SetStateAction<string>>;

interface LabelReaderDeps {
  /** 入力欄の今の値と、書き換える関数（入力欄そのものは LabelInputModal が持つ） */
  text: string;
  name: string;
  brand: string;
  setText: SetField;
  setName: SetField;
  setBrand: SetField;
  /** 分析を依頼する（LabelInputModal の onSubmit と同じ） */
  onSubmit: (label: LabelInput) => Promise<boolean | string>;
  onClose: () => void;
}

/**
 * 成分表示の写真の読み取り（縮小・送信・読み取り中の止め・案内）と、分析の依頼・閉じる処理。
 * 読み取った文字は入力欄に入れ、ユーザーが確認・修正してから分析する。画面とフォーカスは LabelInputModal が持つ
 */
export function useLabelReader({ text, name, brand, setText, setName, setBrand, onSubmit, onClose }: LabelReaderDeps) {
  const [isReading, setIsReading] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  // 閉じたら写真の読み取りを止め、結果を隠れた入力欄に書き込まない
  const readAbortRef = useRef<AbortController | null>(null);
  // 最後に選んだ写真（読み取りに失敗したとき「もう一度読み取る」で使う。送ったあとも保存はしない）
  const lastPhotoRef = useRef<File | null>(null);
  const [canRetryPhoto, setCanRetryPhoto] = useState(false);

  const close = () => {
    readAbortRef.current?.abort();
    setNotice(null);
    onClose();
  };

  const handlePhoto = async (file: File | undefined) => {
    if (!file || isReading) return;
    lastPhotoRef.current = file;
    setCanRetryPhoto(false);
    setNotice(null);
    setIsReading(true);
    const controller = new AbortController();
    readAbortRef.current = controller;
    let data: string;
    try {
      data = await toJpegBase64(file);
    } catch {
      // 写真そのものを開けない・大きすぎる（別の写真を選んでもらう）
      setNotice({ kind: 'error', text: '写真を開けませんでした。別の写真を選ぶか、成分表示を文字で入力してください。' });
      setIsReading(false);
      if (readAbortRef.current === controller) readAbortRef.current = null;
      return;
    }
    try {
      const res = await apiFetch('/api/label/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: { mimeType: 'image/jpeg', data } }),
        signal: controller.signal,
      }, { timeoutMs: 60_000 });
      const body = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (controller.signal.aborted) return;
      if (res.ok && body?.text) {
        // 読み取れたら写真は持たない（もう一度読み取る必要は無い）
        lastPhotoRef.current = null;
        setText(body.text.slice(0, MAX_TEXT_LENGTH));
        setNotice({
          kind: 'info',
          text: '写真から読み取りました。パッケージと見比べて、違うところがあれば直してから「分析する」を押してください。',
        });
      } else {
        setNotice({ kind: 'error', text: body?.error || readFailureMessage(res.status) });
        // 写真が読めなかった（成分表示が見つからない等）のではなく、混雑・サーバーの問題なら、同じ写真でもう一度。
        // 今月・本日・端末の上限は時間がたつまで戻らないので、頼み直しは勧めない（src/lib/spend-limit.ts）
        const lasting = ['month', 'day', 'client'].includes(parseSpendLimit(res.headers.get(SPEND_LIMIT_HEADER)) ?? '');
        setCanRetryPhoto((res.status === 429 || res.status >= 500) && !lasting);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const timeout = err instanceof DOMException && err.name === 'TimeoutError';
      setNotice({
        kind: 'error',
        text: timeout
          ? '写真の読み取りに時間がかかりすぎたため、待つのをやめました。もう一度読み取るか、成分表示を文字で入力してください。'
          : NETWORK_MESSAGE,
      });
      setCanRetryPhoto(true);
    } finally {
      if (readAbortRef.current === controller) readAbortRef.current = null;
      setIsReading(false);
    }
  };

  /** 最後に選んだ写真をもう一度読み取る（「同じ写真をもう一度読み取る」） */
  const retryPhoto = () => handlePhoto(lastPhotoRef.current ?? undefined);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || isReading) return;
    setNotice(null);
    const submitted = { text, name, brand };
    const ok = await onSubmit({ text: text.trim(), name: name.trim() || undefined, brand: brand.trim() || undefined });
    if (typeof ok === 'string') {
      setNotice({ kind: 'info', text: ok });
      return;
    }
    if (ok) {
      // 分析を頼んだら、前の写真と、その失敗の案内は残さない（次に開いたときに出さない）
      lastPhotoRef.current = null;
      setCanRetryPhoto(false);
      setNotice(null);
      // 待っている間に開き直して入力し直した内容は消さない
      setText((current) => (current === submitted.text ? '' : current));
      setName((current) => (current === submitted.name ? '' : current));
      setBrand((current) => (current === submitted.brand ? '' : current));
    }
  };

  return { isReading, notice, canRetryPhoto, close, handlePhoto, retryPhoto, submit };
}
