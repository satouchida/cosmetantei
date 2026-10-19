'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Download, Image as ImageIcon, Loader2, Share2, X } from 'lucide-react';
import { ModalDialog } from '../ui/ModalDialog';
import { buttonPrimaryCompact, buttonSecondaryCompact, iconButton, panel } from '../ui/design';
import { encodeShareLink, excludedCount, RoutineSnapshot, serializeRoutine } from '@/lib/routine-share';
import { renderRoutineImage } from '@/lib/client/routine-image';

interface RoutineExportDialogProps {
  snapshot: RoutineSnapshot;
  /** 最近の差分分析の「原因の可能性がある成分」 */
  culprits: string[];
  onClose: () => void;
  fallbackFocus?: () => HTMLElement | null;
}

interface Rendered {
  blob: Blob;
  url: string;
  /** QR コードに入りきらなかった（ファイルの中のデータだけ） */
  qrSkipped: boolean;
}

/** 作った画像か失敗。includeData は、どちらの設定で作ったか（切り替えた直後は前の画像を出さない） */
type Result = { includeData: boolean } & ({ rendered: Rendered } | { error: string });

const fileName = (d: Date) =>
  `cosmetantei-routine-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.png`;

/** マイルーティンを1枚の画像にして、保存・共有する（docs/plans/routine-image.md） */
export function RoutineExportDialog({ snapshot, culprits, onClose, fallbackFocus }: RoutineExportDialogProps) {
  const [includeData, setIncludeData] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // 「もう一度作る」を押した回数（作り直す）
  const [attempt, setAttempt] = useState(0);
  // 共有の画面を開いている間に、もう一度押されても開き直さない（InvalidStateError になる）
  const sharingRef = useRef(false);
  // 「もう一度作る」は押すと消えるので、押したらこのチェックボックスへフォーカスを移す
  const dataToggleRef = useRef<HTMLInputElement | null>(null);
  const skipped = excludedCount(snapshot);
  const current = result?.includeData === includeData ? result : null;
  const rendered = current && 'rendered' in current ? current.rendered : null;
  const error = current && 'error' in current ? current.error : null;

  // 開いたときの内容で作る（snapshot・culprits は開くときに親が決めたもの）。設定を切り替えたら作り直す
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const now = new Date();
        const shareUrl = includeData ? await encodeShareLink(snapshot) : null;
        const blob = await renderRoutineImage({
          culprits,
          safeProducts: snapshot.safeProducts.map((p) => ({ brand: p.brand, name: p.name })),
          badCount: snapshot.badProducts.length,
          currentCount: snapshot.currentUse.length,
          shareUrl,
          fileData: includeData ? serializeRoutine(snapshot, now.getTime()) : null,
          date: now,
        });
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setResult({ includeData, rendered: { blob, url, qrSkipped: includeData && !shareUrl } });
        setStatus('画像ができました');
      } catch (err) {
        console.error('Routine image failed:', err instanceof Error ? err.message : err);
        // ページを読み込み直すと、肌荒れ・安全のリストが消えるので、それは勧めない
        if (!cancelled) setResult({ includeData, error: '画像を作れませんでした。「もう一度作る」を押してください。ページは読み込み直さないでください（リストが消えます）。' });
      }
    })();
    return () => {
      cancelled = true;
      // 消した URL の画像を出したり保存したりしないよう、結果も消す
      if (url) URL.revokeObjectURL(url);
      setResult(null);
      setStatus(null);
    };
  }, [includeData, snapshot, culprits, attempt]);

  const file = rendered ? new File([rendered.blob], fileName(new Date()), { type: 'image/png' }) : null;
  const canShare = !!file && typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [file] });

  const share = async () => {
    if (!file || sharingRef.current) return;
    sharingRef.current = true;
    try {
      await navigator.share({ files: [file], text: 'コスメ探偵のマイルーティン #コスメ探偵' });
      setStatus('共有しました');
    } catch (err) {
      // 共有の画面を閉じただけなら何もしない
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setStatus('共有できませんでした。「画像を保存」から保存してください。');
    } finally {
      sharingRef.current = false;
    }
  };

  const save = () => {
    if (!rendered || !file) return;
    const a = document.createElement('a');
    a.href = rendered.url;
    a.download = file.name;
    a.click();
    setStatus('画像を保存しました');
  };

  return (
    <ModalDialog labelledBy="routine-export-title" onClose={onClose} sheet fallbackFocus={fallbackFocus}>
      <div className="p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-primary" aria-hidden />
            <h2 id="routine-export-title" className="font-semibold text-ink text-lg">
              画像で保存・共有
            </h2>
          </div>
          <button type="button" onClick={onClose} className={`-mr-2 ${iconButton}`} aria-label="閉じる">
            <X className="w-6 h-6" aria-hidden />
          </button>
        </div>

        <p className="text-sm text-ink-muted leading-relaxed">
          画像に書かれるのは、気をつけたい成分の候補と、肌に合っていたコスメです。肌荒れしたコスメの名前は書かれません（読み込み用のデータを入れると、QRコードの中には入ります）。
        </p>

        <label className="flex items-start gap-3 min-h-12 p-3 rounded-xl bg-surface-container-low cursor-pointer">
          <input
            ref={dataToggleRef}
            type="checkbox"
            checked={includeData}
            onChange={(e) => setIncludeData(e.target.checked)}
            className="mt-0.5 w-5 h-5 accent-primary shrink-0"
            aria-describedby="routine-export-data-hint"
          />
          <span className="text-sm">
            <span className="font-semibold text-ink">読み込み用のデータを入れる（QRコード）</span>
            <span id="routine-export-data-hint" className="block text-xs text-ink-muted mt-0.5 leading-relaxed">
              3つのリスト（肌荒れしたコスメを含む）を、QRコードと画像ファイルの中に入れます。この画像から、次に開いたときにリストを読み込めます。共有した画像を見た人も読み込めます。
            </span>
          </span>
        </label>

        <div className="rounded-xl border border-sand-200 bg-surface overflow-hidden aspect-[4/5] flex items-center justify-center">
          {rendered ? (
            // eslint-disable-next-line @next/next/no-img-element -- その場で作った画像（blob の URL）
            <img
              src={rendered.url}
              alt={`マイルーティンの画像（肌に合っていたコスメ ${snapshot.safeProducts.length}点${
                culprits.length > 0 ? `、気をつけたい成分の候補 ${culprits.slice(0, 5).join('、')}` : ''
              }${includeData && !rendered.qrSkipped ? '、読み込み用のQRコードつき' : ''}）`}
              className="w-full h-full object-contain"
            />
          ) : error ? (
            <div className="p-4 space-y-3 text-center">
              <p role="alert" className="text-sm text-rose-800">
                {error}
              </p>
              <button
                type="button"
                onClick={() => {
                  setAttempt((n) => n + 1);
                  dataToggleRef.current?.focus();
                }}
                className={buttonSecondaryCompact}
              >
                もう一度作る
              </button>
            </div>
          ) : (
            <Loader2 className="w-8 h-8 text-primary animate-spin motion-reduce:animate-none" aria-hidden />
          )}
        </div>

        {rendered?.qrSkipped && (
          <p className={panel('notice', 'small')}>
            リストが多く、QRコードに入りきりませんでした。読み込み用のデータは画像ファイルの中にだけ入れました（SNSに投稿した画像からは読み込めません）。
          </p>
        )}
        {skipped > 0 && (
          <p className={panel('neutral', 'small')}>
            入力・撮影した成分表示の商品と、お店の商品説明から成分を読んだ商品（{skipped}点）は、画像にも読み込み用のデータにも入れていません。
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          {canShare && (
            <button type="button" onClick={share} className={buttonPrimaryCompact}>
              <Share2 className="w-5 h-5" aria-hidden />
              共有する
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={!rendered}
            className={`${canShare ? buttonSecondaryCompact : buttonPrimaryCompact} ${canShare ? '' : 'col-span-2'}`}
          >
            <Download className="w-5 h-5" aria-hidden />
            画像を保存
          </button>
        </div>
        <p role="status" className="text-xs text-ink-muted min-h-4">
          {status ?? (rendered || error ? null : '画像を作っています…')}
        </p>
      </div>
    </ModalDialog>
  );
}
