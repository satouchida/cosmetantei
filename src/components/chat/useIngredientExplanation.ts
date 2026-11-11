'use client';

import { useState, type RefObject } from 'react';
import { ProductAnalysisResult, AnalyzedIngredient, KnownIngredient } from '@/lib/types';
import { apiFetch } from '@/lib/client/api-fetch';
import { NETWORK_MESSAGE, TIMEOUT_MESSAGE } from '@/lib/client/chat-request';
import { AI_REQUEST_TIMEOUT_MS, isTimeout } from './useAIAnalysis';

/** 成分DB（出典と照合済み）で評価した成分か。ルールの推論（dyn_）・AI（ai_）は含めない */
export function isDatabaseRated(ing: AnalyzedIngredient): boolean {
  const id = ing.matchedKnown?.id;
  return !!id && !id.startsWith('dyn_') && !id.startsWith('ai_');
}

/**
 * 開いている成分の解説と「AIでさらに詳しく調べる」。
 * detailTitleRef: 成分の解説の見出し（開いたとき・AI の解説が届いたときにフォーカスを移す）。detailRef: 解説の枠
 */
export function useIngredientExplanation(
  analysis: ProductAnalysisResult,
  detailTitleRef: RefObject<HTMLDivElement | null>,
  detailRef: RefObject<HTMLDivElement | null>
) {
  const [pickedIngredient, setPickedIngredient] = useState<AnalyzedIngredient | null>(null);
  // 「AIでさらに詳しく調べる」を頼んでいる成分と、失敗した成分とその理由（別の成分を開いても混ざらないよう名前で持つ）
  const [explainingName, setExplainingName] = useState<string | null>(null);
  const [explainError, setExplainError] = useState<{ name: string; text: string } | null>(null);
  // 読み上げ：AI の解説を頼んだ・届いた（押したボタンの文字が変わるだけでは伝わらない）
  const [explainStatus, setExplainStatus] = useState('');

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
            // 表示指定成分で「軽度の注意」に引き上げた成分は、解説の後も引き上げたまま（analyzeProduct と同じ）
            const raisedForLabel = !!current.jpDesignated && explained.riskLevel === 'safe';
            const riskLevel = raisedForLabel ? 'low_caution' : explained.riskLevel;
            const aiRated = explained.riskLevel !== 'unknown' && riskLevel !== current.riskLevel;
            return {
              ...current,
              matchedKnown: explained,
              riskLevel,
              raisedForLabel: raisedForLabel ? (true as const) : undefined,
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

  return { selectedIngredient, explainingName, explainError, explainStatus, selectIngredient, closeIngredient, handleExplainWithAI };
}
