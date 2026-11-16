'use client';

import React, { useRef, useState } from 'react';
import { ModalDialog } from '../ui/ModalDialog';
import { buttonPrimary, buttonSecondary, iconButton, panel } from '../ui/design';
import {
  Camera,
  X,
  RefreshCw,
  Barcode,
  AlertCircle,
  Upload,
  Clock,
} from 'lucide-react';
import { useBarcodeScanner } from './useBarcodeScanner';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 読めたバーコードを渡す。受け付けられないとき（前の返答を待っている等）は、この画面に出す理由の文 */
  onScanSuccess: (barcode: string) => true | string;
  /** 閉じたとき、開いたボタンが見えなくなっていれば代わりにフォーカスする要素（スマホの引き出しから開いたとき） */
  fallbackFocus?: () => HTMLElement | null;
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
  fallbackFocus,
}) => {
  const [manualCode, setManualCode] = useState('');
  const {
    readerElementId,
    fileInputRef,
    isProcessingFile,
    errorMsg,
    setErrorMsg,
    cameraReady,
    cameraFailed,
    startScanner,
    handleSuccess,
    acceptNextCode,
    handleFileUpload,
  } = useBarcodeScanner({ isOpen, onScanSuccess });
  // 番号の入力欄（「カメラをもう一度起動する」は押すと消えるので、ここへフォーカスを移す）
  const manualInputRef = useRef<HTMLInputElement | null>(null);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // 全角の数字（日本語入力）や区切りの空白・ハイフンは、数字だけにそろえる
    const code = manualCode.normalize('NFKC').replace(/\D/g, '');
    // 入力・画像は利用者が選んだ操作なので、カメラで断った直後の待ち（2秒）を待たずに受け付ける
    acceptNextCode();
    if (/^\d{8,14}$/.test(code)) handleSuccess(code);
    else setErrorMsg('バーコードの番号（8〜14桁の数字）を入力してください。');
  };

  const sampleBarcodes = [
    { name: 'キュレル 泡洗顔', code: '4901301272133' },
    { name: 'メラノCC プレミアム美容液', code: '4987241169146' },
    { name: 'トリデン ダイブインセラム', code: '8809640730092' },
    { name: 'VT CICA スージングマスク', code: '8809695670868' },
    { name: 'セラヴィ 保湿クリーム', code: '3606000537736' },
    { name: 'ポーラチョイス 2% BHA', code: '0655439020107' },
  ];

  if (!isOpen) return null;

  return (
    <ModalDialog labelledBy="barcode-scanner-title" onClose={onClose} fallbackFocus={fallbackFocus}>
      <div>
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white flex items-center justify-between gap-2 pl-5 pr-1 py-1 min-h-14 border-b border-sand-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 shrink-0 rounded-full bg-primary text-on-primary flex items-center justify-center">
              <Camera className="w-4 h-4" aria-hidden />
            </div>
            <div>
              <h2 id="barcode-scanner-title" className="font-semibold text-ink text-lg leading-tight">バーコード読取</h2>
              <p className="text-xs text-ink-muted">カメラ、画像ファイル、または番号入力で即時取得</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className={iconButton}
          >
            <X className="w-6 h-6" aria-hidden />
          </button>
        </div>

        {/* Scanner Viewport */}
        <div className="p-4 sm:p-6">
          <div className="relative rounded-xl overflow-hidden bg-gray-900 aspect-[4/3] flex items-center justify-center border-2 border-dashed border-sage-300">
            <div id={readerElementId} className="w-full h-full" />

            {/* Viewfinder overlay */}
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
              <div className="w-64 max-w-[85%] h-32 border-2 border-emerald-400 rounded-lg shadow-[0_0_15px_rgba(52,211,153,0.5)] relative">
                <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-emerald-500 -mt-1 -ml-1" />
                <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-emerald-500 -mt-1 -mr-1" />
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-emerald-500 -mb-1 -ml-1" />
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-emerald-500 -mb-1 -mr-1" />
                <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-red-400/80 animate-pulse motion-reduce:animate-none" />
              </div>
              <span className="mt-3 text-xs text-white/90 bg-black/60 px-3 py-1 rounded-full font-medium">
                バーコードを枠に合わせてください
              </span>
            </div>

            {isProcessingFile && (
              <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-white text-sm gap-2" aria-hidden>
                <RefreshCw className="w-6 h-6 animate-spin motion-reduce:animate-none text-emerald-400" />
                <span>画像を解析中...</span>
              </div>
            )}
          </div>
          {/* 読み上げの枠はいつも置いておく（画像の解析を始めたら読み上げる） */}
          <div role="status" className="sr-only">
            {isProcessingFile ? '画像を解析しています' : ''}
          </div>

          {/* カメラの起動待ちに閉じて開き直すと起動が止まることがあるため、待つように伝える */}
          {!errorMsg && !cameraReady && (
            <p className="mt-3 flex items-start gap-2 text-sm text-ink-muted">
              <Clock className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
              <span>カメラの起動には数秒かかります。画面が暗いままでも閉じずに、そのまま少しお待ちください。</span>
            </p>
          )}

          {errorMsg && (
            <div role="alert" className={`mt-3 flex items-start gap-2 ${panel('caution')}`}>
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" aria-hidden />
              <p>{errorMsg}</p>
            </div>
          )}
          {cameraFailed && (
            <button
              type="button"
              onClick={() => {
                manualInputRef.current?.focus();
                void startScanner();
              }}
              className={`mt-2 w-full ${buttonSecondary}`}
            >
              カメラをもう一度起動する
            </button>
          )}

          {/* Photo File Upload Trigger */}
          <div className="mt-3">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              type="button"
              // 解析中も disabled にはしない（押したボタンからフォーカスが失われるため）。押しても何もしない
              onClick={() => !isProcessingFile && fileInputRef.current?.click()}
              aria-disabled={isProcessingFile || undefined}
              className={`w-full ${buttonSecondary} aria-disabled:cursor-wait aria-disabled:active:bg-white`}
            >
              <Upload className="w-5 h-5" aria-hidden />
              <span>📷 バーコード写真・画像をアップロードして読取</span>
            </button>
          </div>

          {/* Manual Input Form */}
          <form onSubmit={handleManualSubmit} className="mt-3 flex gap-2">
            <div className="relative flex-1">
              <Barcode className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden />
              <input
                type="text"
                ref={manualInputRef}
                placeholder="バーコード番号を直接入力 (例: 4901301272133)"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                aria-label="バーコード番号"
                inputMode="numeric"
                enterKeyHint="search"
                autoComplete="off"
                className="w-full h-12 pl-9 pr-3 text-sm border-[1.5px] border-outline rounded-xl focus:outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
            <button
              type="submit"
              disabled={!manualCode.trim() || isProcessingFile}
              className={buttonPrimary}
            >
              照合
            </button>
          </form>

          {/* Quick Demo Samples（開発用：本番のビルドには出さない） */}
          {process.env.NODE_ENV !== 'production' && (
            <div className="mt-4 pt-3 border-t border-sand-200">
              <p className="text-xs font-semibold text-ink-muted mb-2 flex items-center gap-1.5">
                <span>💡 テスト用サンプルバーコード（クリックで即時照合）:</span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                {sampleBarcodes.map((s) => (
                  <button
                    key={s.code}
                    type="button"
                    onClick={() => handleSuccess(s.code)}
                    className="text-left min-h-12 p-2 rounded-xl border border-sand-200 hover:border-emerald-500 hover:bg-tint-safe active:bg-emerald-100 transition-colors text-xs bg-white"
                  >
                    <div className="font-semibold text-ink truncate">
                      {s.name}
                    </div>
                    <span className="text-xs text-ink-muted font-mono">{s.code}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalDialog>
  );
};
