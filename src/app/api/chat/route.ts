import { NextRequest, NextResponse } from 'next/server';
import { Product, UserRoutineState } from '@/lib/types';
import { getClientIp, isRateLimited, RATE_LIMIT_MESSAGE_JA } from '@/lib/server/cloudflare';
import { isValidProduct, isValidRoutine, MAX_MESSAGE_LENGTH } from '@/lib/server/validation';
import { resolveClientProduct, resolveClientRoutine } from '@/lib/server/client-products';
import { hydrateVerifiedProducts } from '@/lib/data/cosmetics-db';
import { MAX_LABEL_NAME_LENGTH, MAX_LABEL_TEXT_LENGTH } from '@/lib/services/label-reader';
import { apiRoute, readJsonBody, TOO_LARGE } from '@/lib/server/api-route';
import { ChatAction, ChatContext, firstReply, LabelInput } from './shared';
import {
  barcodeReply,
  checkCurrentUseReply,
  differentialReply,
  findAlternativesReply,
  labelReply,
  lookupProductReply,
  priceLookupReply,
  researchProductReply,
  singleProductReply,
} from './action-handlers';
import {
  classifyGate,
  findAlternativeReply,
  gateReply,
  greetingReply,
  ingredientQuestionReply,
  priceInquiryReply,
  productSearchReply,
} from './intent-handlers';

/** 成分表示の入力（本文は必須、商品名・ブランドは任意） */
function isValidLabelInput(label: unknown): boolean {
  if (!label || typeof label !== 'object') return false;
  const { text, name, brand } = label as Record<string, unknown>;
  const optional = (v: unknown) => v === undefined || (typeof v === 'string' && v.length <= MAX_LABEL_NAME_LENGTH);
  return typeof text === 'string' && text.trim().length > 0 && text.length <= MAX_LABEL_TEXT_LENGTH && optional(name) && optional(brand);
}

/**
 * 本文の上限。3つの比較リスト（各 20 件）の製品を送ってもふつうは 100KB に届かない。
 * 何十 MB もの本文でアイソレートのメモリ（128MB）を使い切らせないように、それより大きい本文は読まない
 */
const MAX_CHAT_BODY_BYTES = 512 * 1024;

const INVALID_REQUEST_REPLY = 'リクエストの形式が正しくありません。ページを再読み込みしてもう一度お試しください。';

async function handlePost(request: NextRequest) {
  try {
    // レート制限チェック（Cloudflare Rate Limiting バインディング、無ければインメモリ）
    if (await isRateLimited('ai', getClientIp(request.headers))) {
      return NextResponse.json({ reply: RATE_LIMIT_MESSAGE_JA }, { status: 429 });
    }

    const body = await readJsonBody(request, MAX_CHAT_BODY_BYTES);
    if (body === TOO_LARGE) return NextResponse.json({ reply: INVALID_REQUEST_REPLY }, { status: 413 });
    if (!body || typeof body !== 'object') return NextResponse.json({ reply: INVALID_REQUEST_REPLY }, { status: 400 });
    const {
      message,
      routine: sentRoutine,
      action,
      selectedProduct: sentProduct,
      barcode,
      label,
    } = body as {
      message: string;
      routine: UserRoutineState;
      action?: ChatAction;
      selectedProduct?: Product;
      barcode?: string;
      label?: LabelInput;
    };

    // 入力の形式・サイズを検証（分析処理と Gemini プロンプトに渡す前に）
    if (
      (message !== undefined && (typeof message !== 'string' || message.length > MAX_MESSAGE_LENGTH)) ||
      (sentRoutine !== undefined && !isValidRoutine(sentRoutine)) ||
      (sentProduct !== undefined && !isValidProduct(sentProduct)) ||
      (barcode !== undefined && typeof barcode !== 'string') ||
      (label !== undefined && !isValidLabelInput(label))
    ) {
      return NextResponse.json({ reply: INVALID_REQUEST_REPLY }, { status: 400 });
    }

    // KV に保存された成分確認済みの製品を読み込み、おすすめ代替品の候補にする
    await hydrateVerifiedProducts();
    // サーバーが持っている製品は、ブラウザから送られた内容ではなくサーバーの内容を使う
    const routine = sentRoutine && (await resolveClientRoutine(sentRoutine));
    const selectedProduct = sentProduct && (await resolveClientProduct(sentProduct));
    // 比較リストに登録した製品（代わりの商品に出さない）
    const registered = routine ? [...routine.badProducts, ...(routine.safeProducts ?? []), ...(routine.currentlyUsing ?? [])] : [];

    const userText = (message || '').trim();
    const ctx: ChatContext = { request, action, routine, selectedProduct, sentProduct, registered, userText, barcode, label };

    // 1〜2c. バーコードとボタン操作（action-handlers.ts）。上から順に試し、最初に返答したものを返す
    const actionResponse = await firstReply(ctx, [
      barcodeReply, // 1. バーコード指定または数字直接入力
      labelReply, // 1b. 入力された成分表示の分析
      singleProductReply, // 2. 単一製品解析
      researchProductReply, // 2-2. 成分が分からなかった製品を Web で調べ直す
      lookupProductReply, // 2a. お店の商品検索の製品の成分を調べる
      findAlternativesReply, // 2a-2. 同じ種類で原因成分を含まない商品を探す
      priceLookupReply, // 2b. 分析した商品の価格
      checkCurrentUseReply, // 2c. 今も使っている製品の組み合わせチェック
    ]);
    if (actionResponse) return actionResponse;

    // 3〜5. 自由入力（intent-handlers.ts）。チャットゲートで判定してから、意図ごとに試す
    const intentCtx = { ...ctx, gate: await classifyGate(ctx) };
    const intentResponse = await firstReply(intentCtx, [
      gateReply, // 3. 商品の話ではない文章・文章のないボタン操作の残り
      differentialReply, // 4. 差分分析（ボタン、または原因をさがす文章）
      greetingReply, // 5A. 挨拶・使い方の質問
      ingredientQuestionReply, // 5B. 成分に関する質問
      findAlternativeReply, // 5C. 代わりの商品探し
      priceInquiryReply, // 5D. 価格
    ]);
    // 5E〜F. どれでもなければ商品を検索する（必ず返答する）
    return intentResponse ?? (await productSearchReply(intentCtx));
  } catch (err) {
    console.error('Chat error:', err);
    return NextResponse.json(
      {
        reply: '申し訳ありません、応答の生成中にエラーが発生しました。もう一度お試しください。',
      },
      { status: 500 }
    );
  }
}

/** ほかのサイトからの呼び出しを断り、有料の呼び出しにルート名と利用者を付ける（src/lib/server/api-route.ts） */
export const POST = apiRoute('chat', handlePost);
