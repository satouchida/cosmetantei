import { NextRequest, NextResponse } from 'next/server';
import {
  searchCosmetics,
  searchCosmeticsLive,
  lookupByBarcode,
  isGreetingOrConsultation,
  getServicePurposeExplanation,
  BARCODE_PATTERN,
} from '@/lib/services/search-barcode-service';
import { analyzeProduct, performDifferentialAnalysis } from '@/lib/analyzer/ingredient-analyzer';
import { Product, UserRoutineState } from '@/lib/types';
import { KNOWN_INGREDIENTS } from '@/lib/data/ingredients-db';
import { generateGeminiChatResponse } from '@/lib/services/gemini';
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
        // 未登録バーコードの場合、Geminiにオンライン探索を依頼
        const dummyProduct: Product = {
          id: `unknown_${targetBarcode}`,
          name: `未登録製品 (JAN: ${targetBarcode})`,
          brand: 'バーコード照合',
          country: targetBarcode.startsWith('45') || targetBarcode.startsWith('49') ? 'JP' : targetBarcode.startsWith('880') ? 'KR' : 'US',
          category: 'other',
          barcode: targetBarcode,
          ingredients: ['成分情報はオンラインマーケットプレイスより補完'],
          isEstimatedFromMarketplaces: true,
        };

        const geminiReply = await generateGeminiChatResponse({
          userMessage: `バーコード（${targetBarcode}）の化粧品をスキャンしましたがDBに見つかりませんでした。Amazon、楽天市場、Olive Young、Sephoraなどの公開情報を探索し、該当する製品名と全成分を特定して敏感肌リスクを解説してください。`,
          contextData: { missingIngredientsProduct: dummyProduct },
        });

        return NextResponse.json({
          reply: geminiReply,
          quickReplies: ['🔍 商品名で検索する', '📝 全成分を直接入力する', '📸 別のバーコードをスキャン'],
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

    // 3. 差分分析（あぶり出し）実行の場合
    if (
      action === 'differential' ||
      userText.includes('比較') ||
      userText.includes('あぶり出し') ||
      userText.includes('原因特定')
    ) {
      if (!routine || routine.badProducts.length === 0) {
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

    // 4. 一般テキスト入力からのインテリジェント判定
    // A. 挨拶や一般的な相談・サービス目的の質問の場合
    if (isGreetingOrConsultation(userText)) {
      const suggestions = await searchCosmeticsLive('', 6);
      const explanation = getServicePurposeExplanation(userText);
      return NextResponse.json({
        reply: explanation,
        productSuggestions: suggestions,
        quickReplies: [
          '🧴 肌荒れしたコスメを入力する',
          '✅ 普段使えているコスメを入力する',
          '📸 バーコードをスキャンする',
          '🔍 キュレルの泡洗顔を調べる',
        ],
      });
    }

    // B. 全入力に対する動的コスメ探索（肌トラブル・カテゴリ・成分・ブランド・製品名など）
    const matchedProducts = await searchCosmeticsLive(userText, 6);

    // C. 成分に関する直接的な質問かチェック
    const isIngredientQuestion = KNOWN_INGREDIENTS.some(
      (ing) =>
        userText.includes(ing.nameJa) ||
        ing.aliases.some((a) => a.length >= 2 && userText.toLowerCase().includes(a.toLowerCase()))
    );

    if (isIngredientQuestion) {
      const geminiReply = await generateGeminiChatResponse({
        userMessage: userText,
        contextData: {
          matchedProducts: matchedProducts.length > 0 ? matchedProducts : undefined,
        },
      });

      return NextResponse.json({
        reply: geminiReply,
        productSuggestions: matchedProducts,
        quickReplies: ['🔍 この成分が入っていないコスメを探す', '📸 バーコードをスキャンする', '⚠️ 他の注意成分は？'],
      });
    }

    // D. 肌トラブルの相談・コスメの選び方・製品名入力など
    const geminiReply = await generateGeminiChatResponse({
      userMessage: userText,
      contextData: { matchedProducts },
    });

    const quickReplies =
      matchedProducts.length > 0
        ? [
            '🚨 この中のアイテムで肌荒れした',
            '✅ この中のアイテムは安全に使えた',
            '📸 バーコードで読み取る',
            '🔍 別のキーワードで調べる',
          ]
        : [
            '🔍 具体的な商品名で再検索',
            '📸 バーコードをスキャンする',
            '🧴 キュレルの泡洗顔を調べる',
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
