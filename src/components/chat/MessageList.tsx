'use client';

import React, { type RefObject } from 'react';
import { Bot } from 'lucide-react';
import { ChatMessage } from '@/lib/types';
import { AFFILIATE_DISCLOSURE } from '@/lib/site';
import { MessageBubble, type MessageActions } from './MessageBubble';

interface MessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  loadingText: string;
  usedActions: ReadonlySet<string>;
  actions: MessageActions;
  /** 応答を待っている要求を止める（「中止」） */
  onAbort: () => void;
  /** 会話の最後（新しい吹き出しが届いたら、ここまでスクロールする） */
  messagesEndRef: RefObject<HTMLDivElement | null>;
}

/** 会話の欄：吹き出し、応答待ちの行（「中止」つき）、アフィリエイトの表示 */
export const MessageList: React.FC<MessageListProps> = ({
  messages,
  isLoading,
  loadingText,
  usedActions,
  actions,
  onAbort,
  messagesEndRef,
}) => (
  <>
    {/* Messages Scroll Area */}
    {/* relative：読み上げ用の sr-only（position: absolute）をこの中に収める。無いとページ全体が伸び、
        カードにフォーカスしたときにチャットではなくページがスクロールして画面が空になる */}
    <div className="relative flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:p-6 space-y-4">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} msg={msg} usedActions={usedActions} busy={isLoading} {...actions} />
      ))}

      {isLoading && (
        <div className="flex gap-3 items-center text-sm text-ink-muted">
          <div className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center shrink-0 animate-pulse motion-reduce:animate-none">
            <Bot className="w-[18px] h-[18px]" aria-hidden />
          </div>
          <div className="flex items-center gap-1.5 bg-white px-4 py-3 rounded-2xl rounded-tl-sm border border-sand-200 shadow-xs">
            <div className="w-1.5 h-1.5 bg-sage-500 rounded-full animate-bounce motion-reduce:animate-none" />
            <div className="w-1.5 h-1.5 bg-sage-500 rounded-full animate-bounce motion-reduce:animate-none [animation-delay:0.2s]" />
            <div className="w-1.5 h-1.5 bg-sage-500 rounded-full animate-bounce motion-reduce:animate-none [animation-delay:0.4s]" />
            <span className="ml-1 font-medium">{loadingText}</span>
          </div>
          <button
            type="button"
            onClick={onAbort}
            className="min-h-12 px-4 rounded-full text-sm font-semibold text-ink-muted hover:text-ink hover:bg-surface-container"
          >
            中止
          </button>
        </div>
      )}

      {/* アフィリエイトの表示：会話の最後に置き、スマホでも引き出しを開かずに見えるようにする（入力欄の下に固定すると画面を狭めるので、流れの中に置く） */}
      <p className="max-w-[720px] mx-auto pt-2 text-xs text-ink-muted text-center">{AFFILIATE_DISCLOSURE}</p>

      <div ref={messagesEndRef} />
    </div>
  </>
);
