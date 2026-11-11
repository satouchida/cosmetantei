import { NextResponse } from 'next/server';
import {
  searchCosmeticsLive,
  searchCosmeticsLiveWithCloseMatches,
  getServicePurposeExplanation,
} from '@/lib/services/search-barcode-service';
import {
  answerIngredientQuestion,
  findIngredientsInText,
  summarizeCloseMatches,
  summarizeProductResults,
} from '@/lib/services/chat-replies';
import { alternativeButtonLabel, classifyChatMessage, GATE_REPLIES } from '@/lib/services/chat-gate';
import { alternativeRequest, findAlternatives, summarizeAlternatives } from '@/lib/services/alternatives-service';
import { toPriceSearchQuery } from '@/lib/services/price-service';
import { getClientIp } from '@/lib/server/cloudflare';
import { currentSpendLimit } from '@/lib/server/usage';
import { spendLimitMessage } from '@/lib/spend-limit';
import { ChatContext, IntentContext, priceReply, RESEARCH_BUCKETS } from './shared';

/**
 * 3. 自由入力メッセージの判定（チャットゲート）。雑談・指示の書き換え・本人の医療相談は、
 *    商品検索・Gemini を呼ばずに定型文で返す。ボタン操作（文章を含まない）は判定しない
 *    差分分析ボタンは文章を使わない。それ以外は action に関係なく、文章があれば必ず判定する
 */
export async function classifyGate({ action, userText }: ChatContext) {
  return action === 'differential' || !userText ? null : await classifyChatMessage(userText);
}

/** 3. チャットゲートの判定の結果、商品の話ではない文章と、文章のないボタン操作の残り */
export async function gateReply({ gate, action }: IntentContext) {
  if (gate && gate.scope !== 'in_scope') {
    return NextResponse.json(GATE_REPLIES[gate.scope]);
  }
  // 文章のないボタン操作で、上の分岐で処理できなかったもの（読み取れないバーコード等）
  if (!gate && action !== 'differential') {
    return NextResponse.json({
      reply: 'バーコードまたは商品を読み取れませんでした。商品名を入力するか、もう一度スキャンしてください。',
      quickReplies: ['📸 別のバーコードをスキャン', '🔍 商品名で検索する'],
    });
  }
  return null;
}

// 5. 一般テキスト入力（分岐先はチャットゲートの意図判定）

/** A. 挨拶・使い方の質問：定型の説明のみ（商品検索や Gemini は呼ばない） */
export async function greetingReply({ gate }: IntentContext) {
  if (gate?.intent !== 'greeting_or_help') return null;
  return NextResponse.json({
    reply: getServicePurposeExplanation(),
    quickReplies: [
      '🧴 肌荒れしたコスメを入力する',
      '✅ 使えるコスメを入力する',
      '📸 バーコードをスキャンする',
      '🔍 キュレルの泡洗顔を調べる',
    ],
  });
}

/** B. 成分に関する質問：一般的な成分知識の短い解説（関連商品の検索と並行して作る） */
export async function ingredientQuestionReply({ gate, userText }: IntentContext) {
  if (gate?.intent !== 'ingredient_question') return null;
  const [matchedProducts, reply] = await Promise.all([
    searchCosmeticsLive(userText, 6),
    answerIngredientQuestion(userText),
  ]);
  // 成分DBの成分なら、その成分を含まない商品を探すボタンを出す
  const [mentioned] = findIngredientsInText(userText);
  return NextResponse.json({
    reply,
    productSuggestions: matchedProducts,
    quickReplies: [...(mentioned ? [alternativeButtonLabel(mentioned)] : []), '📸 バーコードをスキャンする'],
  });
}

/** C. 代わりの商品探し（T3）。避ける成分は成分DBの名前か比較の候補成分だけで、検索語に文章を使わない */
export async function findAlternativeReply({ gate, userText, routine }: IntentContext) {
  if (gate?.intent !== 'find_alternative') return null;
  const req = alternativeRequest(userText, routine);
  if (!req) {
    return NextResponse.json({
      reply:
        '避けたい成分（例：香料、エタノール）か、商品の種類（例：化粧水）を入力してください。肌荒れしたコスメを登録して原因候補の成分を絞り込むと、その成分を含まない商品を探せます。',
      quickReplies: ['🧴 肌荒れしたコスメを入力する', '🔍 商品名で検索する'],
    });
  }
  const { products, credits } = await findAlternatives(req);
  return NextResponse.json({
    reply: summarizeAlternatives(req, products),
    ...(products.length > 0 && { productSuggestions: products, suggestionKind: 'alternatives', alternativeCredits: credits }),
    quickReplies: ['🔍 別のコスメを調べる', '📸 バーコードをスキャンする'],
  });
}

/** D. 価格（T4）。検索語は文章から取り出した商品名だけ。楽天・Yahoo! の API だけで調べ、保存しない */
export async function priceInquiryReply({ gate, userText, request }: IntentContext) {
  if (gate?.intent !== 'price_inquiry') return null;
  return priceReply(toPriceSearchQuery(userText), getClientIp(request.headers));
}

/**
 * E. 全入力に対する動的コスメ探索（肌トラブル・カテゴリ・成分・ブランド・製品名など）
 * Web リサーチ（有料）は商品を調べる依頼のときだけ。検索語は商品名だけを取り出して使い、チャット文は送らない
 * 最後の分岐なので、必ず返答する
 */
export async function productSearchReply({ gate, userText }: IntentContext) {
  const webResearch = gate?.intent === 'product_lookup';
  const { products: matchedProducts, closeMatches } = await searchCosmeticsLiveWithCloseMatches(userText, 6, { webResearch });

  // F. 商品名の入力など。合う商品が無く、検索語にあるブランドの近い製品があれば、答えではなく近い候補として見せる
  if (matchedProducts.length === 0 && closeMatches.length > 0) {
    // 上限で Web を調べられなかったときは、その理由も書く（「見つからなかった」だけにしない）
    const limit = webResearch ? currentSpendLimit(RESEARCH_BUCKETS) : null;
    return NextResponse.json({
      reply: limit ? `${spendLimitMessage(limit)}\n\n${summarizeCloseMatches(closeMatches)}` : summarizeCloseMatches(closeMatches),
      productSuggestions: closeMatches,
      quickReplies: ['🔍 具体的な商品名で再検索', '📸 バーコードをスキャンする', '📝 成分表示を入力する'],
    });
  }
  // 該当する商品が無い場合は Gemini に自由に答えさせず、定型文で返す
  if (matchedProducts.length === 0) {
    const limit = webResearch ? currentSpendLimit(RESEARCH_BUCKETS) : null;
    return NextResponse.json({
      reply: limit
        ? spendLimitMessage(limit)
        : '該当する化粧品が見つかりませんでした。ブランド名と商品名を入力するか、パッケージのバーコードを読み取るか、成分表示を入力してください。',
      quickReplies: ['🔍 具体的な商品名で再検索', '📸 バーコードをスキャンする', '📝 成分表示を入力する'],
    });
  }
  const quickReplies = [
    '🚨 この中のアイテムで肌荒れした',
    '✅ この中のアイテムは問題なく使えた',
    '📸 バーコードで読み取る',
    '🔍 別のキーワードで調べる',
  ];

  return NextResponse.json({
    reply: summarizeProductResults(matchedProducts),
    productSuggestions: matchedProducts,
    quickReplies,
  });
}
