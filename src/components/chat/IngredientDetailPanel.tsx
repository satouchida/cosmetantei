'use client';

import React, { type RefObject } from 'react';
import { AnalyzedIngredient } from '@/lib/types';
import { Sparkles, X, Loader2 } from 'lucide-react';
import { outsideStandard, riskLabelFor } from './ingredient-marks';
import { isDatabaseRated } from './useIngredientExplanation';
import { badge as badgeClass, buttonSecondary, panel, riskBadge, textLink } from '../ui/design';

/** 成分の解説のアドバイス。化粧品基準の外 → 表示指定成分で引き上げた → 成分DB・ルールの文（無ければ定型文）の順 */
function adviceFor(ing: AnalyzedIngredient): string {
  if (outsideStandard(ing)) {
    return '日本の化粧品基準で、この製品には配合できない成分です。使う前に、成分表示と販売元の情報を確かめてください。';
  }
  if (ing.raisedForLabel) {
    return '表示指定成分です。この成分で肌に合わなかったことがある方は、避ける目安にしてください。';
  }
  return (
    ing.matchedKnown?.sensitiveSkinAdviceJa ||
    '刺激性を評価できていないため、気になる場合は「AIでさらに詳しく調べる」で確認するか、腕の内側などの目立たない部分で試してから使用してください。'
  );
}

interface IngredientDetailPanelProps {
  selectedIngredient: AnalyzedIngredient;
  /** 「AIでさらに詳しく調べる」を頼んでいる成分の名前 */
  explainingName: string | null;
  /** 「AIでさらに詳しく調べる」が失敗した成分とその理由 */
  explainError: { name: string; text: string } | null;
  onClose: () => void;
  onExplainWithAI: (ingredientName: string) => void;
  /** 解説の枠（カードで作る。AI の解説が届いたとき、フォーカスがこの中にあったか確かめる） */
  detailRef: RefObject<HTMLDivElement | null>;
  /** 解説の見出し（カードで作る。開いたとき・AI の解説が届いたときにフォーカスを移す） */
  detailTitleRef: RefObject<HTMLDivElement | null>;
}

/** 開いている成分の解説（化粧品基準・表示指定成分の注記と出典、「AIでさらに詳しく調べる」） */
export const IngredientDetailPanel: React.FC<IngredientDetailPanelProps> = ({
  selectedIngredient,
  explainingName,
  explainError,
  onClose,
  onExplainWithAI,
  detailRef,
  detailTitleRef,
}) => (
  <div
    ref={detailRef}
    role="region"
    aria-label="成分の解説"
    className="p-4 bg-surface-container-low rounded-xl border border-sand-200 relative animate-fade-in text-sm space-y-2"
  >
    <button
      type="button"
      onClick={onClose}
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
      <span className={riskBadge(selectedIngredient.riskLevel)}>{riskLabelFor(selectedIngredient)}</span>
    </div>
    <p className="leading-relaxed">
      {selectedIngredient.matchedKnown?.reasonJa ||
        selectedIngredient.reasonJa ||
        'この成分の解説データはまだありません。'}
    </p>
    <p className="text-sage-800 font-medium leading-relaxed">
      <span aria-hidden>💡 </span>アドバイス: {adviceFor(selectedIngredient)}
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
          onClick={() => onExplainWithAI(selectedIngredient.rawName)}
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
);
