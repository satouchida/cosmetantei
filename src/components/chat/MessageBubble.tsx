'use client';

import React from 'react';
import { AlertTriangle, Bot, User } from 'lucide-react';
import { ChatMessage, Product } from '@/lib/types';
import { ProductSuggestionCard } from './ProductSuggestionCard';
import { IngredientAnalysisCard } from './IngredientAnalysisCard';
import { DifferentialResultCard } from './DifferentialResultCard';
import { CurrentUseResultCard } from './CurrentUseResultCard';
import { PriceResultCard } from './PriceResultCard';
import { MessageCardBoundary } from './MessageCardBoundary';
import { withHiddenEmoji } from '../ui/emoji';
import { splitQuickReplyIcon } from './quick-replies';
import { QUICK_REPLY_ICON_COMPONENTS } from './quick-reply-icons';

/** 吹き出しの中のカードとボタンが呼ぶ処理 */
export interface MessageActions {
  onSelectToAnalyze: (product: Product) => void;
  onAddToBad: (product: Product) => void;
  onAddToUsable: (product: Product) => void;
  onFindAlternatives: (product: Product) => void;
  onPriceLookup: (product: Product) => void;
  onQuickReply: (label: string, sourceMessage: ChatMessage) => void;
}

interface MessageBubbleProps extends MessageActions {
  msg: ChatMessage;
  /** 一度押した有料の調べもののボタン（吹き出しの id と文言） */
  usedActions: ReadonlySet<string>;
  busy: boolean;
}

/** 会話の吹き出し1つ：本文、結果のカード、クイック返信ボタン */
export const MessageBubble: React.FC<MessageBubbleProps> = ({
  msg,
  usedActions,
  busy,
  onSelectToAnalyze,
  onAddToBad,
  onAddToUsable,
  onFindAlternatives,
  onPriceLookup,
  onQuickReply,
}) => (
    <div
      className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
    >
      {msg.role === 'assistant' && (
        <div className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
          <Bot className="w-[18px] h-[18px]" aria-hidden />
        </div>
      )}

      <div
        className={`${
          // 結果のカードを含む返信は幅いっぱいに使う（スマホでカードが細くならないように）
          msg.productSuggestions ||
          msg.singleAnalysis ||
          msg.differentialAnalysis ||
          msg.currentUseCheck ||
          msg.priceResult
            ? 'min-w-0 flex-1 max-w-[720px]'
            : 'max-w-[88%] sm:max-w-[75%]'
        } rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-xs ${
          msg.role === 'user'
            ? 'bg-primary text-on-primary rounded-tr-sm'
            : msg.isError
              ? 'bg-tint-warning text-rose-950 rounded-tl-sm border border-rose-200 border-l-[3px] border-l-rose-600'
              : 'bg-white text-ink rounded-tl-sm border border-sand-200'
        }`}
      >
        <div className="whitespace-pre-wrap">
          {msg.isError && <AlertTriangle className="inline w-4 h-4 mr-1 -mt-0.5 text-rose-700" aria-hidden />}
          {withHiddenEmoji(msg.content)}
        </div>
        {/* 結果のカードが描けない形の応答でも、ページ全体を止めない */}
        <MessageCardBoundary>

        {/* Product Suggestion Cards */}
        {msg.productSuggestions && (
          <ProductSuggestionCard
            products={msg.productSuggestions}
            onSelectToAnalyze={onSelectToAnalyze}
            onAddToBad={onAddToBad}
            onAddToUsable={onAddToUsable}
            isAlternatives={msg.suggestionKind === 'alternatives'}
            credits={msg.alternativeCredits}
            busy={busy}
          />
        )}

        {/* Single Product Analysis Card */}
        {msg.singleAnalysis && (
          <IngredientAnalysisCard
            analysis={msg.singleAnalysis}
            onAddToBadRoutine={() => onAddToBad(msg.singleAnalysis!.product)}
            onAddToUsableRoutine={() => onAddToUsable(msg.singleAnalysis!.product)}
            onFindAlternatives={() => void onFindAlternatives(msg.singleAnalysis!.product)}
            onPriceLookup={onPriceLookup}
            busy={busy}
          />
        )}

        {/* Differential Culprit Card with Amazon safe recommendations */}
        {msg.differentialAnalysis && (
          <DifferentialResultCard result={msg.differentialAnalysis} onPriceLookup={onPriceLookup} busy={busy} />
        )}

        {msg.currentUseCheck && <CurrentUseResultCard result={msg.currentUseCheck} />}

        {msg.priceResult && <PriceResultCard result={msg.priceResult} />}
        </MessageCardBoundary>

        {/* Quick Replies */}
        {msg.quickReplies && msg.quickReplies.length > 0 && (
          <div className="mt-3 pt-3 pb-1 border-t border-sand-200 flex flex-wrap gap-2">
            {msg.quickReplies.map((qr, i) => {
              const used = usedActions.has(`${msg.id}|${qr}`);
              // 先頭の絵文字は、ほかの画面と同じ線のアイコンで見せる（押したときは元の文言で処理する）
              const { icon: qrIconName, text: qrText } = splitQuickReplyIcon(qr);
              const QrIcon = qrIconName && QUICK_REPLY_ICON_COMPONENTS[qrIconName];
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onQuickReply(qr, msg)}
                  // 応答待ち・調べ済みでもフォーカスを失わないよう disabled にはせず、押したら案内を出す。
                  // 文字は薄くしない（押せるボタンなので、文字のコントラストを保つ）
                  aria-disabled={busy || used || undefined}
                  className="max-w-full min-h-12 inline-flex items-center gap-1.5 text-[13px] text-left bg-white hover:bg-tint-safe hover:border-emerald-500 text-ink border border-sand-300 px-4 py-2 rounded-full font-semibold transition-colors aria-disabled:text-ink-muted aria-disabled:bg-surface-container-low aria-disabled:border-dashed aria-disabled:cursor-not-allowed aria-disabled:hover:bg-surface-container-low aria-disabled:hover:border-sand-300"
                >
                  {QrIcon && <QrIcon className="w-4 h-4 shrink-0 text-sage-700" aria-hidden />}
                  <span>
                    {withHiddenEmoji(qrText)}
                    {used && <span className="ml-1 text-xs font-normal">（調べ済み）</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {msg.role === 'user' && (
        <div className="w-8 h-8 rounded-full bg-surface-container-high text-ink-muted flex items-center justify-center shrink-0 mt-0.5">
          <User className="w-[18px] h-[18px]" aria-hidden />
        </div>
      )}
    </div>
);
