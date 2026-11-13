'use client';

import React, { useState, useRef, useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ChatMessage, Product } from '@/lib/types';
import { DIFFERENTIAL_LABEL, RoutineSidebar } from '../routine/RoutineSidebar';
import { MAX_USABLE, updateUsable, UsableEntry } from '@/lib/usable-products';
import { shareFragment } from '@/lib/routine-share';
import {
  getSpendLimitServerSnapshot,
  getSpendLimitSnapshot,
  subscribeSpendLimit,
} from '@/lib/client/spend-limit-store';
import { ConsentDialog } from '@/components/legal/ConsentDialog';
import { getConsentServerSnapshot, hasConsented, subscribeConsent } from '@/lib/consent';
import { RegisteredProductsContext } from './RegisteredProducts';
import { useRoutineLists } from './useRoutineLists';
import { useRoutineTransfer } from './useRoutineTransfer';
import { useTypeahead } from './useTypeahead';
import { usePageChrome } from './usePageChrome';
import { useChatRequests } from './useChatRequests';
import { ChatLiveRegions } from './ChatLiveRegions';
import { ChatHeader } from './ChatHeader';
import { RoutineSummaryBar } from './RoutineSummaryBar';
import { MessageList } from './MessageList';
import { ChatInputBar } from './ChatInputBar';
import { ChatDialogs } from './ChatDialogs';
import { currentTime, SAMPLE_CUREL, SAMPLE_IHADA, SAMPLE_MELANO, SEARCH_TRAY_ID, WAIT_MESSAGE } from './chat-helpers';

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
  const lists = useRoutineLists({ showToast });
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
    clearTarget,
    setClearTarget,
    handleAddToBad,
    handleAddToUsable,
    handleRemoveUsable,
    handleConfirmUsable,
    handleSetInUse,
    handleRemoveBad,
  } = lists;
  // 有料の呼び出しが上限で断られたときの案内（apiFetch が応答のヘッダーを見て出す）
  const spendLimit = useSyncExternalStore(subscribeSpendLimit, getSpendLimitSnapshot, getSpendLimitServerSnapshot);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  // スマホの引き出しの中のボタンから開いたダイアログを閉じたときの、フォーカスの戻り先（ヘッダーのボタン）
  const scanButtonRef = useRef<HTMLButtonElement | null>(null);
  const labelButtonRef = useRef<HTMLButtonElement | null>(null);

  // 画像での保存・読み込みと、比較の結果のあとの「リストを画像で保存しませんか？」（useRoutineTransfer.ts）
  const transfer = useRoutineTransfer({
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
  const { offerExportAfterResult, handleExportImage, handleImportImage, importFromFragment } = transfer;

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

  /** スキャナーで読めたとき（true で閉じる。文字列は理由として出し、開いたままにする） */
  const handleScanSuccess = (barcode: string): true | string => {
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
  };

  /** 候補のトレイで製品を選んだ */
  const handleSelectTrayProduct = (product: Product) => {
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
  };

  return (
    // 同意を確かめるまで（サーバーで描いた直後を含む）は、画面を操作も読み上げもさせない（inert）
    <RegisteredProductsContext.Provider value={registeredProducts}>
    <div inert={consented !== true} className="flex flex-col h-dvh bg-surface text-ink font-sans">
      {/* 初めて開いたとき：利用規約・プライバシーポリシーと Cookie の使用への同意。
          inert の外に置く（inert の中のダイアログは押せない）。同意していないと分かるのはブラウザだけなので、document がある */}
      {consented === false && createPortal(<ConsentDialog />, document.body)}
      <ChatLiveRegions
        toastMessage={toastMessage}
        toastKind={toastKind}
        isDrawerModal={isDrawerModal}
        isTrayVisible={isTrayVisible}
        trayCandidateCount={trayCandidates.length}
        announcement={announcement}
        alertText={alertText}
      />

      <ChatHeader
        scanButtonRef={scanButtonRef}
        labelButtonRef={labelButtonRef}
        menuButtonRef={menuButtonRef}
        isDrawerModal={isDrawerModal}
        isSidebarOpen={isSidebarOpen}
        routineCount={routineCount}
        staleCount={staleIds.size}
        onOpenScanner={() => setIsScannerOpen(true)}
        onOpenLabelInput={() => setIsLabelInputOpen(true)}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat Stream Section */}
        <main ref={mainRef} tabIndex={-1} inert={isDrawerModal} className="flex-1 flex flex-col min-w-0 bg-surface focus:outline-hidden">
          <RoutineSummaryBar
            badCount={badProducts.length}
            usableCount={usable.length}
            isSidebarOpen={isSidebarOpen}
            onOpenSidebar={() => setIsSidebarOpen(true)}
            onRunDifferential={requestDifferential}
            busy={isLoading}
            staleEntries={staleEntries}
          />

          <MessageList
            messages={messages}
            isLoading={isLoading}
            loadingText={loadingText}
            usedActions={usedActions}
            actions={{
              onSelectToAnalyze: handleSelectProductToAnalyze,
              onAddToBad: handleAddToBad,
              onAddToUsable: handleAddToUsable,
              onFindAlternatives: handleFindAlternatives,
              onPriceLookup: handleAlternativePriceLookup,
              onQuickReply: handleQuickReply,
            }}
            onAbort={() => {
              abortRequest();
              // 押したボタンは止まると消えるので、入力欄へ移す
              inputRef.current?.focus();
            }}
            messagesEndRef={messagesEndRef}
          />

          <ChatInputBar
            input={input}
            setInput={setInput}
            inputRef={inputRef}
            busy={isLoading}
            spendLimit={spendLimit}
            onSubmit={() => void handleSendMessage()}
            onOpenScanner={() => setIsScannerOpen(true)}
            isTrayVisible={isTrayVisible}
            setIsTrayOpen={setIsTrayOpen}
            clearCandidates={clearCandidates}
            trayCandidates={trayCandidates}
            liveBrands={liveBrands}
            trayCredits={trayCredits}
            onSelectTrayProduct={handleSelectTrayProduct}
            onAddToBad={handleAddToBad}
            onAddToUsable={handleAddToUsable}
          />
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

      <ChatDialogs
        lists={lists}
        transfer={transfer}
        consented={consented}
        isScannerOpen={isScannerOpen}
        setIsScannerOpen={setIsScannerOpen}
        onScanSuccess={handleScanSuccess}
        isLabelInputOpen={isLabelInputOpen}
        setIsLabelInputOpen={setIsLabelInputOpen}
        onLabelSubmit={handleLabelSubmit}
        scanButtonRef={scanButtonRef}
        labelButtonRef={labelButtonRef}
        menuButtonRef={menuButtonRef}
        inputRef={inputRef}
      />
    </div>
    </RegisteredProductsContext.Provider>
  );
};
