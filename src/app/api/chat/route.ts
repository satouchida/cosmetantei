import { NextRequest, NextResponse } from 'next/server';
import {
  searchCosmeticsLive,
  lookupByBarcode,
  getServicePurposeExplanation,
  BARCODE_PATTERN,
} from '@/lib/services/search-barcode-service';
import { analyzeProduct, performDifferentialAnalysis } from '@/lib/analyzer/ingredient-analyzer';
import { Product, UserRoutineState } from '@/lib/types';
import { generateGeminiChatResponse } from '@/lib/services/gemini';
import { classifyChatMessage, GATE_REPLIES } from '@/lib/services/chat-gate';
import { getClientIp, isRateLimited, RATE_LIMIT_MESSAGE_JA } from '@/lib/server/cloudflare';
import { isValidProduct, isValidRoutine, MAX_MESSAGE_LENGTH } from '@/lib/server/validation';
import { hydrateVerifiedProducts } from '@/lib/data/cosmetics-db';

const INVALID_REQUEST_REPLY = 'リクエストの形式が正しくありません。ページを再読み込みしてもう一度お試しください。';

export async function POST(request: NextRequest) {
  try {
    // レート制限チェック（Cloudflare Rate Limiting バインディング、無ければインメモリ）
    if (await isRateLimited('ai', getClientIp(request.headers))) {
      return NextResponse.json({ reply: RATE_LIMIT_MESSAGE_JA }, { status: 429 });
    }

    const body = await request.json();
    const {
      message,
      routine,
      action,
      selectedProduct,
      barcode,
    } = body as {
      message: string;
      routine: UserRoutineState;
      action?: 'analyze_single' | 'differential' | 'barcode_lookup' | 'search';
      selectedProduct?: Product;
      barcode?: string;
    };

    // 入力の形式・サイズを検証（分析処理と Gemini プロンプトに渡す前に）
    if (
      (message !== undefined && (typeof message !== 'string' || message.length > MAX_MESSAGE_LENGTH)) ||
      (routine !== undefined && !isValidRoutine(routine)) ||
      (selectedProduct !== undefined && !isValidProduct(selectedProduct)) ||
      (barcode !== undefined && typeof barcode !== 'string')
    ) {
      return NextResponse.json({ reply: INVALID_REQUEST_REPLY }, { status: 400 });
    }

    // KV に保存された成分確認済みの製品を読み込み、おすすめ代替品の候補にする
    await hydrateVerifiedProducts();

    const userText = (message || '').trim();
    const cleanNumeric = userText.replace(/[\s\-_]/g, '');
    const cleanBarcode = (barcode || '').replace(/[\s\-_]/g, '');
    const targetBarcode =
      action === 'barcode_lookup' && BARCODE_PATTERN.test(cleanBarcode)
        ? cleanBarcode
        : BARCODE_PATTERN.test(cleanNumeric)
        ? cleanNumeric
        : null;

    // 1. バーコード指定または数字直接入力の場合
    if (targetBarcode) {
      const product = await lookupByBarcode(targetBarcode);
      if (!product) {
        // Open Beauty Facts にも、同じバーコードが書かれた Web ページにも無かった。Gemini に推測させない
        return NextResponse.json({
          reply: `バーコード（${targetBarcode}）の製品は見つかりませんでした。ブランド名と商品名を入力して検索してください。`,
          quickReplies: ['🔍 商品名で検索する', '📸 別のバーコードをスキャン'],
        });
      }

      const analysis = analyzeProduct(product);
      const isMissing = analysis.isEstimatedFromMarketplaces || product.ingredients.some(i => i.includes('取得できませんでした'));

      const geminiReply = await generateGeminiChatResponse({
        userMessage: `バーコード（${targetBarcode}）から「${product.brand} - ${product.name}」を読み取りました。全成分解析を踏まえた敏感肌向けアドバイスをお願いします。`,
        contextData: {
          singleAnalysis: analysis,
          missingIngredientsProduct: isMissing ? product : undefined,
        },
      });

      return NextResponse.json({
        reply: geminiReply,
        singleAnalysis: analysis,
        quickReplies: [
          '🚨 このアイテムで肌荒れした（原因を特定）',
          '✅ 普段安全に使えている（安全リストに追加）',
          '🔍 他のコスメも調べる',
        ],
      });
    }

    // 2. 単一製品解析指定の場合
    if (action === 'analyze_single' && selectedProduct) {
      const analysis = analyzeProduct(selectedProduct);
      const isMissing = analysis.isEstimatedFromMarketplaces || selectedProduct.ingredients.some(i => i.includes('取得できませんでした'));

      const geminiReply = await generateGeminiChatResponse({
        userMessage: `「${selectedProduct.brand} - ${selectedProduct.name}」の成分を詳しく解説し、敏感肌が注意すべき点を教えてください。`,
        contextData: {
          singleAnalysis: analysis,
          missingIngredientsProduct: isMissing ? selectedProduct : undefined,
        },
      });

      return NextResponse.json({
        reply: geminiReply,
        singleAnalysis: analysis,
        quickReplies: [
          '🚨 このアイテムで肌荒れした（原因を特定）',
          '✅ 普段安全に使えている（安全リストに追加）',
          '🔍 別のコスメを調べる',
        ],
      });
    }

    // 3. 自由入力メッセージの判定（チャットゲート）。雑談・指示の書き換え・本人の医療相談は、
    //    商品検索・Gemini を呼ばずに定型文で返す。ボタン操作（文章を含まない）は判定しない
    //    差分分析ボタンは文章を使わない。それ以外は action に関係なく、文章があれば必ず判定する
    const gate = action === 'differential' || !userText ? null : await classifyChatMessage(userText);
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

    // 4. 差分分析（あぶり出し）実行の場合
    // 比較するコスメがまだ無ければ、肌荒れしたコスメの追加を案内する（Gemini は相談に答えない）
    const hasBadProducts = !!routine && routine.badProducts.length > 0;
    if (action === 'differential' || gate?.intent === 'find_cause') {
      if (!routine || !hasBadProducts) {
        return NextResponse.json({
          reply:
            '肌荒れ原因をあぶり出すには、まず「肌荒れしたコスメ」を1点以上追加してください。さらに「普段問題なく使えている安全なコスメ」もあると、共通の安全成分を除外して犯人成分を高精度に特定できます！',
          quickReplies: ['🔍 肌荒れしたコスメを検索', '📸 バーコードをスキャン'],
        });
      }

      const diffResult = performDifferentialAnalysis(routine.badProducts, routine.safeProducts || []);
      const geminiReply = await generateGeminiChatResponse({
        userMessage: `肌荒れしたコスメ（${routine.badProducts.map(p => p.name).join(', ')}）と安全なコスメ（${(routine.safeProducts || []).map(p => p.name).join(', ') || 'なし'}）を比較し、あぶり出された疑わしい成分（${diffResult.culprits.map(c => c.nameJa).join(', ')}）について、今後のコスメ選びのアドバイスをしてください。`,
        contextData: { differentialAnalysis: diffResult },
      });

      return NextResponse.json({
        reply: geminiReply,
        differentialAnalysis: diffResult,
        quickReplies: ['💡 おすすめの低刺激アイテムは？', '🔍 別のコスメを追加する', '🔄 リセットする'],
      });
    }

    // 5. 一般テキスト入力（分岐先はチャットゲートの意図判定）
    // A. 挨拶・使い方の質問：定型の説明のみ（商品検索や Gemini は呼ばない）
    if (gate?.intent === 'greeting_or_help') {
      return NextResponse.json({
        reply: getServicePurposeExplanation(),
        quickReplies: [
          '🧴 肌荒れしたコスメを入力する',
          '✅ 普段使えているコスメを入力する',
          '📸 バーコードをスキャンする',
          '🔍 キュレルの泡洗顔を調べる',
        ],
      });
    }

    // find_alternative・price_inquiry は、Web検索ベースの処理（計画の Phase 3・4）ができるまで
    // 以下の一般の分岐で扱う
    // B. 全入力に対する動的コスメ探索（肌トラブル・カテゴリ・成分・ブランド・製品名など）
    // Web リサーチ（有料）は商品を調べる依頼のときだけ。検索語は商品名だけを取り出して使い、チャット文は送らない
    const webResearch = gate?.intent === 'product_lookup';
    const matchedProducts = await searchCosmeticsLive(userText, 6, { webResearch });

    // C. 成分に関する質問
    if (gate?.intent === 'ingredient_question') {
      const geminiReply = await generateGeminiChatResponse({
        userMessage: userText,
        contextData: {
          matchedProducts: matchedProducts.length > 0 ? matchedProducts : undefined,
        },
      });

      return NextResponse.json({
        reply: geminiReply,
        productSuggestions: matchedProducts,
        quickReplies: ['🔍 この成分が入っていないコスメを探す', '📸 バーコードをスキャンする'],
      });
    }

    // D. 商品名の入力など。該当する商品が無い場合は Gemini に自由に答えさせず、定型文で返す
    if (matchedProducts.length === 0) {
      return NextResponse.json({
        reply:
          '該当する化粧品が見つかりませんでした。ブランド名と商品名を入力するか、パッケージのバーコードを読み取ってください。',
        quickReplies: ['🔍 具体的な商品名で再検索', '📸 バーコードをスキャンする', '🧴 キュレルの泡洗顔を調べる'],
      });
    }
    const geminiReply = await generateGeminiChatResponse({
      userMessage: userText,
      contextData: { matchedProducts },
    });

    const quickReplies = [
      '🚨 この中のアイテムで肌荒れした',
      '✅ この中のアイテムは安全に使えた',
      '📸 バーコードで読み取る',
      '🔍 別のキーワードで調べる',
    ];

    return NextResponse.json({
      reply: geminiReply,
      productSuggestions: matchedProducts,
      quickReplies,
    });
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
