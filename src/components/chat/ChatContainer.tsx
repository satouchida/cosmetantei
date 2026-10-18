'use client';

import React, { useState, useRef, useEffect, useSyncExternalStore } from 'react';
import {
  ChatMessage,
  Product,
  UserRoutineState,
  } from '@/lib/types';
import { ProductSuggestionCard } from './ProductSuggestionCard';
import { IngredientAnalysisCard } from './IngredientAnalysisCard';
import { DifferentialResultCard } from './DifferentialResultCard';
import { CurrentUseResultCard } from './CurrentUseResultCard';
import { PriceResultCard } from './PriceResultCard';
import { BarcodeScannerModal } from '../scanner/BarcodeScannerModal';
import { LabelInputModal, LabelInput } from '../label/LabelInputModal';
import { RoutineSidebar } from '../routine/RoutineSidebar';
import {
  Camera,
  Send,
  Bot,
  User,
  Menu,
  CheckCircle2,
  FileText,
  CalendarClock,
  ScanBarcode,
  ClipboardList,
} from 'lucide-react';
import { LiveSearchCandidateTray } from '../search/LiveSearchCandidateTray';
import { rankProducts } from '@/lib/search/product-match';
import { apiFetch } from '@/lib/client/api-fetch';
import { getQuickReplyAction, PICK_FROM_CARDS_HINT } from './quick-replies';
import {
  getCurrentUseServerSnapshot,
  getCurrentUseSnapshot,
  isPersistable,
  isStale,
  MAX_CURRENT_USE,
  STALE_AFTER_MONTHS,
  subscribeCurrentUse,
  updateCurrentUse,
} from '@/lib/current-use';

let messageSequence = 0;

/** 現在時刻（コンポーネント外の関数にして、描画中の不純な呼び出しとして扱われないようにする） */
function currentTime(): number {
  return Date.now();
}

/** メッセージの一意な ID とタイムスタンプ（同じミリ秒に複数作っても ID が重複しない） */
function messageMeta(prefix: string): { id: string; timestamp: number } {
  messageSequence += 1;
  const timestamp = currentTime();
  return { id: `${prefix}-${timestamp}-${messageSequence}`, timestamp };
}

/** Tailwind の lg（64rem）未満。rem で書き、ブラウザの文字サイズ設定が違っても CSS のブレークポイントと一致させる */
const MOBILE_QUERY = '(max-width: 63.999rem)';

export const ChatContainer: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-1',
      role: 'assistant',
      content: `🔍 こんにちは！肌荒れ成分特定サービス「コスメ探偵 (CosmeTantei)」です。\n\n今お使いの化粧品名（日本・韓国・アメリカ製品対応）を入力するか、パッケージのバーコード（JAN/UPC）をカメラで読み取ってください。\n\n「肌荒れしたコスメ」と「普段使える安全なコスメ」を比較して、肌荒れの原因成分（香料、エタノール、防腐剤、高濃度アクティブなど）をあぶり出し、その成分を含まない安心の代替アイテム（Amazonリンク付）をご提案します！`,
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
  const [isLoading, setIsLoading] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isLabelInputOpen, setIsLabelInputOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [liveCandidates, setLiveCandidates] = useState<Product[]>([]);
  const [liveBrands, setLiveBrands] = useState<{ name: string; kana?: string }[]>([]);
  // 検索語の先頭のブランドと残りの語（サーバーが判定）
  const [liveBrand, setLiveBrand] = useState<{ name: string; rest: string } | null>(null);
  // お店の商品検索で作ったブランドの製品一覧。このページを開いている間だけ持つ（サーバーには保存しない。楽天の規約）
  const [lineups, setLineups] = useState<Record<string, { products: Product[]; credits: ('rakuten' | 'yahoo')[] }>>({});
  const lineupRequested = useRef(new Set<string>());
  // 取れなかったブランドは、この時刻まで取り直さない（入力のたびに呼ばない）
  const lineupRetryAt = useRef(new Map<string, number>());
  // お店の製品の成分を調べている間は、もう一度押されても調べない（有料の Web リサーチを2回しない）
  const lookupRef = useRef(false);
  const [isTrayOpen, setIsTrayOpen] = useState(false);

  /** ブランドの製品一覧をお店の商品検索から1回だけ取る（同じブランドはこのページを開いている間は取り直さない） */
  const requestLineup = (brand: string) => {
    if (lineupRequested.current.has(brand)) return;
    if ((lineupRetryAt.current.get(brand) ?? 0) > Date.now()) return;
    lineupRequested.current.add(brand);
    const fail = () => {
      // 30秒たってから、このブランドが入力されたときにもう一度取る
      lineupRequested.current.delete(brand);
      lineupRetryAt.current.set(brand, Date.now() + 30_000);
    };
    apiFetch(`/api/products/lineup?brand=${encodeURIComponent(brand)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data || !Array.isArray(data.products)) {
          fail();
          return;
        }
        const credits = Array.isArray(data.credits) ? data.credits.filter((c: unknown) => c === 'rakuten' || c === 'yahoo') : [];
        setLineups((prev) => ({ ...prev, [brand]: { products: data.products, credits } }));
      })
      .catch(fail);
  };

  useEffect(() => {
    const trimmed = input.trim();
    // 入力が空のときは何もしない（候補トレイは描画側で入力が空なら非表示にする）
    if (!trimmed) return;

    // 高頻度API & Google検索への非同期問い合わせ（300msデバウンス）
    // 入力が変わったら前のリクエストを中断し、古い結果で新しい結果を上書きしないようにする
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/products/search?q=${encodeURIComponent(trimmed)}&limit=6`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
          // 入力が変わった後に届いた古い応答は使わない（古いブランドの一覧を取りに行かない）
          if (controller.signal.aborted) return;
          if (Array.isArray(data.results)) {
            // 0件のときも入れ替える（前の入力の候補を残さない）
            const brands = Array.isArray(data.brands) ? data.brands : [];
            setLiveCandidates(data.results);
            setLiveBrands(brands);
            const brand =
              data.brand && typeof data.brand.name === 'string' && typeof data.brand.rest === 'string' ? data.brand : null;
            setLiveBrand(brand);
            if (brand) requestLineup(brand.name);
            if (data.results.length > 0 || brands.length > 0 || brand) setIsTrayOpen(true);
          }
        }
      } catch {
        // 中断・オフライン時は表示中の候補を維持
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [input]);

  // 候補：保存済みの製品（サーバーの結果）の後に、お店の製品一覧を残りの語で絞り込んだもの
  const MAX_LINEUP_CANDIDATES = 12;
  const lineup = liveBrand ? lineups[liveBrand.name] : undefined;
  const lineupMatches = lineup
    ? (liveBrand!.rest ? rankProducts(lineup.products, liveBrand!.rest) : lineup.products)
        .filter((p) => !liveCandidates.some((c) => c.id === p.id))
        .slice(0, MAX_LINEUP_CANDIDATES)
    : [];
  const trayCandidates = [...liveCandidates, ...lineupMatches];
  const trayCredits = lineupMatches.length > 0 && lineup ? lineup.credits : [];

  // 比較リスト（このページを開いている間だけ）。今使っているコスメは currentUse に、追加した日つきで持つ
  const [comparison, setRoutine] = useState<Omit<UserRoutineState, 'currentlyUsing'>>({
    badProducts: [],
    safeProducts: [],
  });
  // 今使っているコスメはこの端末のブラウザに保存する（src/lib/current-use.ts）
  const currentUse = useSyncExternalStore(subscribeCurrentUse, getCurrentUseSnapshot, getCurrentUseServerSnapshot);
  const routine: UserRoutineState = { ...comparison, currentlyUsing: currentUse.map((e) => e.product) };
  // 3か月以上前に追加した製品（今も使っているか確かめてもらう）
  const staleEntries = currentUse.filter((e) => isStale(e.addedAt, currentTime()));
  const staleIds = new Set(staleEntries.map((e) => e.product.id));

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const priceLookupRef = useRef(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  // スマホの幅（Tailwind の lg = 64rem 未満）か。引き出しをモーダルとして扱うかどうかに使う
  const isMobileViewport = useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(MOBILE_QUERY);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false
  );
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // スマホのルーティン引き出し：開いたら閉じるボタンにフォーカスし、Escape で閉じてメニューボタンに戻す
  const isDrawerModal = isSidebarOpen && isMobileViewport;
  // 閉じたらメニューボタンにフォーカスを戻す。ヘッダーの inert が外れて（再描画されて）からでないと移せない
  const closeSidebar = () => {
    setIsSidebarOpen(false);
    requestAnimationFrame(() => menuButtonRef.current?.focus());
  };
  useEffect(() => {
    if (!isDrawerModal) return;
    drawerCloseRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      closeSidebar();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isDrawerModal]);


  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((current) => (current === msg ? null : current));
    }, 3000);
  };

  const handleSendMessage = async (textToSend?: string) => {
    const messageText = (textToSend || input).trim();
    if (!messageText || isLoading) return;

    setInput('');
    setIsTrayOpen(false);

    // Add user message
    const userMsg: ChatMessage = {
      ...messageMeta('user'),
      role: 'user',
      content: messageText,
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: messageText,
          routine,
        }),
      });

      if (!res.ok) throw new Error('API Error');

      const data = await res.json();

      const assistantMsg: ChatMessage = {
        ...messageMeta('bot'),
        role: 'assistant',
        content: data.reply,
        productSuggestions: data.productSuggestions,
        suggestionKind: data.suggestionKind === 'alternatives' ? 'alternatives' : undefined,
        singleAnalysis: data.singleAnalysis,
        differentialAnalysis: data.differentialAnalysis,
        priceResult: data.priceResult,
        quickReplies: data.quickReplies,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          ...messageMeta('err'),
          role: 'assistant',
          content: '通信中にエラーが発生しました。もう一度お試しください。',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBarcodeScanned = async (barcode: string, label?: string) => {
    setIsScannerOpen(false);
    setIsLoading(true);

    const userMsg: ChatMessage = {
      ...messageMeta('user-barcode'),
      role: 'user',
      content: label ?? `📷 バーコード（${barcode}）をスキャンしました`,
    };

    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'barcode_lookup',
          barcode,
          routine,
        }),
      });

      const data = await res.json();

      const assistantMsg: ChatMessage = {
        ...messageMeta('bot-barcode'),
        role: 'assistant',
        content: data.reply,
        singleAnalysis: data.singleAnalysis,
        quickReplies: data.quickReplies,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  /** お店の商品検索の製品（JAN コードなし）の成分を、商品名で調べる。見つかった製品を候補として出す */
  const lookupShopProduct = async (product: Product) => {
    if (lookupRef.current) return;
    lookupRef.current = true;
    setIsLoading(true);
    setMessages((prev) => [
      ...prev,
      { ...messageMeta('user-select'), role: 'user', content: `「${product.name}」の成分を詳しく知りたい` },
    ]);
    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lookup_product', selectedProduct: product }),
      });
      if (!res.ok && res.status !== 429) throw new Error('API Error');
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          ...messageMeta('bot-lookup'),
          role: 'assistant',
          content: data.reply,
          productSuggestions: data.productSuggestions,
          quickReplies: data.quickReplies,
        },
      ]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { ...messageMeta('bot-lookup'), role: 'assistant', content: '通信中にエラーが発生しました。もう一度お試しください。' },
      ]);
    } finally {
      lookupRef.current = false;
      setIsLoading(false);
    }
  };

  /** 分析した商品の販売価格を調べる（サーバーはブランド名と商品名だけで検索する） */
  const handlePriceLookup = async (label: string, product: Product) => {
    // 再描画の前に2回押されても、有料の検索を2回しない
    if (priceLookupRef.current) return;
    priceLookupRef.current = true;
    setIsLoading(true);
    setMessages((prev) => [...prev, { ...messageMeta('user-price'), role: 'user', content: label }]);
    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'price_lookup', selectedProduct: product }),
      });
      if (!res.ok && res.status !== 429) throw new Error('API Error');
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          ...messageMeta('bot-price'),
          role: 'assistant',
          content: data.reply,
          priceResult: data.priceResult,
          quickReplies: data.quickReplies,
        },
      ]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { ...messageMeta('err'), role: 'assistant', content: '通信中にエラーが発生しました。もう一度お試しください。' },
      ]);
    } finally {
      priceLookupRef.current = false;
      setIsLoading(false);
    }
  };

  /** 入力された成分表示を分析する（サーバーはパーサーと成分DBだけで分析し、保存しない） */
  const handleLabelSubmit = async (label: LabelInput): Promise<boolean> => {
    // 前の応答を待っている間は受け付けない（返信の順序が入れ替わらないように）
    if (isLoading) return false;
    setIsLabelInputOpen(false);
    setIsLoading(true);
    setMessages((prev) => [
      ...prev,
      {
        ...messageMeta('user-label'),
        role: 'user',
        content: `📝 成分表示を入力しました${label.name ? `（${label.name}）` : ''}`,
      },
    ]);

    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'analyze_label', label, routine }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          ...messageMeta('bot-label'),
          role: 'assistant',
          content: data.reply,
          singleAnalysis: data.singleAnalysis,
          quickReplies: data.quickReplies,
        },
      ]);
      return !!data.singleAnalysis;
    } catch (err) {
      console.error(err);
      // 入力した成分表示は入力欄に残っているので、開き直してやり直せる
      setMessages((prev) => [
        ...prev,
        {
          ...messageMeta('bot-label-error'),
          role: 'assistant',
          content: '通信中にエラーが発生しました。入力した成分表示は残っているので、もう一度お試しください。',
          quickReplies: ['📝 成分表示を入力する'],
        },
      ]);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectProductToAnalyze = async (product: Product) => {
    // お店の商品検索の製品は成分が分からない。JAN コードがあればバーコードで、無ければ名前で調べる
    if (product.id.startsWith('shop_')) {
      if (lookupRef.current) return;
      if (product.barcode) {
        lookupRef.current = true;
        try {
          await handleBarcodeScanned(product.barcode, `「${product.name}」の成分を詳しく知りたい`);
        } finally {
          lookupRef.current = false;
        }
        return;
      }
      await lookupShopProduct(product);
      return;
    }
    setIsLoading(true);

    const userMsg: ChatMessage = {
      ...messageMeta('user-select'),
      role: 'user',
      content: `「${product.brand} ${product.name}」の成分を詳しく知りたい`,
    };

    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'analyze_single',
          selectedProduct: product,
          routine,
        }),
      });

      const data = await res.json();

      const assistantMsg: ChatMessage = {
        ...messageMeta('bot-analysis'),
        role: 'assistant',
        content: data.reply,
        singleAnalysis: data.singleAnalysis,
        quickReplies: data.quickReplies,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  /** 肌荒れリストに追加する。追加した場合は true、すでに登録済みなら false */
  const handleAddToBad = (product: Product): boolean => {
    if (routine.badProducts.some((p) => p.id === product.id)) {
      showToast(`すでに肌荒れリストに登録されています`);
      return false;
    }
    setRoutine((prev) => ({
      ...prev,
      badProducts: [...prev.badProducts, product],
    }));
    showToast(`「${product.name}」を【肌荒れしたコスメ】に追加しました`);
    return true;
  };

  /** 安全リストに追加する。追加した場合は true、すでに登録済みなら false */
  const handleAddToSafe = (product: Product): boolean => {
    if (routine.safeProducts.some((p) => p.id === product.id)) {
      showToast(`すでに安全リストに登録されています`);
      return false;
    }
    setRoutine((prev) => ({
      ...prev,
      safeProducts: [...prev.safeProducts, product],
    }));
    showToast(`「${product.name}」を【安全なコスメ】に追加しました`);
    return true;
  };

  /** 今使っているコスメに追加する。追加した場合は true */
  const handleAddToCurrent = (product: Product): boolean => {
    // 再描画の前に続けて押されても正しく数えるよう、最新のリストで確かめる
    const latest = getCurrentUseSnapshot();
    if (latest.some((e) => e.product.id === product.id)) {
      showToast('すでに今使っているコスメに登録されています');
      return false;
    }
    if (latest.length >= MAX_CURRENT_USE) {
      showToast(`今使っているコスメは${MAX_CURRENT_USE}点まで登録できます`);
      return false;
    }
    const addedAt = currentTime();
    updateCurrentUse((prev) => [...prev, { product, addedAt }]);
    showToast(
      isPersistable(product)
        ? `「${product.name}」を【今使っているコスメ】に追加しました`
        : `「${product.name}」を【今使っているコスメ】に追加しました（入力した成分表示は保存しません）`
    );
    return true;
  };

  const handleRemoveCurrent = (id: string) => {
    updateCurrentUse((prev) => prev.filter((e) => e.product.id !== id));
  };

  /** 「今も使っている」：追加した日を今日にする */
  const handleConfirmCurrent = (id: string) => {
    const now = currentTime();
    updateCurrentUse((prev) => prev.map((e) => (e.product.id === id ? { ...e, addedAt: now } : e)));
  };

  const handleRemoveBad = (id: string) => {
    setRoutine((prev) => ({
      ...prev,
      badProducts: prev.badProducts.filter((p) => p.id !== id),
    }));
  };

  const handleRemoveSafe = (id: string) => {
    setRoutine((prev) => ({
      ...prev,
      safeProducts: prev.safeProducts.filter((p) => p.id !== id),
    }));
  };

  /** サーバーを呼ばずに、押したボタンとその案内をチャットに追加する */
  const appendLocalExchange = (label: string, reply: string, quickReplies?: string[]) => {
    setMessages((prev) => [
      ...prev,
      { ...messageMeta('user-quick'), role: 'user', content: label },
      { ...messageMeta('bot-local'), role: 'assistant', content: reply, quickReplies },
    ]);
  };

  /** クイック返信ボタンの処理（画面操作はブラウザ側で行い、調査依頼だけをサーバーに送る） */
  const handleQuickReply = (label: string, sourceMessage: ChatMessage) => {
    const action = getQuickReplyAction(label);
    if (action.kind === 'scanner') {
      setIsScannerOpen(true);
      return;
    }
    if (action.kind === 'label_input') {
      setIsLabelInputOpen(true);
      return;
    }
    // 応答待ちの間は、メッセージの順序が入れ替わらないよう他のボタンを受け付けない
    if (isLoading) return;
    switch (action.kind) {
      case 'send':
        handleSendMessage(action.text);
        return;
      case 'add_analyzed': {
        const product = sourceMessage.singleAnalysis?.product;
        if (!product) {
          appendLocalExchange(label, PICK_FROM_CARDS_HINT);
          return;
        }
        if (action.list === 'bad') {
          const added = handleAddToBad(product);
          appendLocalExchange(
            label,
            added
              ? `「${product.name}」を【肌荒れしたコスメ】に追加しました。普段問題なく使えているコスメも追加して「差分分析」を実行すると、肌荒れの原因になった可能性のある成分をあぶり出せます。`
              : `「${product.name}」はすでに【肌荒れしたコスメ】に登録されています。普段問題なく使えているコスメも追加して「差分分析」を実行できます。`,
            ['✅ 普段使えているコスメを入力する']
          );
        } else {
          const added = handleAddToSafe(product);
          appendLocalExchange(
            label,
            added
              ? `「${product.name}」を【安全なコスメ】に追加しました。肌荒れしたコスメも追加して「差分分析」を実行すると、原因成分をあぶり出せます。`
              : `「${product.name}」はすでに【安全なコスメ】に登録されています。肌荒れしたコスメを追加して「差分分析」を実行できます。`,
            ['🧴 肌荒れしたコスメを入力する']
          );
        }
        return;
      }
      case 'price_analyzed': {
        const product = sourceMessage.singleAnalysis?.product;
        if (product) handlePriceLookup(label, product);
        else appendLocalExchange(label, PICK_FROM_CARDS_HINT);
        return;
      }
      case 'pick_from_cards':
        appendLocalExchange(label, PICK_FROM_CARDS_HINT);
        return;
      case 'reset':
        handleLoadPreset('clear');
        appendLocalExchange(label, '比較リスト（肌荒れしたコスメ・安全なコスメ）を空にしました。', [
          '🧴 肌荒れしたコスメを入力する',
        ]);
        return;
      case 'prompt_input':
        appendLocalExchange(label, action.hint);
        inputRef.current?.focus();
        return;
      case 'server':
        handleSendMessage(label);
        return;
    }
  };

  const handleRunDifferential = async () => {
    if (routine.badProducts.length === 0) return;

    setIsLoading(true);

    const userMsg: ChatMessage = {
      ...messageMeta('user-diff'),
      role: 'user',
      content: `⚡️ 肌荒れコスメ（${routine.badProducts.map((p) => p.name).join('、')}）の原因成分をあぶり出してください`,
    };

    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'differential',
          routine,
        }),
      });

      const data = await res.json();

      const assistantMsg: ChatMessage = {
        ...messageMeta('bot-diff'),
        role: 'assistant',
        content: data.reply,
        differentialAnalysis: data.differentialAnalysis,
        quickReplies: data.quickReplies,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  /** 今使っているコスメの組み合わせを調べる（サーバーはルールだけで判定する） */
  const handleCheckCurrentUse = async () => {
    if (currentUse.length < 2 || isLoading) return;
    // 送った時点の、3か月以上前に追加した製品（結果のカードで確かめてもらう）
    const staleProductNames = staleEntries.map((e) => e.product.name);
    setIsLoading(true);
    setMessages((prev) => [
      ...prev,
      {
        ...messageMeta('user-current'),
        role: 'user',
        content: `🧴 今使っているコスメ（${currentUse.map((e) => e.product.name).join('、')}）の組み合わせを調べてください`,
      },
    ]);

    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 比較リストは使わないので送らない
        body: JSON.stringify({
          action: 'check_current_use',
          routine: { badProducts: [], safeProducts: [], currentlyUsing: routine.currentlyUsing },
        }),
      });
      if (res.status === 400) {
        setMessages((prev) => [
          ...prev,
          {
            ...messageMeta('bot-current-invalid'),
            role: 'assistant',
            content:
              '「今使っているコスメ」の内容を確認できませんでした。最近追加したコスメをいったん削除して、追加し直してください。',
          },
        ]);
        return;
      }
      if (!res.ok && res.status !== 429) throw new Error('API Error');
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          ...messageMeta('bot-current'),
          role: 'assistant',
          content: data.reply,
          currentUseCheck: data.currentUseCheck && {
            ...data.currentUseCheck,
            ...(staleProductNames.length > 0 && { staleProductNames }),
          },
          quickReplies: data.quickReplies,
        },
      ]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { ...messageMeta('err'), role: 'assistant', content: '通信中にエラーが発生しました。もう一度お試しください。' },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadPreset = (presetType: 'sample_irritation' | 'clear') => {
    if (presetType === 'clear') {
      // 今使っているコスメは別に管理するため、比較リストだけを空にする
      setRoutine({ badProducts: [], safeProducts: [] });
      showToast('比較リストをリセットしました');
      return;
    }

    // Load sample irritation scenario (Melano CC as bad, Curel Wash & Ihada Lotion as safe)
    const sampleMelano: Product = {
      id: 'sample_melano_cc',
      name: '薬用しみ集中対策 プレミアム美容液',
      brand: 'ロート製薬',
      country: 'JP',
      category: 'serum',
      ingredients: ['アスコルビン酸', 'ピリドキシン塩酸塩', 'アラントイン', 'o-シメン-5-オール', '香料'],
      amazonSearchUrl: 'https://www.amazon.co.jp/s?k=メラノCC+プレミアム美容液&tag=cosmetantei-22',
      descriptionJa: 'サンプルデータ：ビタミンC高配合美容液',
    };
    const sampleCurel: Product = {
      id: 'sample_curel_wash',
      name: '潤浸保湿 泡洗顔料',
      brand: 'キュレル',
      country: 'JP',
      category: 'cleanser',
      fragranceFree: true,
      alcoholFree: true,
      ingredients: ['グリチルリチン酸2K', '精製水', 'グリセリン', 'ラウロイルアスパラギン酸Na液'],
      amazonSearchUrl: 'https://www.amazon.co.jp/s?k=キュレル+泡洗顔料&tag=cosmetantei-22',
      descriptionJa: 'サンプルデータ：セラミドケア洗顔料',
    };
    const sampleIhada: Product = {
      id: 'sample_ihada_lotion',
      name: '薬用ローション とてもしっとり',
      brand: 'イハダ',
      country: 'JP',
      category: 'toner',
      fragranceFree: true,
      alcoholFree: true,
      ingredients: ['アラントイン', 'グリチルリチン酸ジカリウム', '精製水', '高精製ワセリン'],
      amazonSearchUrl: 'https://www.amazon.co.jp/s?k=イハダ+薬用ローション&tag=cosmetantei-22',
      descriptionJa: 'サンプルデータ：低刺激薬用化粧水',
    };

    setRoutine({
      badProducts: [sampleMelano],
      safeProducts: [sampleCurel, sampleIhada],
    });
    showToast('テストデータを読み込みました！「差分分析」を実行できます');
  };

  const routineCount = routine.badProducts.length + routine.safeProducts.length + currentUse.length;

  return (
    <div className="flex flex-col h-dvh bg-surface text-ink font-sans">
      {/* Snackbar（Material 3：画面下、入力欄の上） */}
      {/* 読み上げ用のライブリージョンは常に置いておく（中身ごと追加すると読み上げられないことがある） */}
      <div role="status" className="sr-only">
        {toastMessage}
      </div>
      {toastMessage && (
        <div
          aria-hidden
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] w-max max-w-[calc(100%-2rem)] bg-[#2c322f] text-[#ecf2ed] px-4 py-3 rounded-lg text-sm shadow-lg flex items-center gap-2 animate-fade-in"
        >
          <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-300" aria-hidden />
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
              敏感肌の肌荒れ原因成分を特定・あぶり出すAIスキンケア相談
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsScannerOpen(true)}
            aria-label="バーコード読取"
            className="min-h-12 min-w-12 flex items-center justify-center gap-2 sm:px-4 rounded-full text-ink hover:bg-surface-container sm:border sm:border-sage-600 sm:text-sage-700 sm:hover:bg-sage-50 text-sm font-semibold transition-colors"
          >
            <ScanBarcode className="w-6 h-6 sm:w-5 sm:h-5" aria-hidden />
            <span className="hidden sm:inline">バーコード読取</span>
          </button>

          <button
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
            aria-label={
              isSidebarOpen
                ? 'マイルーティンを閉じる'
                : staleIds.size > 0
                ? `マイルーティンを開く（${STALE_AFTER_MONTHS}か月以上前に追加したコスメが${staleIds.size}点あります）`
                : 'マイルーティンを開く'
            }
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
        <main inert={isDrawerModal} className="flex-1 flex flex-col min-w-0 bg-surface">
          {/* スマホ：登録状況とカルテ（ルーティン引き出し）を開くボタン */}
          <div className="lg:hidden px-3 pt-3">
            <div className="max-w-[720px] mx-auto bg-white rounded-xl border border-sand-200 shadow-xs pl-3 pr-1 py-1 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-full bg-tint-safe text-emerald-700 flex items-center justify-center shrink-0">
                  <ClipboardList className="w-[18px] h-[18px]" aria-hidden />
                </div>
                <p className="text-xs text-ink-muted truncate">
                  肌荒れ {routine.badProducts.length}点 / 安全 {routine.safeProducts.length}点 / 使用中 {currentUse.length}点
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                aria-controls="routine-drawer"
                aria-expanded={isSidebarOpen}
                className="min-h-12 px-3 rounded-lg text-sage-700 hover:bg-surface-container text-sm font-semibold flex items-center gap-1 shrink-0"
              >
                カルテを開く
              </button>
            </div>
          </div>

          {/* 3か月以上前に追加した「今使っているコスメ」の確認（今も使っている・削除で消える） */}
          {staleEntries.length > 0 && (
            <div
              role="status"
              className="mx-3 sm:mx-6 mt-3 px-3 py-2 bg-orange-50 rounded-xl border border-orange-200 text-xs text-orange-900 flex items-center gap-2"
            >
              <CalendarClock className="w-4 h-4 shrink-0 text-orange-600" />
              <p className="flex-1 min-w-0 break-words">
                「今使っているコスメ」に、{STALE_AFTER_MONTHS}か月以上前に追加したものがあります（
                {staleEntries.slice(0, 3).map((e) => e.product.name).join('、')}
                {staleEntries.length > 3 && ` ほか${staleEntries.length - 3}点`}
                ）。今も使っているか確かめてください。
              </p>
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                className="lg:hidden shrink-0 min-h-12 px-3 bg-white hover:bg-orange-100 border border-orange-300 rounded-lg text-sm font-semibold"
              >
                確認する
              </button>
            </div>
          )}

          {/* Messages Scroll Area */}
          <div className="flex-1 overflow-y-auto px-3 py-4 sm:p-6 space-y-4">
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
                      : 'bg-white text-ink rounded-tl-sm border border-sand-200'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>

                  {/* Product Suggestion Cards */}
                  {msg.productSuggestions && (
                    <ProductSuggestionCard
                      products={msg.productSuggestions}
                      onSelectToAnalyze={handleSelectProductToAnalyze}
                      onAddToBad={handleAddToBad}
                      onAddToSafe={handleAddToSafe}
                      onAddToCurrent={handleAddToCurrent}
                      isAlternatives={msg.suggestionKind === 'alternatives'}
                    />
                  )}

                  {/* Single Product Analysis Card */}
                  {msg.singleAnalysis && (
                    <IngredientAnalysisCard
                      analysis={msg.singleAnalysis}
                      onAddToBadRoutine={() => handleAddToBad(msg.singleAnalysis!.product)}
                      onAddToSafeRoutine={() => handleAddToSafe(msg.singleAnalysis!.product)}
                      onAddToCurrentRoutine={() => handleAddToCurrent(msg.singleAnalysis!.product)}
                    />
                  )}

                  {/* Differential Culprit Card with Amazon safe recommendations */}
                  {msg.differentialAnalysis && (
                    <DifferentialResultCard result={msg.differentialAnalysis} />
                  )}

                  {msg.currentUseCheck && <CurrentUseResultCard result={msg.currentUseCheck} />}

                  {msg.priceResult && <PriceResultCard result={msg.priceResult} />}

                  {/* Quick Replies */}
                  {msg.quickReplies && msg.quickReplies.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-sand-200 -mx-4 px-4 pb-1 flex gap-2 overflow-x-auto sm:mx-0 sm:px-0 sm:flex-wrap">
                      {msg.quickReplies.map((qr, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => handleQuickReply(qr, msg)}
                          className="shrink-0 whitespace-nowrap min-h-12 text-[13px] bg-white hover:bg-tint-safe hover:border-emerald-500 text-ink border border-sand-300 px-4 rounded-full font-semibold transition-colors"
                        >
                          {qr}
                        </button>
                      ))}
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
                <div className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center shrink-0 animate-pulse">
                  <Bot className="w-[18px] h-[18px]" aria-hidden />
                </div>
                <div className="flex items-center gap-1.5 bg-white px-4 py-3 rounded-2xl rounded-tl-sm border border-sand-200 shadow-xs">
                  <div className="w-1.5 h-1.5 bg-sage-500 rounded-full animate-bounce" />
                  <div className="w-1.5 h-1.5 bg-sage-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                  <div className="w-1.5 h-1.5 bg-sage-500 rounded-full animate-bounce [animation-delay:0.4s]" />
                  <span className="ml-1 font-medium">成分データベースを解析中...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Form Bar */}
          <div className="px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 bg-surface">
            <div className="max-w-[720px] mx-auto">
              <LiveSearchCandidateTray
                query={input}
                candidates={trayCandidates}
                brands={liveBrands}
                credits={trayCredits}
                onSelectBrand={(brand) => {
                  // ブランド名を入れて続けて入力できるようにする（候補はそのブランドの製品に絞り込まれる）
                  setInput(`${brand} `);
                  inputRef.current?.focus();
                }}
                isOpen={isTrayOpen && (trayCandidates.length > 0 || liveBrands.length > 0) && input.trim() !== ''}
                onClose={() => setIsTrayOpen(false)}
                onSelectProduct={(product) => {
                  setIsTrayOpen(false);
                  setInput('');
                  handleSelectProductToAnalyze(product);
                }}
                onAddToBad={(product) => {
                  handleAddToBad(product);
                }}
                onAddToSafe={(product) => {
                  handleAddToSafe(product);
                }}
                onAddToCurrent={(product) => {
                  handleAddToCurrent(product);
                }}
              />

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
                  type="text"
                  value={input}
                  onChange={(e) => {
                    const value = e.target.value;
                    setInput(value);
                    // 入力を消したら前の検索候補を破棄する（次の入力で古い候補が一瞬表示されないように）
                    if (!value.trim()) {
                      setIsTrayOpen(false);
                      setLiveCandidates([]);
                    }
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
            routine={routine}
            onClose={closeSidebar}
            closeButtonRef={drawerCloseRef}
            currentUse={currentUse}
            staleIds={staleIds}
            onRemoveBad={handleRemoveBad}
            onRemoveSafe={handleRemoveSafe}
            onRemoveCurrent={handleRemoveCurrent}
            onConfirmCurrent={handleConfirmCurrent}
            onCheckCurrentUse={() => {
              closeSidebar();
              handleCheckCurrentUse();
            }}
            onRunDifferential={() => {
              closeSidebar();
              handleRunDifferential();
            }}
            onOpenScanner={() => {
              setIsSidebarOpen(false);
              setIsScannerOpen(true);
            }}
            onLoadPreset={handleLoadPreset}
          />
        </div>
      </div>

      {/* Barcode Scanner Modal */}
      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={handleBarcodeScanned}
      />

      <LabelInputModal
        isOpen={isLabelInputOpen}
        onClose={() => setIsLabelInputOpen(false)}
        onSubmit={handleLabelSubmit}
      />
    </div>
  );
};
