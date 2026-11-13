'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

interface ChatLiveRegionsProps {
  toastMessage: string | null;
  toastKind: 'info' | 'error' | 'progress';
  /** スマホの引き出しが開いている（その間は入力欄へ飛ぶリンクを押せなくする） */
  isDrawerModal: boolean;
  isTrayVisible: boolean;
  trayCandidateCount: number;
  announcement: string;
  alertText: string;
}

/** 画面下の短い案内（トースト）、読み上げ用のライブリージョン、入力欄へ飛ぶリンク */
export const ChatLiveRegions: React.FC<ChatLiveRegionsProps> = ({
  toastMessage,
  toastKind,
  isDrawerModal,
  isTrayVisible,
  trayCandidateCount,
  announcement,
  alertText,
}) => (
  <>
    {/* Snackbar（Material 3：画面下、入力欄の上） */}
    {/* 読み上げ用のライブリージョンは常に置いておく（中身ごと追加すると読み上げられないことがある） */}
    <div role="status" className="sr-only">
      {toastMessage}
    </div>
    {/* キーボードで、ヘッダーと会話を飛ばして入力欄へ */}
    <a
      href="#chat-input"
      inert={isDrawerModal}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:bg-white focus:text-ink focus:px-4 focus:py-3 focus:rounded-lg focus:shadow-lg"
    >
      入力欄へ移動
    </a>
    {/* 検索候補の件数（トレイは開くたびに作り直されるので、こちらで読み上げる） */}
    <div role="status" className="sr-only">
      {isTrayVisible
        ? trayCandidateCount > 0
          ? `候補が${trayCandidateCount}件あります。下矢印キーで候補に移動できます。`
          : 'ブランドの候補があります。下矢印キーで移動できます。'
        : ''}
    </div>
    {/* 返答が届いた・調べ始めた（冒頭だけ）と、失敗（すぐ読み上げる） */}
    <div role="status" className="sr-only">
      {announcement}
    </div>
    <div role="alert" className="sr-only">
      {alertText}
    </div>
    {toastMessage && (
      <div
        aria-hidden
        className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] w-max max-w-[calc(100%-2rem)] bg-[#2c322f] text-[#ecf2ed] px-4 py-3 rounded-lg text-sm shadow-lg flex items-center gap-2 animate-fade-in"
      >
        {toastKind === 'error' ? (
          <AlertTriangle className="w-5 h-5 shrink-0 text-amber-300" aria-hidden />
        ) : toastKind === 'progress' ? (
          <Loader2 className="w-5 h-5 shrink-0 text-emerald-300 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-300" aria-hidden />
        )}
        <span>{toastMessage}</span>
      </div>
    )}
  </>
);
