'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  ChatMessage,
  Product,
  UserRoutineState,
  ProductAnalysisResult,
  DifferentialAnalysisResult,
} from '@/lib/types';
import { ProductSuggestionCard } from './ProductSuggestionCard';
import { IngredientAnalysisCard } from './IngredientAnalysisCard';
import { DifferentialResultCard } from './DifferentialResultCard';
import { BarcodeScannerModal } from '../scanner/BarcodeScannerModal';
import { RoutineSidebar } from '../routine/RoutineSidebar';
import {
  Camera,
  Send,
  Sparkles,
  Bot,
  User,
  ShieldCheck,
  Menu,
  X,
  RotateCcw,
  CheckCircle2,
  Search,
} from 'lucide-react';
import { searchCosmetics } from '@/lib/services/search-barcode-service';
import { LiveSearchCandidateTray } from '../search/LiveSearchCandidateTray';

export const ChatContainer: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-1',
      role: 'assistant',
      content: `🔍 こんにちは！肌荒れ成分特定サービス「コスメ探偵 (CosmeTantei)」です。\n\n今お使いの化粧品名（日本・韓国・アメリカ製品対応）を入力するか、パッケージのバーコード（JAN/UPC）をカメラで読み取ってください。\n\n「肌荒れしたコスメ」と「普段使える安全なコスメ」を比較して、肌荒れの原因成分（香料、エタノール、防腐剤、高濃度アクティブなど）をあぶり出し、その成分を含まない安心の代替アイテム（Amazonリンク付）をご提案します！`,
      timestamp: Date.now(),
      quickReplies: [
        '📸 バーコードをスキャンする',
        '🧴 キュレルの泡洗顔を調べる',
        '💧 トリデンのセラムを調べる',
        '⚡️ メラノCCで赤みが出た',
      ],
    },
  ]);

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [liveCandidates, setLiveCandidates] = useState<Product[]>([]);
  const [isTrayOpen, setIsTrayOpen] = useState(false);

  useEffect(() => {
    const trimmed = input.trim();
    if (!trimmed) {
      setLiveCandidates([]);
      setIsTrayOpen(false);
      return;
    }

    // 1. 動的キャッシュから即時表示（0ms応答）
    const instantResults = searchCosmetics(trimmed, 6);
    if (instantResults.length > 0) {
      setLiveCandidates(instantResults);
      setIsTrayOpen(true);
    }

    // 2. 高頻度API & Google検索への非同期問い合わせ（300msデバウンス）
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(trimmed)}&limit=6`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.results) && data.results.length > 0) {
            setLiveCandidates(data.results);
            setIsTrayOpen(true);
          }
        }
      } catch (e) {
        // オフライン時はキャッシュ結果を維持
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [input]);

  const [routine, setRoutine] = useState<UserRoutineState>({
    currentlyUsing: [],
    badProducts: [],
    safeProducts: [],
  });

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

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
      id: `user-${Date.now()}`,
      role: 'user',
      content: messageText,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
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
        id: `bot-${Date.now()}`,
        role: 'assistant',
        content: data.reply,
        productSuggestions: data.productSuggestions,
        singleAnalysis: data.singleAnalysis,
        differentialAnalysis: data.differentialAnalysis,
        quickReplies: data.quickReplies,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: '通信中にエラーが発生しました。もう一度お試しください。',
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBarcodeScanned = async (barcode: string) => {
    setIsScannerOpen(false);
    setIsLoading(true);

    const userMsg: ChatMessage = {
      id: `user-barcode-${Date.now()}`,
      role: 'user',
      content: `📷 バーコード（${barcode}）をスキャンしました`,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch('/api/chat', {
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
        id: `bot-barcode-${Date.now()}`,
        role: 'assistant',
        content: data.reply,
        singleAnalysis: data.singleAnalysis,
        quickReplies: data.quickReplies,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectProductToAnalyze = async (product: Product) => {
    setIsLoading(true);

    const userMsg: ChatMessage = {
      id: `user-select-${Date.now()}`,
      role: 'user',
      content: `「${product.brand} ${product.name}」の成分を詳しく知りたい`,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch('/api/chat', {
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
        id: `bot-analysis-${Date.now()}`,
        role: 'assistant',
        content: data.reply,
        singleAnalysis: data.singleAnalysis,
        quickReplies: data.quickReplies,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddToBad = (product: Product) => {
    if (!routine.badProducts.some((p) => p.id === product.id)) {
      setRoutine((prev) => ({
        ...prev,
        badProducts: [...prev.badProducts, product],
      }));
      showToast(`「${product.name}」を【肌荒れしたコスメ】に追加しました`);
    } else {
      showToast(`すでに肌荒れリストに登録されています`);
    }
  };

  const handleAddToSafe = (product: Product) => {
    if (!routine.safeProducts.some((p) => p.id === product.id)) {
      setRoutine((prev) => ({
        ...prev,
        safeProducts: [...prev.safeProducts, product],
      }));
      showToast(`「${product.name}」を【安全なコスメ】に追加しました`);
    } else {
      showToast(`すでに安全リストに登録されています`);
    }
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

  const handleRunDifferential = async () => {
    if (routine.badProducts.length === 0) return;

    setIsLoading(true);

    const userMsg: ChatMessage = {
      id: `user-diff-${Date.now()}`,
      role: 'user',
      content: `⚡️ 肌荒れコスメ（${routine.badProducts.map((p) => p.name).join('、')}）の原因成分をあぶり出してください`,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'differential',
          routine,
        }),
      });

      const data = await res.json();

      const assistantMsg: ChatMessage = {
        id: `bot-diff-${Date.now()}`,
        role: 'assistant',
        content: data.reply,
        differentialAnalysis: data.differentialAnalysis,
        quickReplies: data.quickReplies,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadPreset = (presetType: 'sample_irritation' | 'clear') => {
    if (presetType === 'clear') {
      setRoutine({ currentlyUsing: [], badProducts: [], safeProducts: [] });
      showToast('ルーティンをリセットしました');
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
      currentlyUsing: [],
      badProducts: [sampleMelano],
      safeProducts: [sampleCurel, sampleIhada],
    });
    showToast('テストデータを読み込みました！「差分分析」を実行できます');
  };

  return (
    <div className="flex flex-col h-screen bg-sand-50/40 text-gray-800 font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-gray-900/90 text-white px-4 py-2 rounded-xl text-xs sm:text-sm shadow-xl flex items-center gap-2 animate-fade-in border border-white/10">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Navbar */}
      <header className="bg-white border-b border-sand-200 px-4 sm:px-6 py-3 flex items-center justify-between shadow-2xs z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sage-600 via-emerald-600 to-amber-500 text-white flex items-center justify-center shadow-xs">
            <Search className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-gray-900 text-base tracking-tight">コスメ探偵</h1>
              <span className="text-[10px] font-bold bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full border border-amber-200">
                CosmeTantei
              </span>
            </div>
            <p className="text-[11px] text-gray-500 hidden sm:block">
              敏感肌の肌荒れ原因成分を特定・あぶり出すAIスキンケア相談
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsScannerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-sage-50 hover:bg-sage-100 text-sage-800 border border-sage-300 rounded-xl text-xs font-semibold transition-colors"
          >
            <Camera className="w-3.5 h-3.5 text-sage-700" />
            <span className="hidden sm:inline">バーコード読取</span>
          </button>

          <button
            type="button"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="lg:hidden p-2 text-gray-600 hover:text-gray-900 rounded-lg hover:bg-sand-100 relative"
          >
            <Menu className="w-5 h-5" />
            {(routine.badProducts.length > 0 || routine.safeProducts.length > 0) && (
              <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-rose-500 rounded-full" />
            )}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat Stream Section */}
        <main className="flex-1 flex flex-col min-w-0 bg-white">
          {/* Messages Scroll Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full bg-sage-100 text-sage-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-4 text-xs sm:text-sm leading-relaxed shadow-2xs ${
                    msg.role === 'user'
                      ? 'bg-sage-600 text-white rounded-tr-xs'
                      : 'bg-sand-50/90 text-gray-800 rounded-tl-xs border border-sand-200'
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
                    />
                  )}

                  {/* Single Product Analysis Card */}
                  {msg.singleAnalysis && (
                    <IngredientAnalysisCard
                      analysis={msg.singleAnalysis}
                      onAddToBadRoutine={() => handleAddToBad(msg.singleAnalysis!.product)}
                      onAddToSafeRoutine={() => handleAddToSafe(msg.singleAnalysis!.product)}
                    />
                  )}

                  {/* Differential Culprit Card with Amazon safe recommendations */}
                  {msg.differentialAnalysis && (
                    <DifferentialResultCard result={msg.differentialAnalysis} />
                  )}

                  {/* Quick Replies */}
                  {msg.quickReplies && msg.quickReplies.length > 0 && (
                    <div className="mt-3 pt-2.5 border-t border-sand-200/60 flex flex-wrap gap-1.5">
                      {msg.quickReplies.map((qr, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            if (qr.includes('バーコード')) {
                              setIsScannerOpen(true);
                            } else {
                              handleSendMessage(qr);
                            }
                          }}
                          className="text-[11px] bg-white hover:bg-sage-50 text-sage-800 border border-sage-200 px-2.5 py-1 rounded-full font-medium transition-colors shadow-2xs"
                        >
                          {qr}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {msg.role === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-sand-200 text-gray-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3 items-center text-xs text-gray-400 italic">
                <div className="w-8 h-8 rounded-full bg-sage-100 text-sage-700 flex items-center justify-center flex-shrink-0 animate-pulse">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="flex items-center gap-1.5 bg-sand-50 p-3 rounded-2xl border border-sand-200">
                  <div className="w-1.5 h-1.5 bg-sage-500 rounded-full animate-bounce" />
                  <div className="w-1.5 h-1.5 bg-sage-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                  <div className="w-1.5 h-1.5 bg-sage-500 rounded-full animate-bounce [animation-delay:0.4s]" />
                  <span className="ml-1 text-gray-500 font-medium">成分データベースを解析中...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Form Bar */}
          <div className="p-3 sm:p-4 bg-white border-t border-sand-200">
            <div className="max-w-4xl mx-auto">
              <LiveSearchCandidateTray
                query={input}
                candidates={liveCandidates}
                isOpen={isTrayOpen && liveCandidates.length > 0}
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
              />

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="flex items-center gap-2"
              >
                <button
                  type="button"
                  onClick={() => setIsScannerOpen(true)}
                  title="バーコードをカメラでスキャン"
                  className="p-2.5 text-sage-700 bg-sage-50 hover:bg-sage-100 rounded-xl border border-sage-200 transition-colors flex-shrink-0"
                >
                  <Camera className="w-5 h-5" />
                </button>

                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="コスメ名を入力 (例: ちふれ リップ, キュレル泡洗顔, アヌア, メラノCC...)"
                  className="flex-1 px-4 py-2.5 text-xs sm:text-sm bg-sand-50/60 border border-sand-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sage-400 text-gray-800 placeholder:text-gray-400"
                />

                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  className="p-2.5 bg-sage-600 hover:bg-sage-700 disabled:opacity-40 text-white rounded-xl transition-colors shadow-xs flex-shrink-0"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            </div>
          </div>
        </main>

        {/* Routine Sidebar */}
        <div
          className={`fixed lg:static inset-0 z-40 lg:z-auto transition-transform ${
            isSidebarOpen ? 'translate-x-0' : 'max-lg:translate-x-full'
          }`}
        >
          <div className="h-full relative flex">
            {/* Backdrop for mobile */}
            {isSidebarOpen && (
              <div
                className="fixed inset-0 bg-black/40 lg:hidden"
                onClick={() => setIsSidebarOpen(false)}
              />
            )}
            <div className="relative z-10 w-full lg:w-80 h-full">
              <RoutineSidebar
                routine={routine}
                onRemoveBad={handleRemoveBad}
                onRemoveSafe={handleRemoveSafe}
                onRunDifferential={() => {
                  setIsSidebarOpen(false);
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
        </div>
      </div>

      {/* Barcode Scanner Modal */}
      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={handleBarcodeScanned}
      />
    </div>
  );
};
