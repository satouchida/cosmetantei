import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

/** カメラを起動できなかった理由ごとの案内（html5-qrcode は DOMException か、その名前を含む文字列を投げる） */
function cameraErrorMessage(err: unknown): string {
  const text = err instanceof Error || err instanceof DOMException ? `${err.name} ${err.message}` : String(err);
  const fallback = '写真のアップロードか、番号の入力をご利用ください。';
  if (/NotAllowed|Permission/i.test(text)) {
    return `カメラの使用が許可されていません。ブラウザの設定でこのサイトにカメラを許可してから、もう一度起動してください。${fallback}`;
  }
  if (/NotFound|Overconstrained|DevicesNotFound/i.test(text)) return `カメラが見つかりませんでした。${fallback}`;
  if (/NotReadable|TrackStart|in use/i.test(text)) {
    return `カメラをほかのアプリが使っているようです。そのアプリを閉じてから、もう一度起動してください。${fallback}`;
  }
  return `カメラを起動できませんでした（HTTPS の接続とカメラの許可が必要です）。${fallback}`;
}

interface BarcodeScannerDeps {
  /** ダイアログが開いているか（開いたらカメラを起動し、閉じたら止める） */
  isOpen: boolean;
  /** 読めたバーコードを渡す。受け付けられないとき（前の返答を待っている等）は、画面に出す理由の文 */
  onScanSuccess: (barcode: string) => true | string;
}

/**
 * バーコードの読み取り：カメラの起動・停止（起動待ちの間に閉じられた場合も含む）、1回読めたら送らない止め、
 * 画像ファイルからの読み取り。画面（枠・番号の入力・フォーカス）は BarcodeScannerModal が持つ
 */
export function useBarcodeScanner({ isOpen, onScanSuccess }: BarcodeScannerDeps) {
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

  // カメラを起動できなかった（「もう一度起動する」を出す）
  const [cameraFailed, setCameraFailed] = useState(false);

  /** 読めたコードを渡す。受け付けられたら true、断られたら理由の文（読み取りの最中なら null） */

  const handleSuccess = (code: string): true | string | null => {
    if (handledRef.current) return null;
    handledRef.current = true;
    const accepted = onScanSuccess(code.trim());
    if (accepted !== true) {
      // 受け付けられなければ開いたまま理由を出し、少ししてからまた読む（同じ映像で続けて断らない）
      setErrorMsg(accepted);
      setTimeout(() => {
        if (isOpenRef.current) handledRef.current = false;
      }, 2_000);
      return accepted;
    }
    void stopScanner();
    return true;
  };

  /** 1回読めた後の止めを外す（番号の入力は、カメラで断った直後の待ちを待たずに受け付ける） */
  const acceptNextCode = () => {
    handledRef.current = false;
  };

  const startScanner = async () => {
    setErrorMsg(null);
    setCameraReady(false);
    setCameraFailed(false);

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
      setCameraFailed(true);
      setErrorMsg(cameraErrorMessage(err));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- モーダルの開閉時だけ実行する（startScanner / stopScanner は描画のたびに作り直すので、依存に入れると再描画のたびにカメラが再起動する）
  }, [isOpen]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || isProcessingFile) return;

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
      handledRef.current = false;
      const outcome = handleSuccess(decodedResult);
      // 断られたら（応答待ち・バーコードではない）、カメラを動かし直してから理由を出す（起動で案内が消えるため）
      if (outcome !== true && cameraWasRunning) {
        await startScanner();
        if (typeof outcome === 'string') setErrorMsg(outcome);
      }
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

  return {
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
  };
}
