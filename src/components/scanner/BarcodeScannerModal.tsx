'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ModalDialog } from '../ui/ModalDialog';
import { badge, buttonPrimary, buttonSecondary, iconButton, panel } from '../ui/design';
import {
  Camera,
  X,
  RefreshCw,
  Barcode,
  AlertCircle,
  Upload,
  Clock,
} from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 読めたバーコードを渡す。受け付けられないとき（前の返答を待っている等）は、この画面に出す理由の文 */
  onScanSuccess: (barcode: string) => true | string;
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
}) => {
  const [manualCode, setManualCode] = useState('');
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // カメラの映像が出始めたか（起動待ちの案内を消す）
  const [cameraReady, setCameraReady] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  // 起動中（カメラ許可待ちなど）に閉じられた場合も確実にカメラを止めるため、起動処理を保持する
  const startPromiseRef = useRef<Promise<unknown> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // 1回読めたら、カメラが止まるまでに次の映像で読めても送らない（開き直すと受け付ける）
  const handledRef = useRef(false);
  const isOpenRef = useRef(isOpen);
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);
  const readerElementId = 'barcode-reader-viewport';

  const stopScanner = async () => {
    // 呼ばれた時点のスキャナーと起動処理を手元に取り、参照を空にする
    // （起動を待っている間に閉じて開き直されても、新しいスキャナーを止めない）
    const scanner = scannerRef.current;
    const starting = startPromiseRef.current;
    scannerRef.current = null;
    startPromiseRef.current = null;
    // 起動処理の完了を待ってから止める（待たないと isScanning が false のままカメラが残る）
    await starting?.catch(() => {});
    if (!scanner) return;
    try {
      if (scanner.isScanning) {
        await scanner.stop();
      }
      scanner.clear();
    } catch {
      // ignore stop errors
    }
  };

  const handleSuccess = (code: string) => {
    if (handledRef.current) return;
    handledRef.current = true;
    const accepted = onScanSuccess(code.trim());
    if (accepted !== true) {
      // 受け付けられなければ開いたまま理由を出し、少ししてからまた読む（同じ映像で続けて断らない）
      setErrorMsg(accepted);
      setTimeout(() => {
        if (isOpenRef.current) handledRef.current = false;
      }, 2_000);
      return;
    }
    void stopScanner();
  };

  const startScanner = async () => {
    setErrorMsg(null);
    setCameraReady(false);

    const element = document.getElementById(readerElementId);
    if (!element) {
      console.warn('Scanner DOM element not yet mounted');
      return;
    }

    try {
      if (scannerRef.current) {
        try {
          if (scannerRef.current.isScanning) {
            await scannerRef.current.stop();
          }
          scannerRef.current.clear();
        } catch {
          // ignore
        }
        scannerRef.current = null;
      }

      // JAN/EAN/UPCなど各種バーコードフォーマットを明示的に指定
      const html5Qrcode = new Html5Qrcode(readerElementId, {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.QR_CODE,
        ],
        verbose: false,
      });

      scannerRef.current = html5Qrcode;

      const starting = html5Qrcode.start(
        { facingMode: 'environment' },
        {
          fps: 15,
          qrbox: { width: 280, height: 160 },
          aspectRatio: 1.5,
        },
        (decodedText) => {
          handleSuccess(decodedText);
        },
        () => {
          // フレーム単位のエラーは無視
        }
      );
      startPromiseRef.current = starting;
      await starting;
      // 待っている間に閉じられていなければ、映像が出ている
      if (scannerRef.current === html5Qrcode) setCameraReady(true);
    } catch (err: unknown) {
      console.warn('Camera scan failed or permission denied:', err);
      setErrorMsg(
        'カメラの起動に失敗しました（HTTPS環境またはカメラ権限の許可が必要です）。写真アップロードまたは直接入力をご利用ください。'
      );
    }
  };

  // スキャナーの開始・停止（startScanner / stopScanner の定義より後に置く）
  useEffect(() => {
    let timer: NodeJS.Timeout;

    if (isOpen) {
      handledRef.current = false;
      // DOMマウント完了を待ってからスキャナーを初期化
      timer = setTimeout(() => {
        startScanner();
      }, 200);
    } else {
      // 閉じた後に届いた読み取り結果（画像の読み取り・止まる前の映像）は使わない
      handledRef.current = true;
      stopScanner();
    }

    return () => {
      clearTimeout(timer);
      stopScanner();
    };
    // モーダルの開閉時だけ実行する（関数を依存に入れると再描画のたびにカメラが再起動する）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // 全角の数字（日本語入力）や区切りの空白・ハイフンは、数字だけにそろえる
    const code = manualCode.normalize('NFKC').replace(/\D/g, '');
    if (code) handleSuccess(code);
    else setErrorMsg('バーコードの番号（数字）を入力してください。');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingFile(true);
    setErrorMsg(null);

    // カメラで読み取っている間は画像を読めない（html5-qrcode の制約）。カメラを止め、画像用に作り直す
    // 起動中（許可待ち）も含め、カメラを使っていて失敗していなければ、後で動かし直す
    const cameraWasRunning = scannerRef.current !== null && !errorMsg;
    await stopScanner();
    try {
      const scanner = new Html5Qrcode(readerElementId, {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.QR_CODE,
        ],
        verbose: false,
      });
      scannerRef.current = scanner;
      const decodedResult = await scanner.scanFile(file, true);
      handleSuccess(decodedResult);
    } catch (err: unknown) {
      console.error('File scan error:', err);
      // カメラで読み取っていたなら、もう一度カメラを動かしてから理由を出す（起動で案内が消えるため、後に出す）
      if (cameraWasRunning) await startScanner();
      setErrorMsg('画像からバーコードを検出できませんでした。より鮮明な画像をお試しいただくか、番号を直接ご入力ください。');
    } finally {
      setIsProcessingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const sampleBarcodes = [
    { name: 'キュレル 泡洗顔 (日本)', code: '4901301272133', badge: '🇯🇵 J-Beauty' },
    { name: 'メラノCC プレミアム美容液', code: '4987241169146', badge: '🇯🇵 J-Beauty' },
    { name: 'トリデン ダイブインセラム', code: '8809640730092', badge: '🇰🇷 K-Beauty' },
    { name: 'VT CICA スージングマスク', code: '8809695670868', badge: '🇰🇷 K-Beauty' },
    { name: 'セラヴィ 保湿クリーム', code: '3606000537736', badge: '🇺🇸 US' },
    { name: 'ポーラチョイス 2% BHA', code: '0655439020107', badge: '🇺🇸 US' },
  ];

  if (!isOpen) return null;

  return (
    <ModalDialog labelledBy="barcode-scanner-title" onClose={onClose}>
      <div>
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white flex items-center justify-between gap-2 pl-5 pr-1 py-1 min-h-14 border-b border-sand-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 shrink-0 rounded-full bg-primary text-on-primary flex items-center justify-center">
              <Camera className="w-4 h-4" aria-hidden />
            </div>
            <div>
              <h2 id="barcode-scanner-title" className="font-semibold text-ink text-lg leading-tight">バーコード（JAN/UPC）読取</h2>
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
              <div className="w-64 h-32 border-2 border-emerald-400 rounded-lg shadow-[0_0_15px_rgba(52,211,153,0.5)] relative">
                <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-emerald-500 -mt-1 -ml-1" />
                <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-emerald-500 -mt-1 -mr-1" />
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-emerald-500 -mb-1 -ml-1" />
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-emerald-500 -mb-1 -mr-1" />
                <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-red-400/80 animate-pulse motion-reduce:animate-none" />
              </div>
              <span className="mt-3 text-xs text-white/90 bg-black/60 px-3 py-1 rounded-full font-medium">
                JAN (45/49), 韓国 (880), UPC対応
              </span>
            </div>

            {isProcessingFile && (
              <div role="status" className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-white text-sm gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" aria-hidden />
                <span>画像を解析中...</span>
              </div>
            )}
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
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessingFile}
              className={`w-full ${buttonSecondary}`}
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
                placeholder="バーコード番号を直接入力 (例: 4901301272133)"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                aria-label="バーコード番号"
                inputMode="numeric"
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
                    className="text-left min-h-12 p-2 rounded-xl border border-sand-200 hover:border-emerald-500 hover:bg-tint-safe transition-colors text-xs bg-white"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-ink truncate">
                        {s.name}
                      </span>
                      <span className={badge('neutral')}>
                        {s.badge}
                      </span>
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
