'use client'; // エラーの境界はクライアントコンポーネント（node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md）

import { useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { buttonPrimary, buttonSecondary, panel } from '@/components/ui/design';

/**
 * 画面の表示中に起きた想定外のエラー（サーバーの応答の形が違う等）で、真っ白な画面にしない。
 * 会話の内容はこのページの中にしか無いので、やり直すと消えることを伝える
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-dvh bg-surface text-ink flex items-center justify-center p-4">
      <div role="alert" className={`max-w-md w-full space-y-4 ${panel('warning', 'roomy')}`}>
        <div className="flex items-start gap-2">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden />
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">画面を表示できませんでした</h1>
            <p className="text-sm">
              思わぬ問題が起きました。もう一度表示するか、ページを読み込み直してください。読み込み直すと、これまでの会話は消えます。
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => retry()} className={buttonPrimary}>
            もう一度表示する
          </button>
          <button type="button" onClick={() => window.location.reload()} className={buttonSecondary}>
            ページを読み込み直す
          </button>
        </div>
      </div>
    </main>
  );
}
