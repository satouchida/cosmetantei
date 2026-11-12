import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { ChatMessage, Product, UserRoutineState } from '@/lib/types';
import { productLabel } from '@/lib/display-brand';
import { ChatResponse, postChat } from '@/lib/client/chat-request';
import type { UsableEntry } from '@/lib/usable-products';
import type { LabelInput } from '../label/LabelInputModal';
import {
  alternativesOf,
  announcementOf,
  DEFAULT_LOADING_TEXT,
  LONG_WAIT_NOTE,
  messageMeta,
  pickReply,
  RETRY_LABEL,
  retryable,
  STILL_WORKING_AFTER_MS,
  WAIT_MESSAGE,
} from './chat-helpers';
import { dispatchQuickReply } from './quick-reply-dispatch';
import type { AddResult, ShowToast } from './useRoutineLists';

/** useChatRequests が使う、ほかのフック・ChatContainer の値と処理 */
export interface ChatRequestDeps {
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  inputRef: RefObject<HTMLInputElement | null>;
  showToast: ShowToast;
  /** 候補トレイ（useTypeahead） */
  setIsTrayOpen: (open: boolean) => void;
  skipSearchFor: (text: string) => void;
  setIsScannerOpen: (open: boolean) => void;
  setIsLabelInputOpen: (open: boolean) => void;
  /** 2つのリスト（useRoutineLists） */
  routine: UserRoutineState;
  usable: UsableEntry[];
  staleEntries: UsableEntry[];
  handleAddToBad: (product: Product) => AddResult;
  handleAddToUsable: (product: Product) => AddResult;
  updateBad: (change: (prev: Product[]) => Product[]) => void;
  /** 比較の結果のあとの「リストを画像で保存しませんか？」（useRoutineTransfer） */
  offerExportAfterResult: () => void;
}

/** サーバーに頼む操作（送信・バーコード・成分表示・比較・組み合わせ・価格・代わりの商品）と、クイック返信ボタン */
export function useChatRequests(deps: ChatRequestDeps) {
  const {
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
  } = deps;
  const [isLoading, setIsLoading] = useState(false);
  // 一度押した有料の調べもののボタン（吹き出しの id と文言）。同じ吹き出しで何度も調べない
  const [usedActions, setUsedActions] = useState<ReadonlySet<string>>(new Set());
  // 失敗した頼みごと（「もう一度送る」で同じ内容を送る）。失敗の吹き出しの id ごと
  const retryRef = useRef(new Map<string, () => Promise<unknown>>());
  // 応答を待っている要求（「中止」で止める）
  const abortRef = useRef<AbortController | null>(null);
  // サーバーに頼む操作は1つずつ。再描画を待たずに判定するため ref（2回押しで有料の調べものを2回しない・返信の順序を保つ）
  const busyRef = useRef(false);
  // いまの比較リスト（「もう一度送る」で、失敗したときではなく今のリストを送る）
  const routineRef = useRef<UserRoutineState | null>(null);
  const [loadingText, setLoadingText] = useState(DEFAULT_LOADING_TEXT);
  // 読み上げ用：返答が届いた・失敗した（ライブリージョンは常に置き、中身だけ替える）
  const [announcement, setAnnouncement] = useState('');
  const [alertText, setAlertText] = useState('');
  useEffect(() => {
    routineRef.current = routine;
  });

  /** サーバーの応答を待っているか（待っている間はほかの頼みごとを受け付けない） */
  const isBusy = () => busyRef.current;
  /** 応答を待っている要求を止める（「中止」） */
  const abortRequest = () => abortRef.current?.abort();

  /**
   * サーバーに頼む操作の共通の流れ：利用者の吹き出し → 返答の吹き出し（失敗ならサーバーの文か決まった文）。
   * 応答待ちの間は受け付けず、案内を出して null を返す
   */
  const runChatAction = async (
    userContent: string,
    body: Record<string, unknown>,
    toMessage: (data: ChatResponse) => Partial<ChatMessage>,
    options: {
      loadingText?: string;
      /** 失敗の吹き出しを変える（状態コードごとの案内・入力し直しのボタン） */
      failure?: (result: { status: number | null; message: string }) => Partial<ChatMessage>;
    } = {}
  ): Promise<ChatResponse | null> => {
    if (busyRef.current) {
      showToast(WAIT_MESSAGE, 'error');
      return null;
    }
    busyRef.current = true;
    const loading = options.loadingText ?? DEFAULT_LOADING_TEXT;
    setLoadingText(loading);
    setIsLoading(true);
    setAnnouncement(loading);
    setAlertText('');
    setMessages((prev) => [...prev, { ...messageMeta('user'), role: 'user', content: userContent }]);
    const controller = new AbortController();
    abortRef.current = controller;
    // 長くかかるときは、まだ調べていることを伝える（止めたいときは「中止」）
    const stillWorking = setTimeout(() => {
      const text = 'まだ調べています。もう少しお待ちください（止めるときは「中止」）';
      setLoadingText(text);
      setAnnouncement(text);
    }, STILL_WORKING_AFTER_MS);
    try {
      const result = await postChat(body, controller.signal);
      if (result.ok) {
        const reply: ChatMessage = { ...messageMeta('bot'), role: 'assistant', content: result.data.reply, ...toMessage(result.data) };
        setMessages((prev) => [...prev, reply]);
        setAnnouncement(announcementOf(reply.content));
        if (reply.differentialAnalysis) offerExportAfterResult();
        return result.data;
      }
      const custom = options.failure?.(result);
      const failure: ChatMessage = {
        ...messageMeta('err'),
        role: 'assistant',
        content: result.message,
        isError: true,
        ...custom,
        // 頼み直して結果が変わりうる失敗（通信・時間切れ・中止・サーバーの問題）だけ、同じ頼みごとをもう一度送れるようにする。
        // 入力の誤り（400 等）・回数の制限（429。すぐ頼み直しても同じ）には出さない
        quickReplies: [...(retryable(result.status) ? [RETRY_LABEL] : []), ...(custom?.quickReplies ?? [])],
      };
      if (retryable(result.status)) {
        // 比較リストを送る頼みごとは、失敗したときではなく、押したときのリストで送る
        retryRef.current.set(failure.id, () =>
          runChatAction(userContent, 'routine' in body && routineRef.current ? { ...body, routine: routineRef.current } : body, toMessage, options)
        );
      }
      setMessages((prev) => [...prev, failure]);
      setAnnouncement('');
      setAlertText(failure.content);
      return null;
    } finally {
      clearTimeout(stillWorking);
      abortRef.current = null;
      busyRef.current = false;
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const messageText = (textToSend || input).trim();
    if (!messageText) return;
    if (busyRef.current) {
      showToast(WAIT_MESSAGE, 'error');
      return;
    }
    setInput('');
    setIsTrayOpen(false);
    const data = await runChatAction(
      messageText,
      { message: messageText, routine },
      (data) => ({
        ...pickReply(data, ['productSuggestions', 'singleAnalysis', 'differentialAnalysis', 'priceResult', 'quickReplies']),
        ...alternativesOf(data),
      }),
      { loadingText: `調べています${LONG_WAIT_NOTE}...` }
    );
    // 入力して送れなかったときは、その文を入力欄に戻す（その間に何か入力していれば、そのまま）。
    // ボタンの文は戻さない（入力していない文を入力欄に入れない）
    if (!data && !textToSend) {
      setInput((current) => {
        if (current) return current;
        skipSearchFor(messageText);
        return messageText;
      });
    }
    // 入力して送ったときは入力欄に戻す（送信ボタンが無効になってフォーカスが失われないように）
    if (!textToSend) inputRef.current?.focus();
  };

  const handleBarcodeScanned = async (barcode: string) => {
    setIsScannerOpen(false);
    await runChatAction(
      `📷 バーコード（${barcode}）をスキャンしました`,
      { action: 'barcode_lookup', barcode, routine },
      (data) => pickReply(data, ['singleAnalysis', 'quickReplies']),
      { loadingText: `バーコードの商品を調べています${LONG_WAIT_NOTE}...` }
    );
  };

  /**
   * お店の商品検索の製品の成分を調べる。サーバーは JAN コードがあればまずバーコードで調べ（見つかれば分析）、
   * 無ければ・見つからなければ商品名で調べて、見つかった製品を候補として出す
   */
  const lookupShopProduct = async (product: Product) => {
    await runChatAction(
      `「${product.name}」の成分を詳しく知りたい`,
      { action: 'lookup_product', selectedProduct: product },
      (data) => pickReply(data, ['singleAnalysis', 'productSuggestions', 'quickReplies']),
      { loadingText: 'Webで成分を調べています（1分ほどかかることがあります）...' }
    );
  };

  /** 成分が分からなかった商品を、ブランド名と商品名で Web で調べ直す。全成分が見つかった製品を候補として出す */
  const handleResearchProduct = async (label: string, product: Product) => {
    await runChatAction(
      label,
      { action: 'research_product', selectedProduct: product },
      (data) => pickReply(data, ['productSuggestions', 'quickReplies']),
      { loadingText: 'Webで成分を調べています（1分ほどかかることがあります）...' }
    );
  };

  /**
   * 分析した商品と同じ種類で、原因候補の成分を含まない商品を探す（分析カードのボタン）。
   * お店の商品検索で探し、成分を確かめた商品だけを出す（サーバーは種類の名前と決まった語だけでお店を検索する）
   */
  const handleFindAlternatives = async (product: Product) => {
    await runChatAction(
      `「${product.name}」と同じ種類で、原因候補の成分を含まない商品を探したい`,
      { action: 'find_alternatives', selectedProduct: product },
      (data) => ({ ...pickReply(data, ['productSuggestions', 'quickReplies']), ...alternativesOf(data) }),
      { loadingText: `代わりの商品を探しています${LONG_WAIT_NOTE}...` }
    );
  };

  /** 分析した商品の販売価格を調べる（サーバーはブランド名と商品名だけで検索する） */
  const handlePriceLookup = async (label: string, product: Product) => {
    await runChatAction(
      label,
      { action: 'price_lookup', selectedProduct: product },
      (data) => pickReply(data, ['priceResult', 'quickReplies']),
      { loadingText: '販売価格を調べています...' }
    );
  };

  /** 代わりの商品のカードの「価格を比べる」 */
  const handleAlternativePriceLookup = (product: Product) =>
    void handlePriceLookup(`💴 「${product.name}」の価格を調べる`, product);

  /** 入力された成分表示を分析する（サーバーはパーサーと成分DBだけで分析し、保存しない） */
  const handleLabelSubmit = async (label: LabelInput): Promise<boolean | string> => {
    // 前の応答を待っている間は受け付けない（返信の順序が入れ替わらないように）。理由は入力の画面に出す
    if (busyRef.current) return WAIT_MESSAGE;
    setIsLabelInputOpen(false);
    const data = await runChatAction(
      `📝 成分表示を入力しました${label.name ? `（${label.name}）` : ''}`,
      { action: 'analyze_label', label, routine },
      (reply) => pickReply(reply, ['singleAnalysis', 'quickReplies']),
      {
        // 入力した成分表示は入力欄に残っているので、開き直してやり直せる
        failure: (result) => ({
          content: `${result.message}\n\n入力した成分表示は残っているので、開き直してもう一度お試しください。`,
          quickReplies: ['📝 成分表示を入力する'],
        }),
      }
    );
    return !!data?.singleAnalysis;
  };

  const handleSelectProductToAnalyze = async (product: Product) => {
    // お店の商品検索の製品は成分が分からない。サーバーがバーコード、商品名の順に調べる
    if (product.id.startsWith('shop_')) {
      await lookupShopProduct(product);
      return;
    }
    await runChatAction(
      `「${productLabel(product)}」の成分を詳しく知りたい`,
      { action: 'analyze_single', selectedProduct: product, routine },
      (data) => pickReply(data, ['singleAnalysis', 'quickReplies'])
    );
  };

  const appendLocalExchange = (label: string, reply: string, quickReplies?: string[]) => {
    setMessages((prev) => [
      ...prev,
      { ...messageMeta('user-quick'), role: 'user', content: label },
      { ...messageMeta('bot-local'), role: 'assistant', content: reply, quickReplies },
    ]);
  };

  /** クイック返信ボタンの処理（どのボタンで何をするかは quick-reply-dispatch.ts） */
  const handleQuickReply = (label: string, sourceMessage: ChatMessage) =>
    dispatchQuickReply(label, sourceMessage, {
      openScanner: () => setIsScannerOpen(true),
      openLabelInput: () => setIsLabelInputOpen(true),
      isBusy,
      showToast,
      isUsed: (usedKey) => usedActions.has(usedKey),
      markUsed: (usedKey) => setUsedActions((prev) => new Set(prev).add(usedKey)),
      takeRetry: (messageId) => {
        const retry = retryRef.current.get(messageId);
        retryRef.current.delete(messageId);
        return retry;
      },
      sendMessage: (text) => void handleSendMessage(text),
      addToBad: handleAddToBad,
      addToUsable: handleAddToUsable,
      priceLookup: (label, product) => void handlePriceLookup(label, product),
      researchProduct: (label, product) => void handleResearchProduct(label, product),
      clearBad: () => updateBad(() => []),
      appendLocalExchange,
      focusInput: () => inputRef.current?.focus(),
    });

  const handleRunDifferential = async () => {
    if (routine.badProducts.length === 0) return;
    await runChatAction(
      `⚡️ 肌荒れコスメ（${routine.badProducts.map((p) => p.name).join('、')}）の、原因になりうる成分の候補を絞り込んでください`,
      { action: 'differential', routine },
      (data) => pickReply(data, ['differentialAnalysis', 'quickReplies']),
      { loadingText: '原因候補の成分を絞り込んでいます...' }
    );
  };

  /** 画面のボタンから差分分析を始める（応答待ちなら案内だけ出す） */
  const requestDifferential = () => {
    if (busyRef.current) return showToast(WAIT_MESSAGE, 'error');
    void handleRunDifferential();
  };

  /** 使えるコスメのうち、今も使っているものの組み合わせを調べる（サーバーはルールだけで判定する） */
  const handleCheckCurrentUse = async () => {
    const inUse = usable.filter((e) => e.inUse);
    if (inUse.length < 2) return;
    // 送った時点の、3か月以上前に追加した製品（結果のカードで確かめてもらう）
    const staleProductNames = staleEntries.map((e) => e.product.name);
    await runChatAction(
      `🧴 今使っているコスメ（${inUse.map((e) => e.product.name).join('、')}）の組み合わせを調べてください`,
      // 比較リストは使わないので送らない
      {
        action: 'check_current_use',
        routine: { badProducts: [], safeProducts: [], currentlyUsing: routine.currentlyUsing },
      },
      (data) => {
        const check = data.currentUseCheck as ChatMessage['currentUseCheck'];
        return {
          ...pickReply(data, ['quickReplies']),
          currentUseCheck: check && { ...check, ...(staleProductNames.length > 0 && { staleProductNames }) },
        };
      },
      {
        loadingText: '組み合わせを確かめています...',
        failure: (result) =>
          result.status === 400
            ? {
                content:
                  '「使えるコスメ」の内容を確認できませんでした。最近追加したコスメをいったん削除して、追加し直してください。',
              }
            : {},
      }
    );
  };

  return {
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
  };
}
