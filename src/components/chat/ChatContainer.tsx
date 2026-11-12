'use client';

import React, { useState, useRef, useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ChatMessage } from '@/lib/types';
import { ProductSuggestionCard } from './ProductSuggestionCard';
import { IngredientAnalysisCard } from './IngredientAnalysisCard';
import { DifferentialResultCard } from './DifferentialResultCard';
import { CurrentUseResultCard } from './CurrentUseResultCard';
import { PriceResultCard } from './PriceResultCard';
import { BarcodeScannerModal } from '../scanner/BarcodeScannerModal';
import { LabelInputModal } from '../label/LabelInputModal';
import { BAD_SECTION_ID, DIFFERENTIAL_LABEL, RoutineSidebar, USABLE_SECTION_ID } from '../routine/RoutineSidebar';
import { RoutineExportDialog } from '../routine/RoutineExportDialog';
import { RoutineImportDialog } from '../routine/RoutineImportDialog';
import { ChoiceDialog } from '../routine/ChoiceDialog';
import { ExportReminderDialog } from '../routine/ExportReminderDialog';
import {
  Camera,
  Send,
  Bot,
  User,
  Menu,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  FileText,
  CalendarClock,
  ScanBarcode,
  ClipboardList,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { LiveSearchCandidateTray } from '../search/LiveSearchCandidateTray';
import { MessageCardBoundary } from './MessageCardBoundary';
import { withHiddenEmoji } from '../ui/emoji';
import { busyLook } from '../ui/design';
import { splitQuickReplyIcon } from './quick-replies';
import { isPersistable, MAX_USABLE, STALE_AFTER_MONTHS, updateUsable, UsableEntry } from '@/lib/usable-products';
import { turnOffExportReminder } from '@/lib/client/export-reminder';
import { shareFragment } from '@/lib/routine-share';
import { LegalLinks } from '@/components/legal/LegalPage';
import { SpendLimitNotice } from '@/components/chat/SpendLimitNotice';
import {
  dismissSpendLimit,
  getSpendLimitServerSnapshot,
  getSpendLimitSnapshot,
  subscribeSpendLimit,
} from '@/lib/client/spend-limit-store';
import { AFFILIATE_DISCLOSURE } from '@/lib/site';
import { ConsentDialog } from '@/components/legal/ConsentDialog';
import { getConsentServerSnapshot, hasConsented, subscribeConsent } from '@/lib/consent';
import { RegisteredProductsContext } from './RegisteredProducts';
import { useRoutineLists } from './useRoutineLists';
import { useRoutineTransfer } from './useRoutineTransfer';
import { useTypeahead } from './useTypeahead';
import { usePageChrome } from './usePageChrome';
import { useChatRequests } from './useChatRequests';
import { QUICK_REPLY_ICON_COMPONENTS } from './quick-reply-icons';
import {
  currentTime,
  ROUTINE_QR_READER_ID,
  SAMPLE_CUREL,
  SAMPLE_IHADA,
  SAMPLE_MELANO,
  SEARCH_TRAY_ID,
  WAIT_MESSAGE,
} from './chat-helpers';

export const ChatContainer: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-1',
      role: 'assistant',
      content: `🔍 肌荒れの原因になりうる成分の候補を調べるサービスです。化粧品名を入力するか、バーコードを読み取ってください。\n\n肌荒れしたコスメと使えるコスメを比べて候補を絞り込み、その成分を含まない商品（販売ページへのリンク付き。PR）を探します。医療上の診断ではありません。肌に異常があるときは皮膚科専門医にご相談ください。`,
      timestamp: currentTime(),
      quickReplies: [
        '📸 バーコードをスキャンする',
        '📝 成分表示を入力する',
        '🧴 キュレルの泡洗顔を調べる',
        '💧 トリデンのセラムを調べる',
        '⚡️ メラノCCで赤みが出た',
      ],
    },
  ]);

  const [input, setInput] = useState('');
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isLabelInputOpen, setIsLabelInputOpen] = useState(false);
  // 入力途中の候補（候補トレイ。useTypeahead.ts）
  const { liveBrands, trayCandidates, trayCredits, isTrayVisible, setIsTrayOpen, clearCandidates, skipSearchFor } =
    useTypeahead({ input });
  // 利用規約・Cookie の使用への同意（src/lib/consent.ts）。null はまだ分からない（サーバーで描いた直後）
  const consented = useSyncExternalStore(subscribeConsent, hasConsented, getConsentServerSnapshot);
  // トースト・スマホの引き出し・同意した直後のフォーカス（usePageChrome.ts）
  const {
    toastMessage,
    toastKind,
    setToastMessage,
    showToast,
    isSidebarOpen,
    setIsSidebarOpen,
    isDrawerModal,
    closeSidebar,
    mainRef,
    inputRef,
    menuButtonRef,
    drawerCloseRef,
  } = usePageChrome({ consented });

  // 2つのリスト（肌荒れしたコスメ・使えるコスメ）と、登録・移動・削除・クリアの処理（useRoutineLists.ts）
  const {
    badProducts,
    badRef,
    updateBad,
    usable,
    routine,
    registeredProducts,
    staleEntries,
    staleIds,
    listsKey,
    listConflict,
    setListConflict,
    clearTarget,
    setClearTarget,
    handleAddToBad,
    handleAddToUsable,
    moveToList,
    removeFromOtherList,
    handleRemoveUsable,
    handleConfirmUsable,
    handleSetInUse,
    handleRemoveBad,
    clearList,
  } = useRoutineLists({ showToast });
  // 有料の呼び出しが上限で断られたときの案内（apiFetch が応答のヘッダーを見て出す）
  const spendLimit = useSyncExternalStore(subscribeSpendLimit, getSpendLimitSnapshot, getSpendLimitServerSnapshot);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  // スマホの引き出しの中のボタンから開いたダイアログを閉じたときの、フォーカスの戻り先（ヘッダーのボタン）
  const scanButtonRef = useRef<HTMLButtonElement | null>(null);
  const labelButtonRef = useRef<HTMLButtonElement | null>(null);


  // 画像での保存・読み込みと、比較の結果のあとの「リストを画像で保存しませんか？」（useRoutineTransfer.ts）
  const {
    routineExport,
    setRoutineExport,
    routineImport,
    setRoutineImport,
    isExportReminderOpen,
    setIsExportReminderOpen,
    offerExportAfterResult,
    handleExportImage,
    handleImportImage,
    importFromFragment,
    applyImport,
  } = useRoutineTransfer({
    messages,
    showToast,
    setToastMessage,
    setIsSidebarOpen,
    badProducts,
    badRef,
    updateBad,
    usable,
    listsKey,
    listConflict,
    clearTarget,
    isScannerOpen,
    isLabelInputOpen,
    isDrawerModal,
    consented,
  });

  // サーバーに頼む操作とクイック返信ボタン（useChatRequests.ts）
  const {
    isLoading,
    loadingText,
    announcement,
    alertText,
    usedActions,
    isBusy,
    abortRequest,
    handleSendMessage,
    handleBarcodeScanned,
    handleLabelSubmit,
    handleSelectProductToAnalyze,
    handleFindAlternatives,
    handleAlternativePriceLookup,
    handleQuickReply,
    handleRunDifferential,
    requestDifferential,
    handleCheckCurrentUse,
  } = useChatRequests({
    setMessages,
    input,
    setInput,
    inputRef,
    showToast,
    setIsTrayOpen,
    skipSearchFor,
    setIsScannerOpen,
    setIsLabelInputOpen,
    routine,
    usable,
    staleEntries,
    handleAddToBad,
    handleAddToUsable,
    updateBad,
    offerExportAfterResult,
  });

  const scrollToBottom = () => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    messagesEndRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  /** 開発用のサンプル。使えるコスメの分は保存しない（sessionOnly。利用者の保存したリストを書き換えない） */
  const handleLoadSample = () => {
    updateBad(() => [SAMPLE_MELANO]);
    const now = currentTime();
    updateUsable((prev) => {
      const kept = prev.filter((e) => e.product.id !== SAMPLE_MELANO.id);
      const samples = [SAMPLE_CUREL, SAMPLE_IHADA]
        .filter((p) => !kept.some((e) => e.product.id === p.id))
        .map((product): UsableEntry => ({ product, addedAt: now, inUse: true, sessionOnly: true }));
      return [...kept, ...samples].slice(0, MAX_USABLE);
    });
    showToast(`テストデータを読み込みました！「${DIFFERENTIAL_LABEL}」を押せます`);
  };

  const routineCount = badProducts.length + usable.length;
  const closeTray = () => {
    setIsTrayOpen(false);
    inputRef.current?.focus();
  };
  /** 入力欄から候補の最初のボタンへ（下矢印キー） */
  const focusTray = () => {
    // 閉じるボタンではなく、最初の候補（ブランドか製品のボタン）へ
    document.getElementById(SEARCH_TRAY_ID)?.querySelector<HTMLElement>('button:not([data-tray-close]), a[href]')?.focus();
  };

  return (
    // 同意を確かめるまで（サーバーで描いた直後を含む）は、画面を操作も読み上げもさせない（inert）
    <RegisteredProductsContext.Provider value={registeredProducts}>
    <div inert={consented !== true} className="flex flex-col h-dvh bg-surface text-ink font-sans">
      {/* 初めて開いたとき：利用規約・プライバシーポリシーと Cookie の使用への同意。
          inert の外に置く（inert の中のダイアログは押せない）。同意していないと分かるのはブラウザだけなので、document がある */}
      {consented === false && createPortal(<ConsentDialog />, document.body)}
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
          ? trayCandidates.length > 0
            ? `候補が${trayCandidates.length}件あります。下矢印キーで候補に移動できます。`
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

      {/* Top App Bar */}
      <header inert={isDrawerModal} className="h-14 shrink-0 bg-white border-b border-sand-200 pl-3 pr-1 sm:px-4 flex items-center justify-between gap-2 z-10">
        <div className="flex items-center gap-2 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element -- 小さな SVG のロゴ。画像最適化は不要 */}
          <img src="/icon.svg" alt="" width={36} height={36} className="w-9 h-9 shrink-0" />
          <div className="min-w-0">
            <h1 className="font-bold text-ink text-lg leading-tight tracking-tight truncate">コスメ探偵</h1>
            <p className="text-xs text-ink-muted hidden md:block truncate">
              化粧品選びの参考に、肌荒れの原因になりうる成分の候補を調べます
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <button
            ref={scanButtonRef}
            type="button"
            onClick={() => setIsScannerOpen(true)}
            aria-label="バーコード読取"
            className="min-h-12 min-w-12 flex items-center justify-center gap-2 sm:px-4 rounded-full text-ink hover:bg-surface-container sm:border sm:border-sage-600 sm:text-sage-700 sm:hover:bg-sage-50 text-sm font-semibold transition-colors"
          >
            <ScanBarcode className="w-6 h-6 sm:w-5 sm:h-5" aria-hidden />
            <span className="hidden sm:inline">バーコード読取</span>
          </button>

          <button
            ref={labelButtonRef}
            type="button"
            onClick={() => setIsLabelInputOpen(true)}
            aria-label="成分表示を入力"
            title="パッケージの成分表示を入力・撮影"
            className="min-h-12 min-w-12 flex items-center justify-center gap-2 sm:px-4 rounded-full text-ink hover:bg-surface-container sm:border sm:border-sand-300 text-sm font-semibold transition-colors"
          >
            <FileText className="w-6 h-6 sm:w-5 sm:h-5" aria-hidden />
            <span className="hidden sm:inline">成分表示を入力</span>
          </button>

          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            aria-expanded={isSidebarOpen}
            aria-controls="routine-drawer"
            // 開閉は aria-expanded で伝え、名前は変えない。数のバッジは見た目だけなので、名前に数を入れる
            aria-label={`マイルーティン（${routineCount}点${
              staleIds.size > 0 ? `、${STALE_AFTER_MONTHS}か月以上前に追加したコスメが${staleIds.size}点` : ''
            }）`}
            className="lg:hidden min-h-12 min-w-12 flex items-center justify-center text-ink rounded-full hover:bg-surface-container relative"
          >
            <Menu className="w-6 h-6" aria-hidden />
            {routineCount > 0 && (
              <span
                aria-hidden
                className={`absolute top-1.5 right-1.5 min-w-5 h-5 px-1 rounded-full text-xs font-semibold text-white flex items-center justify-center ${
                  staleIds.size > 0 ? 'bg-orange-700' : 'bg-rose-600'
                }`}
              >
                {routineCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat Stream Section */}
        <main ref={mainRef} tabIndex={-1} inert={isDrawerModal} className="flex-1 flex flex-col min-w-0 bg-surface focus:outline-hidden">
          {/* スマホ：登録状況とマイルーティン（引き出し）を開くボタン。肌荒れしたコスメがあれば、ここから差分分析も始められる */}
          <div className="lg:hidden px-3 pt-3">
            <div className="max-w-[720px] mx-auto bg-white rounded-xl border border-sand-200 shadow-xs">
            <div className="pl-3 pr-1 py-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-full bg-tint-safe text-emerald-700 flex items-center justify-center shrink-0">
                  <ClipboardList className="w-[18px] h-[18px]" aria-hidden />
                </div>
                <p className="text-xs text-ink-muted truncate">
                  肌荒れ {badProducts.length}点 / 使えている {usable.length}点
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                aria-controls="routine-drawer"
                aria-expanded={isSidebarOpen}
                className="min-h-12 pl-3 pr-2 rounded-lg text-sage-700 hover:bg-surface-container text-sm font-semibold flex items-center gap-0.5 shrink-0"
              >
                マイルーティン
                <ChevronRight className="w-4 h-4" aria-hidden />
              </button>
            </div>
            {badProducts.length > 0 && (
              <div className="px-2 pb-2">
                <button
                  type="button"
                  onClick={requestDifferential}
                  aria-disabled={isLoading || undefined}
                  className={`w-full min-h-12 px-4 bg-primary hover:bg-primary-active text-on-primary rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${busyLook}`}
                >
                  <Sparkles className="w-5 h-5" aria-hidden />
                  <span>{DIFFERENTIAL_LABEL}</span>
                </button>
              </div>
            )}
            </div>
          </div>

          {/* 3か月以上前に追加した、今も使っている「使えるコスメ」の確認（今も使っている・もう使っていない・削除で消える） */}
          {/* ステータスの入れ物は常に置く（中身ごと作ると読み上げられないことがある） */}
          <div role="status">
          {staleEntries.length > 0 && (
            <div className="mx-3 sm:mx-6 mt-3 px-3 py-2 bg-orange-50 rounded-xl border border-orange-200 text-xs text-orange-900 flex items-center gap-2">
              <CalendarClock className="w-4 h-4 shrink-0 text-orange-600" aria-hidden />
              <p className="flex-1 min-w-0 break-words">
                「使えるコスメ」に、{STALE_AFTER_MONTHS}か月以上前に追加した、今も使っているものがあります（
                {staleEntries.slice(0, 3).map((e) => e.product.name).join('、')}
                {staleEntries.length > 3 && ` ほか${staleEntries.length - 3}点`}
                ）。今も使っているか確かめてください。
              </p>
              <button
                type="button"
                onClick={() => {
                  setIsSidebarOpen(true);
                  // 使えるコスメはリストの下のほうにあるので、開いたら（閉じるボタンにフォーカスが移ったあとで）
                  // 見出しへフォーカスと表示を送る
                  requestAnimationFrame(() => {
                    const section = document.getElementById(USABLE_SECTION_ID);
                    section?.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
                    section?.scrollIntoView({ block: 'start', inline: 'nearest' });
                  });
                }}
                aria-label="使えるコスメを確認する"
                className="lg:hidden shrink-0 min-h-12 px-3 bg-white hover:bg-orange-100 border border-orange-300 rounded-lg text-sm font-semibold"
              >
                確認する
              </button>
            </div>
          )}
          </div>

          {/* Messages Scroll Area */}
          {/* relative：読み上げ用の sr-only（position: absolute）をこの中に収める。無いとページ全体が伸び、
              カードにフォーカスしたときにチャットではなくページがスクロールして画面が空になる */}
          <div className="relative flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:p-6 space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
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
                      onSelectToAnalyze={handleSelectProductToAnalyze}
                      onAddToBad={handleAddToBad}
                      onAddToUsable={handleAddToUsable}
                      isAlternatives={msg.suggestionKind === 'alternatives'}
                      credits={msg.alternativeCredits}
                      busy={isLoading}
                    />
                  )}

                  {/* Single Product Analysis Card */}
                  {msg.singleAnalysis && (
                    <IngredientAnalysisCard
                      analysis={msg.singleAnalysis}
                      onAddToBadRoutine={() => handleAddToBad(msg.singleAnalysis!.product)}
                      onAddToUsableRoutine={() => handleAddToUsable(msg.singleAnalysis!.product)}
                      onFindAlternatives={() => void handleFindAlternatives(msg.singleAnalysis!.product)}
                      onPriceLookup={handleAlternativePriceLookup}
                      busy={isLoading}
                    />
                  )}

                  {/* Differential Culprit Card with Amazon safe recommendations */}
                  {msg.differentialAnalysis && (
                    <DifferentialResultCard result={msg.differentialAnalysis} onPriceLookup={handleAlternativePriceLookup} busy={isLoading} />
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
                            onClick={() => handleQuickReply(qr, msg)}
                            // 応答待ち・調べ済みでもフォーカスを失わないよう disabled にはせず、押したら案内を出す。
                            // 文字は薄くしない（押せるボタンなので、文字のコントラストを保つ）
                            aria-disabled={isLoading || used || undefined}
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
                  onClick={() => {
                    abortRequest();
                    // 押したボタンは止まると消えるので、入力欄へ移す
                    inputRef.current?.focus();
                  }}
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

          {/* Input Form Bar */}
          <div className="px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 bg-surface">
            {/* 候補のトレイは見た目は入力欄の上、Tab の順番は入力欄の後（DOM は入力欄が先） */}
            <div className="max-w-[720px] mx-auto flex flex-col">
              {/* 上限の案内は、候補のトレイ（order-first）の下・入力欄のすぐ上 */}
              {spendLimit && <SpendLimitNotice reason={spendLimit.reason} onDismiss={dismissSpendLimit} />}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="min-h-[52px] p-0.5 flex items-center gap-1 bg-white border-[1.5px] border-outline rounded-full shadow-sm focus-within:border-primary focus-within:outline focus-within:outline-1 focus-within:outline-primary"
              >
                <button
                  type="button"
                  onClick={() => setIsScannerOpen(true)}
                  aria-label="バーコードをカメラでスキャン"
                  title="バーコードをカメラでスキャン"
                  className="w-12 h-12 flex items-center justify-center text-sage-700 bg-surface-container-low hover:bg-surface-container-high rounded-full transition-colors shrink-0"
                >
                  <Camera className="w-6 h-6" aria-hidden />
                </button>

                <input
                  ref={inputRef}
                  id="chat-input"
                  type="text"
                  value={input}
                  // 候補の有無は上のステータスが読み上げる（テキストボックスに aria-expanded は付けられない）
                  aria-controls={SEARCH_TRAY_ID}
                  onKeyDown={(e) => {
                    // 下矢印で候補へ、Escape で候補を閉じる（入力はそのまま）
                    // 日本語入力の確定中は使わない（Safari は確定のキーで isComposing が false なので keyCode 229 も見る）
                    if (!isTrayVisible || e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      focusTray();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setIsTrayOpen(false);
                    }
                  }}
                  onChange={(e) => {
                    const value = e.target.value;
                    setInput(value);
                    // 入力を消したら前の検索候補を破棄する（次の入力で古い候補が一瞬表示されないように）
                    if (!value.trim()) clearCandidates();
                  }}
                  aria-label="コスメ名を入力"
                  placeholder="コスメ名を入力 (例: ちふれ リップ, キュレル泡洗顔, アヌア, メラノCC...)"
                  className="flex-1 min-w-0 h-12 px-2 text-sm bg-transparent focus:outline-hidden text-ink placeholder:text-gray-500 truncate"
                />

                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  aria-label="送信"
                  className="w-12 h-12 flex items-center justify-center bg-primary hover:bg-primary-active disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed text-on-primary rounded-full transition-colors shrink-0"
                >
                  <Send className="w-5 h-5" aria-hidden />
                </button>
              </form>
              <div className="order-first">
              <LiveSearchCandidateTray
                id={SEARCH_TRAY_ID}
                busy={isLoading}
                query={input}
                candidates={trayCandidates}
                brands={liveBrands}
                credits={trayCredits}
                onSelectBrand={(brand) => {
                  // ブランド名を入れて続けて入力できるようにする（候補はそのブランドの製品に絞り込まれる）
                  setInput(`${brand} `);
                  inputRef.current?.focus();
                }}
                isOpen={isTrayVisible}
                onClose={closeTray}
                onSelectProduct={(product) => {
                  // 応答待ちなら、入力と候補を残したまま案内する（選んだ製品を黙って捨てない）
                  if (isBusy()) {
                    showToast(WAIT_MESSAGE, 'error');
                    return;
                  }
                  // キーボードで候補を選んだときは、消える候補から入力欄へフォーカスを戻す
                  const fromTray = !!document.activeElement?.closest(`#${SEARCH_TRAY_ID}`);
                  setIsTrayOpen(false);
                  setInput('');
                  if (fromTray) inputRef.current?.focus();
                  handleSelectProductToAnalyze(product);
                }}
                onAddToBad={(product) => {
                  handleAddToBad(product);
                }}
                onAddToUsable={(product) => {
                  handleAddToUsable(product);
                }}
              />
              </div>
              <LegalLinks className="justify-center -mb-2" />
            </div>
          </div>
        </main>

        {/* スマホ：モーダルの引き出し（不透明な面 + 40% のスクリム）。デスクトップ：右の固定サイドバー */}
        {isSidebarOpen && (
          <div aria-hidden className="fixed inset-0 z-40 bg-gray-900/40 lg:hidden" onClick={closeSidebar} />
        )}
        <div
          id="routine-drawer"
          role={isDrawerModal ? 'dialog' : undefined}
          aria-modal={isDrawerModal || undefined}
          aria-labelledby={isDrawerModal ? 'routine-drawer-title' : undefined}
          // 開くときは即座に表示（閉じるボタンにフォーカスできるように）、閉じるときはスライドし終えてから隠す
          className={`fixed inset-y-0 right-0 z-50 w-full max-w-[420px] shadow-2xl duration-300 lg:static lg:z-auto lg:w-80 lg:max-w-none lg:shadow-none lg:translate-x-0 lg:visible motion-reduce:transition-none ${
            isSidebarOpen ? 'translate-x-0 transition-[translate]' : 'translate-x-full invisible transition-[translate,visibility]'
          }`}
        >
          <RoutineSidebar
            badProducts={badProducts}
            usable={usable}
            onClose={closeSidebar}
            closeButtonRef={drawerCloseRef}
            staleIds={staleIds}
            onRemoveBad={handleRemoveBad}
            onRemoveUsable={handleRemoveUsable}
            onConfirmUsable={handleConfirmUsable}
            onSetInUse={handleSetInUse}
            onClearBad={() => setClearTarget('bad')}
            onClearUsable={() => setClearTarget('usable')}
            busy={isLoading}
            onCheckCurrentUse={() => {
              // 応答待ちなら引き出しを閉じずに案内する（閉じてから断ると、何が起きたか分からない）
              if (isBusy()) return showToast(WAIT_MESSAGE, 'error');
              closeSidebar();
              handleCheckCurrentUse();
            }}
            onRunDifferential={() => {
              if (isBusy()) return showToast(WAIT_MESSAGE, 'error');
              closeSidebar();
              handleRunDifferential();
            }}
            onLoadSample={handleLoadSample}
            onExportImage={handleExportImage}
            onImportImage={(file) => void handleImportImage(file)}
          />
        </div>
      </div>

      {/* Barcode Scanner Modal */}
      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        fallbackFocus={() => scanButtonRef.current}
        onScanSuccess={(barcode) => {
          // 応答待ちならスキャナーを開いたまま理由を出す（読めたバーコードを黙って捨てない）
          // コスメ探偵のマイルーティンの QR コードなら、読み込むか確かめる
          const fragment = shareFragment(barcode);
          if (fragment) {
            setIsScannerOpen(false);
            void importFromFragment(fragment);
            return true;
          }
          if (isBusy()) return WAIT_MESSAGE;
          // 化粧品の JAN/EAN/UPC（8〜14桁の数字）だけ。ほかの QR コード（URL など）は送らない
          const digits = barcode.normalize('NFKC').replace(/[\s-]/g, '');
          if (!/^\d{8,14}$/.test(digits)) {
            return '化粧品のバーコード（8〜14桁の数字）ではありません。商品のJANバーコードを読み取ってください。';
          }
          void handleBarcodeScanned(digits);
          return true;
        }}
      />

      <LabelInputModal
        isOpen={isLabelInputOpen}
        onClose={() => setIsLabelInputOpen(false)}
        onSubmit={handleLabelSubmit}
        fallbackFocus={() => labelButtonRef.current}
      />

      {routineExport && (
        <RoutineExportDialog
          snapshot={routineExport.snapshot}
          culprits={routineExport.culprits}
          onClose={() => setRoutineExport(null)}
          fallbackFocus={() => menuButtonRef.current}
        />
      )}
      {/* 共有されたルーティンの読み込み（#r=…）は、同意するまで出さない（同意の画面の上に重ねない） */}
      {consented === true && routineImport && (
        <RoutineImportDialog
          snapshot={routineImport.snapshot}
          namesOnly={routineImport.namesOnly}
          hasCurrentLists={routineCount > 0}
          typedLabelsLost={[...badProducts, ...usable.map((e) => e.product)].filter((p) => !isPersistable(p)).length}
          onImport={applyImport}
          onClose={() => setRoutineImport(null)}
          fallbackFocus={() => menuButtonRef.current}
        />
      )}
      {/* もう一方のリストにある製品を登録しようとした：移すか、そのリストから削除するか（1つの製品は1つのリストだけ） */}
      {listConflict && (
        <ChoiceDialog
          title={listConflict.target === 'bad' ? '使えるコスメに登録されています' : '肌荒れしたコスメに登録されています'}
          message={
            listConflict.target === 'bad'
              ? `「${listConflict.product.name}」は【使えるコスメ】に登録されています。1つのコスメは、どちらか1つのリストにだけ登録できます。`
              : `「${listConflict.product.name}」は【肌荒れしたコスメ】に登録されています。1つのコスメは、どちらか1つのリストにだけ登録できます。`
          }
          choices={[
            {
              label: listConflict.target === 'bad' ? '肌荒れしたコスメに移す' : '使えるコスメに移す',
              tone: 'primary',
              onSelect: () => moveToList(listConflict.product, listConflict.target),
            },
            {
              label: listConflict.target === 'bad' ? '使えるコスメから削除' : '肌荒れしたコスメから削除',
              tone: 'secondary',
              onSelect: () => removeFromOtherList(listConflict.product, listConflict.target),
            },
          ]}
          onCancel={() => setListConflict(null)}
          fallbackFocus={() => inputRef.current}
        />
      )}
      {/* リストのクリア（元に戻せないので確かめる） */}
      {clearTarget && (
        <ChoiceDialog
          warning
          title={clearTarget === 'bad' ? '肌荒れしたコスメのリストをクリア' : '使えるコスメのリストをクリア'}
          message={
            clearTarget === 'bad'
              ? `肌荒れしたコスメ（${badProducts.length}点）をリストから削除します。元に戻せません。`
              : `使えるコスメ（${usable.length}点）をリストから削除します。この端末に保存したリストも消え、元に戻せません。`
          }
          choices={[{ label: 'クリアする', tone: 'danger', onSelect: () => clearList(clearTarget) }]}
          onCancel={() => setClearTarget(null)}
          // クリアするとボタンが消えるので、そのリストの見出しへ（引き出しの中。メニューボタンは引き出しの間は押せない）
          fallbackFocus={() =>
            document.getElementById(clearTarget === 'bad' ? BAD_SECTION_ID : USABLE_SECTION_ID)?.querySelector<HTMLElement>('h3') ?? null
          }
        />
      )}
      {/* 比較の結果のあとに1回：リストを画像で保存しませんか？ */}
      {isExportReminderOpen && (
        <ExportReminderDialog
          onExport={(dontShowAgain) => {
            if (dontShowAgain) turnOffExportReminder();
            setIsExportReminderOpen(false);
            handleExportImage();
          }}
          onLater={(dontShowAgain) => {
            if (dontShowAgain) turnOffExportReminder();
            setIsExportReminderOpen(false);
          }}
          fallbackFocus={() => inputRef.current}
        />
      )}
      {/* 画像の QR コードを読むときに html5-qrcode が使う（画面には出さない） */}
      <div id={ROUTINE_QR_READER_ID} hidden />
    </div>
    </RegisteredProductsContext.Provider>
  );
};
