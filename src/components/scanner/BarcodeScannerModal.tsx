'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  X,
  RefreshCw,
  Barcode,
  CheckCircle2,
  AlertCircle,
  Upload,
  Image as ImageIcon,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (barcode: string) => void;
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
}) => {
  const [manualCode, setManualCode] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const readerElementId = 'barcode-reader-viewport';

  useEffect(() => {
    let timer: NodeJS.Timeout;

    if (isOpen) {
      // DOMマウント完了を待ってからスキャナーを初期化
      timer = setTimeout(() => {
        startScanner();
      }, 200);
    } else {
      stopScanner();
    }

    return () => {
      clearTimeout(timer);
      stopScanner();
    };
  }, [isOpen]);

  const startScanner = async () => {
    setErrorMsg(null);

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
        } catch (e) {
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
      setIsScanning(true);

      await html5Qrcode.start(
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
    } catch (err: any) {
      console.warn('Camera scan failed or permission denied:', err);
      setIsScanning(false);
      setErrorMsg(
        'カメラの起動に失敗しました（HTTPS環境またはカメラ権限の許可が必要です）。写真アップロード、サンプルボタン、または直接入力をご利用ください。'
      );
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch (err) {
        // ignore stop errors
      }
      scannerRef.current = null;
      setIsScanning(false);
    }
  };

  const handleSuccess = (code: string) => {
    stopScanner();
    onScanSuccess(code.trim());
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCode.trim()) {
      handleSuccess(manualCode.trim());
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingFile(true);
    setErrorMsg(null);

    try {
      let scanner = scannerRef.current;
      if (!scanner) {
        scanner = new Html5Qrcode(readerElementId, {
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
      }

      const decodedResult = await scanner.scanFile(file, true);
      handleSuccess(decodedResult);
    } catch (err: any) {
      console.error('File scan error:', err);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-sand-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-sand-100 bg-sand-50/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-sage-100 text-sage-700 flex items-center justify-center">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-gray-800 text-base">バーコード（JAN/UPC）読取</h3>
              <p className="text-xs text-gray-500">カメラ、画像ファイル、または番号入力で即時取得</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-sand-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scanner Viewport */}
        <div className="p-6">
          <div className="relative rounded-xl overflow-hidden bg-gray-900 aspect-[4/3] flex items-center justify-center border-2 border-dashed border-sage-300">
            <div id={readerElementId} className="w-full h-full" />

            {/* Viewfinder overlay */}
            <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
              <div className="w-64 h-32 border-2 border-emerald-400 rounded-lg shadow-[0_0_15px_rgba(52,211,153,0.5)] relative">
                <div className="absolute top-0 left-0 w-4 h-4 border-t-4 border-l-4 border-emerald-500 -mt-1 -ml-1" />
                <div className="absolute top-0 right-0 w-4 h-4 border-t-4 border-r-4 border-emerald-500 -mt-1 -mr-1" />
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-4 border-l-4 border-emerald-500 -mb-1 -ml-1" />
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-4 border-r-4 border-emerald-500 -mb-1 -mr-1" />
                <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-red-400/80 animate-pulse" />
              </div>
              <span className="mt-3 text-xs text-white/90 bg-black/60 px-3 py-1 rounded-full font-medium">
                JAN (45/49), 韓国 (880), UPC対応
              </span>
            </div>

            {isProcessingFile && (
              <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-white text-xs gap-2">
                <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
                <span>画像を解析中...</span>
              </div>
            )}
          </div>

          {errorMsg && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-xs text-amber-800">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600" />
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
              className="w-full py-2 px-3 bg-sand-100 hover:bg-sand-200 text-gray-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors border border-sand-300"
            >
              <Upload className="w-4 h-4 text-sage-700" />
              <span>📷 バーコード写真・画像をアップロードして読取</span>
            </button>
          </div>

          {/* Manual Input Form */}
          <form onSubmit={handleManualSubmit} className="mt-3 flex gap-2">
            <div className="relative flex-1">
              <Barcode className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="バーコード番号を直接入力 (例: 4901301272133)"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm border border-sand-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sage-400"
              />
            </div>
            <button
              type="submit"
              disabled={!manualCode.trim()}
              className="px-4 py-2 bg-sage-600 hover:bg-sage-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-colors shadow-xs"
            >
              照合
            </button>
          </form>

          {/* Quick Demo Samples */}
          <div className="mt-4 pt-3 border-t border-sand-200">
            <p className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1.5">
              <span>💡 テスト用サンプルバーコード（クリックで即時照合）:</span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              {sampleBarcodes.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => handleSuccess(s.code)}
                  className="text-left p-2 rounded-xl border border-sand-200 hover:border-sage-400 hover:bg-sage-50/70 transition-all text-xs group bg-white shadow-2xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-gray-800 group-hover:text-sage-800 truncate">
                      {s.name}
                    </span>
                    <span className="text-[10px] text-gray-500 bg-sand-100 px-1.5 py-0.5 rounded">
                      {s.badge}
                    </span>
                  </div>
                  <span className="text-[11px] text-gray-400 font-mono">{s.code}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
