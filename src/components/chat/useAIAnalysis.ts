'use client';

import { useEffect, useState, type RefObject } from 'react';
import { ProductAnalysisResult } from '@/lib/types';
import { apiFetch } from '@/lib/client/api-fetch';
import { isShopListingProduct, isUserLabelProduct } from '@/lib/product-source';
import { TIMEOUT_MESSAGE } from '@/lib/client/chat-request';

/**
 * 成分DBとルールで評価できない成分があり、まだ AI に評価を頼んでいない分析か。
 * 入力・撮影した成分表示は AI にまとめて送らないので頼まない（1成分ずつ「AIでさらに詳しく調べる」で調べられる）
 */
function needsAIEvaluation(a: ProductAnalysisResult): boolean {
  return a.riskCounts.unknown > 0 && !a.aiEvaluation && !a.isEstimatedFromMarketplaces && !isUserLabelProduct(a.product) && !isShopListingProduct(a.product);
}

/** 1回目で評価できなかったとき、もう1回頼むまでの時間（見つけたばかりの製品が、ほかのサーバーに届くのを待つ） */
const AI_RETRY_DELAY_MS = 4_000;
/** AI の評価・解説の1回の要求の上限。超えたら中断して、もう一度頼めるようにする */
export const AI_REQUEST_TIMEOUT_MS = 30_000;

export const isTimeout = (err: unknown) => err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError');

/**
 * 評価の結果。retry: 頼み直す意味がある失敗か（回数制限などの 4xx は頼み直しても同じ）。
 * error: サーバーが付けた理由の文（429 の「1分ほど待って」など。カードにそのまま出す）
 */
type AIFetch = { result: ProductAnalysisResult | null; retry: boolean; error?: string; rejected?: boolean };
/** rejected: サーバーが断った（回数・予算の上限など 4xx）。押して頼み直しても同じなので「もう一度調べる」を出さない */
type AIOutcome = { result: ProductAnalysisResult | null; error?: string; rejected?: boolean };

async function fetchAIAnalysis(a: ProductAnalysisResult): Promise<AIFetch> {
  try {
    const res = await apiFetch(
      '/api/analyze',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: a.product, aiEvaluate: true }),
      },
      { timeoutMs: AI_REQUEST_TIMEOUT_MS }
    );
    if (res.status >= 400 && res.status < 500) {
      const data = await res.json().catch(() => null);
      const error = typeof data?.error === 'string' && data.error ? data.error : undefined;
      return { result: null, retry: false, error, rejected: true };
    }
    const result = res.ok ? ((await res.json())?.result as ProductAnalysisResult | undefined) : undefined;
    return result?.aiEvaluation ? { result, retry: false } : { result: null, retry: true };
  } catch (err) {
    // 時間切れは、もう一度待たせない（カードの「もう一度調べる」で頼み直せる）
    return isTimeout(err) ? { result: null, retry: false, error: TIMEOUT_MESSAGE } : { result: null, retry: true };
  }
}

/**
 * 分析ごとに1回だけ AI の評価を頼む（StrictMode で effect が2回動いても、同じ分析なら同じ要求を使う）。
 * 評価できなかったら（5xx・通信の失敗・評価の無い応答）、少し待ってもう1回だけ頼む。それでもだめなら null
 */
const aiRequests = new WeakMap<ProductAnalysisResult, Promise<AIOutcome>>();
function requestAIAnalysis(a: ProductAnalysisResult): Promise<AIOutcome> {
  let request = aiRequests.get(a);
  if (!request) {
    request = (async () => {
      const first = await fetchAIAnalysis(a);
      if (first.result || !first.retry) return { result: first.result, error: first.error, rejected: first.rejected };
      await new Promise((resolve) => setTimeout(resolve, AI_RETRY_DELAY_MS));
      const second = await fetchAIAnalysis(a);
      return { result: second.result, error: second.error, rejected: second.rejected };
    })();
    aiRequests.set(a, request);
  }
  return request;
}

/**
 * 未評価の成分の AI の評価（表示のあとで頼み、届いたら分析を差し替える）と、その頼み直し。
 * cardRef: カード（「もう一度調べる」を押したとき、ボタンが消えるのでここへフォーカスを移す）
 */
export function useAIAnalysis(initialAnalysis: ProductAnalysisResult, cardRef: RefObject<HTMLDivElement | null>) {
  // 「もう一度調べる」を押した回数（AI の評価を頼み直す）
  const [aiAttempt, setAiAttempt] = useState(0);
  // 結果は頼んだときの分析とひも付け、別の分析が渡されたら古い結果は使わない
  const [ai, setAi] = useState<{
    source: ProductAnalysisResult;
    result: ProductAnalysisResult | null;
    error?: string;
    rejected?: boolean;
  } | null>(null);
  const settled = ai?.source === initialAnalysis ? ai : null;
  const analysis = settled?.result ?? initialAnalysis;
  const aiStatus: 'idle' | 'loading' | 'failed' =
    !needsAIEvaluation(initialAnalysis) || settled?.result ? 'idle' : settled ? 'failed' : 'loading';

  useEffect(() => {
    if (!needsAIEvaluation(initialAnalysis)) return;
    let cancelled = false;
    requestAIAnalysis(initialAnalysis).then(({ result, error, rejected }) => {
      if (!cancelled) setAi({ source: initialAnalysis, result, error, rejected });
    });
    return () => {
      cancelled = true;
    };
  }, [initialAnalysis, aiAttempt]);

  /** AI の評価を頼み直す（失敗・時間切れのあと） */
  const retryAIAnalysis = () => {
    aiRequests.delete(initialAnalysis);
    setAi(null);
    setAiAttempt((n) => n + 1);
    // 押したボタンは消えるので、カードへフォーカスを移す（読み上げは状態の枠で伝える）
    cardRef.current?.focus();
  };

  return {
    analysis,
    aiStatus,
    /** 評価できなかった理由（サーバーが付けた文・時間切れ）。無ければ定型文を出す */
    aiError: settled?.error,
    /** サーバーが断った（「もう一度調べる」を出さない） */
    aiRejected: settled?.rejected,
    /** 届いた AI の評価（完了の読み上げに使う） */
    aiEvaluation: settled?.result?.aiEvaluation,
    retryAIAnalysis,
  };
}
