'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';
import { ProductAnalysisResult } from '@/lib/types';
import { isUserLabelProduct } from '@/lib/product-source';
import { buttonSecondary, panel } from '../ui/design';

interface AIStatusNoticesProps {
  /** 今の分析（AI の評価が届いたら差し替わったもの） */
  analysis: ProductAnalysisResult;
  /** 未評価の成分の AI の評価の状態（useAIAnalysis.ts） */
  aiStatus: 'idle' | 'loading' | 'failed';
  /** 評価できなかった理由（サーバーが付けた文・時間切れ）。無ければ定型文を出す */
  aiError?: string;
  /** サーバーが断った（「もう一度調べる」を出さない） */
  aiRejected?: boolean;
  /** 届いた AI の評価（完了の読み上げに使う） */
  aiEvaluation?: ProductAnalysisResult['aiEvaluation'];
  retryAIAnalysis: () => void;
  /** 「AIでさらに詳しく調べる」の開始・完了の読み上げ（useIngredientExplanation.ts） */
  explainStatus: string;
}

/** AI の評価の進み具合と読み上げの枠、入力した成分表示の案内（カードの直下に並ぶ兄弟要素） */
export const AIStatusNotices: React.FC<AIStatusNoticesProps> = ({
  analysis,
  aiStatus,
  aiError,
  aiRejected,
  aiEvaluation,
  retryAIAnalysis,
  explainStatus,
}) => (
  <>
    {/* 成分データに無い成分の AI の評価（読み上げで知らせる枠は先に置いておく） */}
    {/* 空のときは間隔を取らない（親の space-y の下余白を消す） */}
    <div role="status" className="empty:mb-0">
      {aiStatus === 'loading' && (
        <p className={`flex items-center gap-2 ${panel('neutral', 'small')}`}>
          <Loader2 className="w-4 h-4 shrink-0 animate-spin motion-reduce:animate-none text-ink-muted" aria-hidden />
          <span>成分データに無い{analysis.riskCounts.unknown}成分を、AIで調べています…</span>
        </p>
      )}
      {aiStatus === 'failed' && (
        <div className={`space-y-2 ${panel('neutral', 'small')}`}>
          {/* 回数の制限など、サーバーが理由を付けたときはそれを出す（「1つずつ調べて」と勧めても同じ制限に当たる） */}
          <p>{aiError ?? '成分データに無い成分を、AIで調べられませんでした。成分をタップすると、1つずつAIで調べられます。'}</p>
          {!aiRejected && (
            <button type="button" onClick={retryAIAnalysis} className={buttonSecondary}>
              もう一度調べる
            </button>
          )}
        </div>
      )}
    </div>
    {/* 完了の読み上げは、見えない別の枠で（上の枠に入れると、空でなくなって余白ができる） */}
    <div role="status" className="sr-only">
      {aiEvaluation && `AIで${aiEvaluation.evaluatedCount}成分を評価し、結果に反映しました。`}
    </div>
    {/* 「AIでさらに詳しく調べる」の開始・完了の読み上げ（いつも置いておく） */}
    <div role="status" className="sr-only">
      {explainStatus}
    </div>
    {/* 変わらない案内は、読み上げの枠の外に置く（描き直すたびに読み上げない） */}
    {isUserLabelProduct(analysis.product) && analysis.riskCounts.unknown > 0 && (
      <p className={panel('neutral', 'small')}>
        入力した成分表示は、まとめてAIに送りません。未評価の成分は、タップすると1つずつAIで調べられます。
      </p>
    )}
  </>
);
