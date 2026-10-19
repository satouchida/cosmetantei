'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ProductAnalysisResult, AnalyzedIngredient, KnownIngredient } from '@/lib/types';
import { ShieldCheck, Layers, AlertTriangle, AlertCircle, Info, Sparkles, HelpCircle, X, Globe, Loader2 } from 'lucide-react';
import { AmazonAlternativeCard } from './AmazonAlternativeCard';
import { ProductSourceLink } from './ProductSourceLink';
import { isShopListingProduct, isUserLabelProduct } from '@/lib/product-source';
import { apiFetch } from '@/lib/client/api-fetch';
import { NETWORK_MESSAGE, TIMEOUT_MESSAGE } from '@/lib/client/chat-request';
import {
  badge as badgeClass,
  buttonSecondary,
  card,
  panel,
  riskBadge,
  riskOf,
  routineAction,
  routineActionWide,
  textLink,
  type Tone,
} from '../ui/design';

interface IngredientAnalysisCardProps {
  analysis: ProductAnalysisResult;
  onAddToBadRoutine?: () => void;
  onAddToSafeRoutine?: () => void;
  onAddToCurrentRoutine?: () => void;
}

/**
 * 成分DBとルールで評価できない成分があり、まだ AI に評価を頼んでいない分析か。
 * 入力・撮影した成分表示は AI にまとめて送らないので頼まない（1成分ずつ「AIでさらに詳しく調べる」で調べられる）
 */
function needsAIEvaluation(a: ProductAnalysisResult): boolean {
  return a.riskCounts.unknown > 0 && !a.aiEvaluation && !a.isEstimatedFromMarketplaces && !isUserLabelProduct(a.product) && !isShopListingProduct(a.product);
}

/** 成分DB（出典と照合済み）で評価した成分か。ルールの推論（dyn_）・AI（ai_）は含めない */
function isDatabaseRated(ing: AnalyzedIngredient): boolean {
  const id = ing.matchedKnown?.id;
  return !!id && !id.startsWith('dyn_') && !id.startsWith('ai_');
}

/** 1回目で評価できなかったとき、もう1回頼むまでの時間（見つけたばかりの製品が、ほかのサーバーに届くのを待つ） */
const AI_RETRY_DELAY_MS = 4_000;
/** AI の評価・解説の1回の要求の上限。超えたら中断して、もう一度頼めるようにする */
const AI_REQUEST_TIMEOUT_MS = 30_000;

const isTimeout = (err: unknown) => err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError');

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

export const IngredientAnalysisCard: React.FC<IngredientAnalysisCardProps> = ({
  analysis: initialAnalysis,
  onAddToBadRoutine,
  onAddToSafeRoutine,
  onAddToCurrentRoutine,
}) => {
  const [pickedIngredient, setPickedIngredient] = useState<AnalyzedIngredient | null>(null);
  // 「AIでさらに詳しく調べる」を頼んでいる成分と、失敗した成分とその理由（別の成分を開いても混ざらないよう名前で持つ）
  const [explainingName, setExplainingName] = useState<string | null>(null);
  const [explainError, setExplainError] = useState<{ name: string; text: string } | null>(null);
  // 読み上げ：AI の解説を頼んだ・届いた（押したボタンの文字が変わるだけでは伝わらない）
  const [explainStatus, setExplainStatus] = useState('');
  // 「もう一度調べる」を押した回数（AI の評価を頼み直す）
  const [aiAttempt, setAiAttempt] = useState(0);
  // 成分の解説の見出し（開いたとき・AI の解説が届いたときにフォーカスを移す）
  const detailTitleRef = useRef<HTMLDivElement | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);
  // 未評価の成分の AI の評価（表示のあとで頼み、届いたら分析を差し替える）。
  // 結果は頼んだときの分析とひも付け、別の分析が渡されたら古い結果は使わない
  const [ai, setAi] = useState<{
    source: ProductAnalysisResult;
    result: ProductAnalysisResult | null;
    error?: string;
    rejected?: boolean;
  } | null>(null);
  // カード（「もう一度調べる」を押したとき、ボタンが消えるのでここへフォーカスを移す）
  const cardRef = useRef<HTMLDivElement | null>(null);
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

  // 開いている成分の解説は、AI の評価が届いたら新しい分析のものにする（「AIでさらに詳しく調べる」の結果はそのまま）
  const selectedIngredient =
    pickedIngredient && !pickedIngredient.aiExplained && !pickedIngredient.matchedKnown?.id.startsWith('ai_')
      ? (analysis.ingredients.find((i) => i.rawName === pickedIngredient.rawName) ?? pickedIngredient)
      : pickedIngredient;

  /** 解説の見出しへフォーカスを移す（描画のあとで） */
  const focusDetail = () => requestAnimationFrame(() => detailTitleRef.current?.focus());

  /** 成分を開く（開いている成分をもう一度押すと閉じる）。解説は成分の一覧の後にあるので、見出しへフォーカスを移す */
  const selectIngredient = (ing: AnalyzedIngredient) => {
    if (pickedIngredient?.rawName === ing.rawName) {
      setPickedIngredient(null);
      return;
    }
    setPickedIngredient(ing);
    focusDetail();
  };

  /** 解説を閉じて、その成分のボタンへ戻る */
  const closeIngredient = () => {
    const name = pickedIngredient?.rawName;
    const card = detailTitleRef.current?.closest('[data-analysis-card]');
    setPickedIngredient(null);
    requestAnimationFrame(() => {
      const pills = card?.querySelectorAll<HTMLElement>('[data-ingredient]') ?? [];
      [...pills].find((p) => p.dataset.ingredient === name)?.focus();
    });
  };

  const handleExplainWithAI = async (ingredientName: string) => {
    if (!ingredientName || explainingName) return;
    setExplainingName(ingredientName);
    setExplainError(null);
    setExplainStatus(`${ingredientName}をAIで調べています`);
    try {
      const res = await apiFetch(
        '/api/ingredients/explain',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ingredientName }),
        },
        { timeoutMs: AI_REQUEST_TIMEOUT_MS }
      );
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (!data?.ingredient) {
          setExplainError({ name: ingredientName, text: 'AI解説を取得できませんでした。しばらくしてからお試しください。' });
        } else {
          const explained: KnownIngredient = data.ingredient;
          setExplainStatus(`${ingredientName}の解説を表示しました`);
          // 調べている間に別の成分を選んでいたら、その成分には書き込まない
          setPickedIngredient((current) => {
            if (!current || current.rawName !== ingredientName) return current;
            if (isDatabaseRated(current)) {
              // 成分DBの成分は評価と名前は DB のまま。AI が書くのは解説だけ
              return {
                ...current,
                matchedKnown: {
                  ...current.matchedKnown!,
                  reasonJa: explained.reasonJa,
                  sensitiveSkinAdviceJa: explained.sensitiveSkinAdviceJa,
                  evidenceJa: explained.evidenceJa,
                },
                reasonJa: explained.reasonJa,
                aiExplained: true,
              };
            }
            // ルールの評価が AI より厳しければ、サーバーはルールの評価を返す。AI の評価が使われたときだけ「AIの評価」と書く
            const aiRated = explained.riskLevel !== 'unknown' && explained.riskLevel !== current.riskLevel;
            return {
              ...current,
              matchedKnown: explained,
              riskLevel: explained.riskLevel,
              category: explained.category,
              reasonJa: explained.reasonJa,
              aiEvaluated: aiRated,
              aiExplained: true,
            };
          });
        }
      } else {
        const data = await res.json().catch(() => null);
        setExplainError({ name: ingredientName, text: data?.error || 'AI解説を取得できませんでした。しばらくしてからお試しください。' });
      }
    } catch (err) {
      console.error('Failed to explain ingredient with AI:', err);
      setExplainError({ name: ingredientName, text: isTimeout(err) ? TIMEOUT_MESSAGE : NETWORK_MESSAGE });
    } finally {
      // 失敗は role=alert で読み上げるので、こちらは消す（成功の文は残す）
      setExplainStatus((s) => (s.endsWith('調べています') ? '' : s));
      setExplainingName(null);
      // 押したボタンは解説が届くと消える。そのボタン（解説の中）にフォーカスがあったときだけ、見出しへ移す
      const hadFocus = !!detailRef.current?.contains(document.activeElement);
      requestAnimationFrame(() => {
        if (hadFocus && (!document.activeElement || document.activeElement === document.body)) detailTitleRef.current?.focus();
      });
    }
  };
  const {
    product,
    overallRiskLevel,
    summaryJa,
    warningsJa,
    soothingHighlightsJa,
    ingredients,
    safeAlternatives,
    isEstimatedFromMarketplaces,
    dataSourceDisclaimer,
    labelNotesJa,
    labelReferences,
  } = analysis;

  const getOverallBadge = (): { title: string; tone: Tone; icon: typeof ShieldCheck } => {
    switch (overallRiskLevel) {
      case 'safe':
        return { title: '低刺激・安心設計', tone: 'safe', icon: ShieldCheck };
      case 'caution':
        return { title: '敏感肌はやや注意', tone: 'caution', icon: AlertTriangle };
      case 'warning':
        return { title: '刺激・アレルゲン成分あり', tone: 'warning', icon: AlertCircle };
      case 'insufficient_data':
        return { title: '成分データ不足で判定できません', tone: 'neutral', icon: HelpCircle };
    }
  };

  const aiIngredients = ingredients.filter((i) => i.aiEvaluated);

  const badge = getOverallBadge();
  const IconComponent = badge.icon;

  const getPillStyle = (ing: AnalyzedIngredient) => {
    // 鎮静・バリアを助ける成分は安全の緑で目立たせる
    if (ing.riskLevel === 'safe' && (ing.category === 'soothing' || ing.category === 'barrier_support')) {
      return 'bg-tint-safe text-emerald-900 border-emerald-300 hover:bg-emerald-100 font-semibold';
    }
    return riskOf(ing.riskLevel).pill;
  };

  return (
    <div ref={cardRef} tabIndex={-1} data-analysis-card className={`my-3 p-4 sm:p-5 space-y-4 text-ink focus:outline-none ${card}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 pb-3 border-b border-sand-200">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-sage-700">{product.brand}</span>
            {isEstimatedFromMarketplaces && (
              <span className={badgeClass('brand')}>
                <Globe className="w-3 h-3" aria-hidden />
                <span>Web探索成分データ</span>
              </span>
            )}
          </div>
          <h2 className="text-lg font-semibold text-ink leading-snug mt-0.5 break-keep [overflow-wrap:anywhere]">
            {product.name}
          </h2>
          <ProductSourceLink product={product} className="mt-1" />
        </div>
        <div className={`self-start ${badgeClass(badge.tone, 'large')}`}>
          <IconComponent className="w-4 h-4" aria-hidden />
          <span>{badge.title}</span>
        </div>
      </div>

      {/* Summary Box */}
      <p className="text-sm leading-relaxed">{summaryJa}</p>

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
            <p>{settled?.error ?? '成分データに無い成分を、AIで調べられませんでした。成分をタップすると、1つずつAIで調べられます。'}</p>
            {!settled?.rejected && (
              <button type="button" onClick={retryAIAnalysis} className={buttonSecondary}>
                もう一度調べる
              </button>
            )}
          </div>
        )}
      </div>
      {/* 完了の読み上げは、見えない別の枠で（上の枠に入れると、空でなくなって余白ができる） */}
      <div role="status" className="sr-only">
        {settled?.result?.aiEvaluation && `AIで${settled.result.aiEvaluation.evaluatedCount}成分を評価し、結果に反映しました。`}
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

      {/* 医薬部外品の成分表示の読み方（記載順・名称が表示されていない成分） */}
      {labelNotesJa && labelNotesJa.length > 0 && (
        <div className={`flex items-start gap-2 ${panel('neutral', 'small')}`}>
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-ink-muted" aria-hidden />
          <div className="space-y-0.5 text-ink-muted">
            {labelNotesJa.map((note, i) => (
              <p key={i}>{note}</p>
            ))}
            {labelReferences && labelReferences.length > 0 && (
              <p className="pt-0.5">
                成分名と表示のきまり:{' '}
                {labelReferences.map((ref, i) => (
                  <span key={ref.url}>
                    {i > 0 && '、'}
                    <a href={ref.url} target="_blank" rel="noopener noreferrer" className={textLink}>
                      {ref.title}
                      <span className="sr-only">（新しいタブで開く）</span>
                    </a>
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Online Marketplace Disclaimer Banner (if ingredients were retrieved from web/marketplace) */}
      {dataSourceDisclaimer && (
        <div className={`flex items-start gap-2 animate-fade-in ${panel('caution', 'small')}`}>
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" aria-hidden />
          <div className="space-y-0.5">
            <span className="font-semibold block">
              <span aria-hidden>🌐 </span>オンラインマーケットプレイス収集情報に関するご注意
            </span>
            <p>{dataSourceDisclaimer}</p>
          </div>
        </div>
      )}

      {/* Warnings & Highlights */}
      {warningsJa.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-rose-800">
            <AlertCircle className="w-4 h-4" aria-hidden />
            <span>敏感肌への注意・刺激成分</span>
          </h3>
          <ul role="list" className="space-y-1.5">
            {warningsJa.map((w, i) => (
              <li key={i} className={panel('warning')}>
                {w}
              </li>
            ))}
          </ul>
        </section>
      )}

      {soothingHighlightsJa.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-emerald-800">
            <Sparkles className="w-4 h-4" aria-hidden />
            <span>鎮静・バリア修復サポート成分</span>
          </h3>
          <ul role="list" className="space-y-1.5">
            {soothingHighlightsJa.map((h, i) => (
              <li key={i} className={panel('safe')}>
                {h}
              </li>
            ))}
          </ul>
        </section>
      )}

      {aiIngredients.length > 0 && (
        <details className={panel('neutral')}>
          <summary className="min-h-12 -my-3 flex items-center gap-1.5 cursor-pointer font-semibold">
            <Sparkles className="w-4 h-4 shrink-0" aria-hidden />
            <span>AIが評価した成分（{aiIngredients.length}成分）</span>
          </summary>
          <p className="mt-2 text-xs text-ink-muted">
            成分データに無い成分を、AIが皮膚科学の知見や公的な安全性評価をもとに評価しました。AIが作成したもので、誤りを含む可能性があります。気になる成分は、医師・薬剤師にご相談ください。
          </p>
          <ul role="list" className="mt-2 space-y-2">
            {aiIngredients.map((ing, i) => (
              <li key={i} className="pt-2 border-t border-sand-200">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold">{ing.rawName}</span>
                  <span className={riskBadge(ing.riskLevel)}>{riskOf(ing.riskLevel).label}</span>
                </div>
                <p className="mt-0.5 leading-relaxed">{ing.reasonJa}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Full Ingredients Cloud */}
      <section>
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <h3 className="text-[15px] font-semibold">全成分リスト ({ingredients.length}成分)</h3>
          <span className="text-xs text-ink-muted">タップで成分解説を表示</span>
        </div>
        {/* 段階は色だけでなく、ボタンの1文字でも示す（この一覧にある段階の凡例） */}
        {(() => {
          const levels = [...new Set(ingredients.map((i) => i.riskLevel))].filter((l) => riskOf(l).mark);
          return levels.length > 0 ? (
            <p className="mb-2 text-xs text-ink-muted" aria-hidden>
              {levels.map((l) => `${riskOf(l).mark}＝${riskOf(l).label}`).join('　')}
            </p>
          ) : null;
        })()}
        <div className="flex flex-wrap gap-2">
          {ingredients.map((ing, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => selectIngredient(ing)}
              data-ingredient={ing.rawName}
              aria-pressed={selectedIngredient?.rawName === ing.rawName}
              // 選んでいる成分は、色だけでなく枠でも分かるように
              className={`min-h-12 min-w-12 text-[13px] px-3 rounded-lg border transition-colors aria-pressed:ring-2 aria-pressed:ring-primary aria-pressed:ring-offset-1 ${getPillStyle(ing)}`}
            >
              {ing.isActive && <span className="mr-1 text-xs font-semibold text-sage-700">有効成分</span>}
              {riskOf(ing.riskLevel).mark && (
                <span className="mr-1 text-xs font-semibold" aria-hidden>
                  {riskOf(ing.riskLevel).mark}
                </span>
              )}
              {ing.rawName}
              {ing.aiEvaluated && (
                <span className="ml-1 text-xs font-semibold text-ink-muted" aria-hidden>
                  AI
                </span>
              )}
              {ing.riskLevel !== 'safe' && <span className="sr-only">（{riskOf(ing.riskLevel).label}）</span>}
              {ing.aiEvaluated && <span className="sr-only">（AIによる評価）</span>}
            </button>
          ))}
        </div>
      </section>

      {/* Ingredient Detail Modal / Popup */}
      {selectedIngredient && (
        <div
          ref={detailRef}
          role="region"
          aria-label="成分の解説"
          className="p-4 bg-surface-container-low rounded-xl border border-sand-200 relative animate-fade-in text-sm space-y-2"
        >
          <button
            type="button"
            onClick={closeIngredient}
            aria-label="成分の解説を閉じる"
            className="absolute top-0 right-0 w-12 h-12 flex items-center justify-center rounded-full text-ink-muted hover:text-ink hover:bg-surface-container"
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
          <div ref={detailTitleRef} tabIndex={-1} className="flex items-center gap-2 flex-wrap pr-10 focus:outline-hidden">
            {/* AI が書いた成分名は推測を含むので出さず、成分表示の名前を出す */}
            {selectedIngredient.aiEvaluated || selectedIngredient.matchedKnown?.id.startsWith('ai_') ? (
              <span className="font-semibold text-ink text-base">{selectedIngredient.rawName}</span>
            ) : (
              <>
                <span className="font-semibold text-ink text-base">
                  {selectedIngredient.matchedKnown?.nameJa || selectedIngredient.rawName}
                </span>
                {/* 英語の名前は英語として読み上げる */}
                <span
                  className="text-xs text-ink-muted"
                  lang={/^[\x20-\x7E]+$/.test(selectedIngredient.matchedKnown?.nameEn ?? '') ? 'en' : undefined}
                >
                  ({selectedIngredient.matchedKnown?.nameEn || selectedIngredient.rawName})
                </span>
              </>
            )}
            {selectedIngredient.isActive && <span className={badgeClass('neutral')}>医薬部外品の有効成分</span>}
            <span className={riskBadge(selectedIngredient.riskLevel)}>{riskOf(selectedIngredient.riskLevel).label}</span>
          </div>
          <p className="leading-relaxed">
            {selectedIngredient.matchedKnown?.reasonJa ||
              selectedIngredient.reasonJa ||
              'この成分の解説データはまだありません。'}
          </p>
          <p className="text-sage-800 font-medium leading-relaxed">
            <span aria-hidden>💡 </span>アドバイス: {selectedIngredient.matchedKnown?.sensitiveSkinAdviceJa ||
              '刺激性を評価できていないため、気になる場合は「AIでさらに詳しく調べる」で確認するか、パッチテストを行ってから使用してください。'}
          </p>
          {selectedIngredient.wheatDerived && (
            <p className={panel('caution', 'small')}>
              <span aria-hidden>🌾 </span>小麦由来の成分です。小麦アレルギーがある方は注意し、使用中にかゆみやはれが出たら使用をやめて医師に相談してください。
            </p>
          )}
          {selectedIngredient.jpStandard && (
            <p
              className={`text-xs leading-relaxed ${
                selectedIngredient.jpStandard.notAllowedHere ? 'text-rose-800 font-semibold' : 'text-ink-muted'
              }`}
            >
              <span aria-hidden>📋 </span>
              {selectedIngredient.jpStandard.textJa}{' '}
              <a
                href={selectedIngredient.jpStandard.referenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={textLink}
              >
                告示を見る<span className="sr-only">（新しいタブで開く）</span>
              </a>
            </p>
          )}
          {selectedIngredient.jpDesignated && (
            <p className="text-xs leading-relaxed text-ink-muted">
              <span aria-hidden>🏷️ </span>
              {selectedIngredient.jpDesignated.textJa}
              {selectedIngredient.jpDesignated.references.map((ref, i) => (
                <React.Fragment key={ref.url}>
                  {' '}
                  <a href={ref.url} target="_blank" rel="noopener noreferrer" title={ref.title} className={textLink}>
                    {i === 0 ? '成分の一覧' : '通知'}
                    <span className="sr-only">（{ref.title}。新しいタブで開く）</span>
                  </a>
                </React.Fragment>
              ))}
            </p>
          )}
          {selectedIngredient.matchedKnown?.evidenceJa && (
            <p className="text-xs leading-relaxed text-ink-muted">
              <span aria-hidden>📚 </span>根拠（AIによる）: {selectedIngredient.matchedKnown.evidenceJa}
            </p>
          )}
          {selectedIngredient.aiEvaluated ? (
            <p className="text-xs text-ink-muted">この評価と解説はAIが作成したもので、誤りを含む可能性があります。</p>
          ) : (
            (selectedIngredient.aiExplained || selectedIngredient.matchedKnown?.id.startsWith('ai_')) && (
              <p className="text-xs text-ink-muted">
                この解説はAIが作成したもので、誤りを含む可能性があります。
                {selectedIngredient.riskLevel === 'unknown'
                  ? 'AIも刺激性を判断できませんでした。'
                  : isDatabaseRated(selectedIngredient)
                    ? '刺激性の評価はコスメ探偵の成分データによるものです。'
                    : '刺激性の評価はコスメ探偵の判定ルールによるものです。'}
              </p>
            )
          )}
          {!selectedIngredient.aiExplained && !selectedIngredient.matchedKnown?.id.startsWith('ai_') && (
            <div className="pt-2 border-t border-sand-200">
              {/* 調べている間も disabled にはしない（押したボタンからフォーカスが失われるため）。押しても何もしない */}
              <button
                type="button"
                aria-disabled={explainingName ? true : undefined}
                onClick={() => handleExplainWithAI(selectedIngredient.rawName)}
                className={`${buttonSecondary} aria-disabled:opacity-60 aria-disabled:cursor-not-allowed`}
              >
                {explainingName === selectedIngredient.rawName ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden />
                    <span>AIで解析中...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" aria-hidden />
                    <span>AIでさらに詳しく調べる</span>
                  </>
                )}
              </button>
            </div>
          )}
          {explainingName && explainingName !== selectedIngredient.rawName && (
            <p className="text-xs text-ink-muted">ほかの成分をAIで調べています。終わってからお試しください。</p>
          )}
          {explainError?.name === selectedIngredient.rawName && (
            <p role="alert" className="text-xs text-rose-800">
              {explainError.text}
            </p>
          )}
        </div>
      )}

      {/* Amazon Safe Alternatives (if warning/caution) */}
      {safeAlternatives && safeAlternatives.length > 0 && (
        <AmazonAlternativeCard products={safeAlternatives} />
      )}

      {/* Routine Quick Actions */}
      <div className="pt-3 border-t border-sand-200 grid grid-cols-1 sm:grid-cols-3 gap-2">
        {onAddToBadRoutine && (
          <button type="button" onClick={onAddToBadRoutine} className={`${routineActionWide} ${routineAction.bad}`}>
            <AlertTriangle className="w-4 h-4" aria-hidden />
            <span>「肌荒れしたコスメ」に登録</span>
          </button>
        )}
        {onAddToSafeRoutine && (
          <button type="button" onClick={onAddToSafeRoutine} className={`${routineActionWide} ${routineAction.safe}`}>
            <ShieldCheck className="w-4 h-4" aria-hidden />
            <span>「安全なコスメ」に登録</span>
          </button>
        )}
        {onAddToCurrentRoutine && (
          <button
            type="button"
            onClick={onAddToCurrentRoutine}
            className={`${routineActionWide} ${routineAction.current}`}
          >
            <Layers className="w-4 h-4" aria-hidden />
            <span>「今使っている」に登録</span>
          </button>
        )}
      </div>
    </div>
  );
};
