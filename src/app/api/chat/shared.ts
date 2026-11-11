import { NextRequest, NextResponse } from 'next/server';
import { Product, UserRoutineState } from '@/lib/types';
import { GateDecision } from '@/lib/services/chat-gate';
import { researchPrices, summarizePriceResult } from '@/lib/services/price-service';
import { isRateLimited, RATE_LIMIT_MESSAGE_JA } from '@/lib/server/cloudflare';

/** ボタン操作の種類（ブラウザが送る action） */
export type ChatAction =
  | 'analyze_single'
  | 'differential'
  | 'barcode_lookup'
  | 'search'
  | 'analyze_label'
  | 'price_lookup'
  | 'check_current_use'
  | 'lookup_product'
  | 'research_product'
  | 'find_alternatives';

/** 入力された成分表示（route.ts で形式を検証済み） */
export type LabelInput = { text?: unknown; name?: unknown; brand?: unknown };

/** 検証と製品の読み直しを済ませたリクエスト。各ハンドラーはこれだけを受け取る */
export interface ChatContext {
  request: NextRequest;
  action?: ChatAction;
  /** サーバーが持っている製品に置き換えた比較リスト */
  routine: UserRoutineState | undefined;
  /** サーバーが持っている製品ならサーバーの内容。持っていなければ送られた内容のまま */
  selectedProduct: Product | undefined;
  /** ブラウザから送られたままの製品 */
  sentProduct: Product | undefined;
  /** 比較リストに登録した製品（代わりの商品に出さない） */
  registered: Product[];
  userText: string;
  barcode?: string;
  label?: LabelInput;
}

/** 自由入力の判定（チャットゲート）の後。gate は文章がないとき・差分分析ボタンのとき null */
export interface IntentContext extends ChatContext {
  gate: GateDecision | null;
}

/** 返答するか、null（この分岐ではない。次を試す） */
export type ChatHandler<C extends ChatContext = ChatContext> = (ctx: C) => Promise<NextResponse | null>;

/** ハンドラーを順に試し、最初の返答を返す */
export async function firstReply<C extends ChatContext>(ctx: C, handlers: ChatHandler<C>[]): Promise<NextResponse | null> {
  for (const handle of handlers) {
    const response = await handle(ctx);
    if (response) return response;
  }
  return null;
}

/** Web リサーチが使う有料の呼び出し（これが上限で断られたときだけ、「見つからなかった」の代わりに上限を伝える） */
export const RESEARCH_BUCKETS = ['web_search', 'gemini'] as const;

/** 価格を調べて返す（T4）。query は商品名だけ。商品名が無ければ入力を案内する */
export async function priceReply(query: string | null, clientIp: string) {
  // 価格の検索は楽天・Yahoo! の API を何回か呼ぶ（API の回数の決まりがある）ので、ほかの操作より少ない回数に制限する
  if (await isRateLimited('price', clientIp)) {
    return NextResponse.json({ reply: RATE_LIMIT_MESSAGE_JA }, { status: 429 });
  }
  if (!query) {
    return NextResponse.json({
      reply: '価格を調べたい商品の名前（ブランド名＋商品名）を入力してください。例：「キュレル 潤浸保湿 化粧水 の価格」',
      quickReplies: ['🔍 商品名で検索する'],
    });
  }
  const priceResult = await researchPrices(query);
  return NextResponse.json({
    reply: summarizePriceResult(priceResult),
    priceResult,
    quickReplies: ['🔍 別のコスメを調べる', '📸 バーコードをスキャンする'],
  });
}
