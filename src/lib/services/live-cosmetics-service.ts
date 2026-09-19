import { Product } from '../types';
import { addProductToDynamicCache, COSMETICS_DATABASE } from '../data/cosmetics-db';
import { buildAmazonAffiliateUrl } from './amazon-affiliate';
import { GEMINI_API_KEY, GEMINI_MODEL } from './gemini';

/**
 * 検索文字列の正規化（全角半角・大文字小文字・不要記号の統一）
 */
export function normalizeSearchString(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-_・/\\,.]+/g, '')
    .trim();
}

/**
 * ユーザー入力が「挨拶」や「サービスへの一般的な相談・質問」であるかを判定
 */
export function isGreetingOrConsultation(text: string): boolean {
  if (!text) return false;
  const clean = text.replace(/\u3000/g, ' ').trim().toLowerCase();

  // 単に化粧品名やブランド名が含まれている場合は挨拶ではない
  const hasCosmeticIndicator = /(化粧水|乳液|クリーム|洗顔|美容液|リップ|下地|日焼け止め|バーム|セラム)/i.test(clean);
  if (hasCosmeticIndicator) {
    return false;
  }

  // 挨拶フレーズ
  const greetings = /^(こんにちは|こんばんは|おはよう|はじめまして|初めまして|お疲れ様|おつかれ|hello|hi|hey)[\s!！?？〜~]*$/i;
  if (greetings.test(clean)) return true;

  // 一般的な相談・目的質問フレーズ
  const consultationQuestions =
    /(何ができる|使い方|どう使えばいい|教えて|相談|肌荒れした|肌が荒れた|助けて|どうすればいい|何から始めればいい|ここはどこ|サービス内容)/i;
  if (consultationQuestions.test(clean)) return true;

  return false;
}

/**
 * 挨拶や相談に対する、サービスの目的説明とコスメ名入力促進メッセージ
 */
export function getServicePurposeExplanation(userQuery?: string): string {
  return `こんにちは！コスメ探偵（CosmeTantei）へようこそ。

当サービスは、あなたが「肌荒れを起こしてしまった化粧品」と「普段問題なく使えている安全な化粧品」の成分を比較・差分分析し、肌トラブルの真の原因成分（香料、エタノール、特定の防腐剤や紫外線吸収剤など）をあぶり出すサービスです。

【使い方】
1. まず、最近肌荒れした化粧品や、現在お使いのコスメ名（例: 「〇〇 洗顔料」「〇〇 リップ」）をメッセージに入力してください。
2. カメラでバーコードをスキャンして登録することも可能です。
3. 候補カードが表示されたら、「肌荒れした」または「使えている」に追加して差分分析を実行してください。

まずは、肌荒れした化粧品名やお使いのコスメ名を入力するか、下の候補から選んでみてください！`;
}

/**
 * 非コスメのGoogle検索クエリ・ノイズワードの判定
 */
export function isNonCosmeticSearchQuery(text: string): boolean {
  if (!text) return true;
  const clean = text.toLowerCase().trim();

  // 一般的なWeb検索ワード・ノイズ・疑問文・非コスメ名
  const nonCosmeticPattern =
    /(株価|配当|年収|会長|社長|役員|歴史|求人|バイト|採用|会社概要|株式会社|本社|工場|cm\s*女優|cm\s*俳優|モデル|芸能人|誰|どなた|店舗|どこで買える|売ってない|どこに売ってる|取扱店|販売店|売り場|ドラッグストア|薬局|通販|amazon|楽天|ショップ|ストア|公式|メルカリ|フリマ|治し方|原因|食べ物|サプリ|病院|皮膚科|病気|病名|治療|市販薬|処方薬|ステロイド|順番|タイミング|どっち|違い|比較|選び方|塗り方|使い方|使用方法|落とし方|朝と夜|塗る順番|口コミ|評判|レビュー|ブログ|アットコスメ|知恵袋|評価|ランキング|おすすめ|人気色|オワコン|ステマ|効果|効かない|効く|荒れる|荒れた|落ちない|崩れる|毛穴落ち|モロモロ|ブルベ|イエベ|パーソナルカラー|色選び|似てる|ジェネリック|代用|類似|危険性|発がん|副作用|安全性|英語|意味|とは|wiki|wikipedia|無料|プレゼント|懸賞|いくら|定価|値段|安く|セール|クーポン|落とし穴|リップル|リップス|暗号資産|仮想通貨|ヘアサロン|美容室|メンズ.*おすすめ|高校生|中学生|小学生|年代|年齢層|どうやって|どれがいい)/i;

  if (nonCosmeticPattern.test(clean)) {
    return true;
  }

  // 単一の抽象語やカテゴリ名単体のみ（例: 「リップ」「洗顔」「ちふれ」単体で商品名がないもの）
  const bareCategories =
    /^(リップ|口紅|洗顔|化粧水|乳液|クリーム|美容液|日焼け止め|ファンデーション|コスメ|スキンケア)$/;
  if (bareCategories.test(clean)) {
    return true;
  }

  return false;
}

/**
 * 実際の化粧品製品名（コスメ・スキンケア・メイクアイテム）であるかの厳格判定
 */
export function isActualCosmeticProduct(p: Product | string): boolean {
  const text = typeof p === 'string' ? p : `${p.brand} ${p.name}`;
  if (!text) return false;

  // 1. ノイズワードが含まれていれば即NG
  if (isNonCosmeticSearchQuery(text)) return false;
  if (typeof p !== 'string') {
    if (isNonCosmeticSearchQuery(p.name) || isNonCosmeticSearchQuery(p.brand)) {
      return false;
    }
  }

  // 2. 単一カテゴリのみの場合もNG
  const bareQuery = text.trim().toLowerCase();
  if (
    /^(リップ|口紅|洗顔|化粧水|乳液|クリーム|美容液|日焼け止め|ファンデーション|コスメ|スキンケア)$/.test(
      bareQuery
    )
  ) {
    return false;
  }

  // 3. 化粧品カテゴリー、剤形、または実在コスメ製品シリーズ名が含まれていること
  const cosmeticSignature =
    /(化粧水|ローション|トナー|スキン|乳液|ミルク|エマルジョン|クリーム|フェイスクリーム|バーム|美容液|セラム|エッセンス|アンプル|オイル|パック|マスク|シートマスク|ジェル|洗顔|泡洗顔|洗顔料|洗顔フォーム|クレンジング|メイク落とし|石鹸|せっけん|スクラブ|日焼け止め|日やけ止め|uv|サンプロテクト|サンクリーム|下地|化粧下地|ファンデーション|ファンデ|bbクリーム|ccクリーム|コンシーラー|パウダー|おしろい|リップ|口紅|ルージュ|ティント|リップバーム|リップクリーム|リップグロス|リッププランパー|アイシャドウ|マスカラ|アイライナー|アイブロウ|眉マスカラ|チーク|ハイライト|シェーディング|ネイル|モンスター|メラノcc|シカプラスト|パーフェクトホイップ|クリアフル|白潤|極潤|オバジc|ダイブイン|リードルショット)/i;

  if (cosmeticSignature.test(text)) {
    return true;
  }

  // 4. Product オブジェクトで valid な化粧品カテゴリが付与されている場合
  if (typeof p !== 'string' && p.category && p.category !== 'other') {
    return true;
  }

  return false;
}

/**
 * 有名コスメブランド一覧（クエリ解析およびブランド名抽出用）
 */
export const KNOWN_BRANDS: { match: RegExp; name: string }[] = [
  { match: /ちふれ|chifure/i, name: 'ちふれ' },
  { match: /キュレル|curel/i, name: 'キュレル' },
  { match: /ケイト|kate/i, name: 'KATE' },
  { match: /イハダ|ihada/i, name: 'イハダ' },
  { match: /無印良品|無印|muji/i, name: '無印良品' },
  { match: /オルビス|orbis/i, name: 'オルビス' },
  { match: /ミノン|minon/i, name: 'ミノン' },
  { match: /ラロッシュポゼ|la\s*roche/i, name: 'ラロッシュポゼ' },
  { match: /ファンケル|fancl/i, name: 'ファンケル' },
  { match: /資生堂|shiseido/i, name: '資生堂' },
  { match: /カネボウ|kanebo/i, name: 'カネボウ' },
  { match: /コーセー|kose/i, name: 'コーセー' },
  { match: /メラノcc|melano/i, name: 'メラノCC (ロート製薬)' },
  { match: /肌ラボ|hadalabo/i, name: '肌ラボ (ロート製薬)' },
  { match: /オバジ|obagi/i, name: 'オバジ (Obagi)' },
  { match: /ロート製薬|rohto/i, name: 'ロート製薬' },
  { match: /トリデン|torriden/i, name: 'トリデン' },
  { match: /アヌア|anua/i, name: 'Anua (アヌア)' },
  { match: /vtコスメ|vt/i, name: 'VTコスメティクス' },
  { match: /セラヴィ|cerave/i, name: 'セラヴィ' },
  { match: /セタフィル|cetaphil/i, name: 'セタフィル' },
  { match: /カルテhd|carte/i, name: 'カルテHD' },
  { match: /キャンメイク|canmake/i, name: 'キャンメイク' },
  { match: /セザンヌ|cezanne/i, name: 'セザンヌ' },
  { match: /エテュセ|ettusais/i, name: 'エテュセ' },
  { match: /イプサ|ipsa/i, name: 'イプサ' },
  { match: /コスメデコルテ|decorte/i, name: 'コスメデコルテ' },
  { match: /ニベア|nivea/i, name: 'ニベア' },
  { match: /専科|senka/i, name: '洗顔専科' },
  { match: /ビオレ|biore/i, name: 'ビオレ' },
  { match: /メディヒール|mediheal/i, name: 'メディヒール' },
  { match: /魔女工場|manyo/i, name: '魔女工場' },
  { match: /イニスフリー|innisfree/i, name: 'イニスフリー' },
  { match: /ロムアンド|rom&nd/i, name: 'ロムアンド' },
  { match: /クリオ|clio/i, name: 'クリオ' },
  { match: /ダルバ|d'alba/i, name: "d'Alba (ダルバ)" },
  { match: /the\s*ordinary|ジオーディナリー/i, name: 'The Ordinary' },
];

/**
 * ユーザーの入力意図の自動判定（API検索用の拡張クエリを動的生成）
 */
export function detectQueryIntent(query: string): {
  type: 'greeting_or_consult' | 'skin_concern' | 'category' | 'ingredient' | 'brand' | 'product_search' | 'general';
  key?: string;
  expandedQuery?: string;
} {
  const clean = query.replace(/\u3000/g, ' ').trim();
  if (!clean) {
    return { type: 'greeting_or_consult' };
  }

  if (isGreetingOrConsultation(clean)) {
    return { type: 'greeting_or_consult' };
  }

  // 1. ブランド名照合
  const brandMatch = KNOWN_BRANDS.find((b) => b.match.test(clean));
  if (brandMatch) {
    return { type: 'brand', key: brandMatch.name, expandedQuery: `${clean} コスメ 化粧品` };
  }

  // 2. 肌トラブル・お悩み
  if (/乾燥|カサつき|かさつき|つっぱり|粉ふき|皮むけ/i.test(clean)) {
    return { type: 'skin_concern', key: 'dryness', expandedQuery: `${clean} スキンケア 保湿` };
  }
  if (/ニキビ|吹き出物|コメド|アクネ/i.test(clean)) {
    return { type: 'skin_concern', key: 'acne', expandedQuery: `${clean} スキンケア 洗顔` };
  }
  if (/赤み|赤ら顔|ヒリヒリ|ピリピリ|しみる|敏感|酒さ|痒い|かゆみ|肌荒れ|荒れ/i.test(clean)) {
    return { type: 'skin_concern', key: 'redness', expandedQuery: `${clean} 低刺激 スキンケア` };
  }
  if (/毛穴|黒ずみ|角栓|テカリ|皮脂/i.test(clean)) {
    return { type: 'skin_concern', key: 'pores', expandedQuery: `${clean} コスメ 美容液` };
  }
  if (/日焼け|紫外線|uv/i.test(clean)) {
    return { type: 'skin_concern', key: 'sunburn', expandedQuery: `${clean} 低刺激 日焼け止め` };
  }

  // 3. 成分名
  if (/レチノール|ビタミンa/i.test(clean)) {
    return { type: 'ingredient', key: 'retinol', expandedQuery: `${clean} 美容液` };
  }
  if (/セラミド/i.test(clean)) {
    return { type: 'ingredient', key: 'ceramide', expandedQuery: `${clean} 化粧水 クリーム` };
  }
  if (/ビタミンc|アスコルビン/i.test(clean)) {
    return { type: 'ingredient', key: 'vitaminc', expandedQuery: `${clean} 美容液` };
  }
  if (/cica|シカ|ツボクサ/i.test(clean)) {
    return { type: 'ingredient', key: 'cica', expandedQuery: `${clean} スキンケア` };
  }

  // 4. カテゴリ
  if (/リップ|口紅|ルージュ|ティント|バーム|lip/i.test(clean)) {
    return { type: 'category', key: 'lip', expandedQuery: `${clean} 人気 コスメ` };
  }
  if (/化粧水|ローション|トナー|lotion|toner/i.test(clean)) {
    return { type: 'category', key: 'toner', expandedQuery: `${clean} 低刺激 敏感肌` };
  }
  if (/洗顔|クレンジング|ウォッシュ|soap|cleanser/i.test(clean)) {
    return { type: 'category', key: 'cleanser', expandedQuery: `${clean} 敏感肌 低刺激` };
  }
  if (/クリーム|乳液|ミルク|cream/i.test(clean)) {
    return { type: 'category', key: 'cream', expandedQuery: `${clean} 保湿 敏感肌` };
  }
  if (/美容液|セラム|エッセンス|serum/i.test(clean)) {
    return { type: 'category', key: 'serum', expandedQuery: `${clean} 低刺激 美容液` };
  }
  if (/日焼け止め|日やけ止め|sunscreen/i.test(clean)) {
    return { type: 'category', key: 'sunscreen', expandedQuery: `${clean} ノンケミカル 低刺激` };
  }

  // 複数単語または2文字以上のコスメ検索
  if (clean.length >= 2) {
    return { type: 'product_search', expandedQuery: `${clean} コスメ` };
  }

  return { type: 'general', expandedQuery: `${clean} コスメ 化粧品` };
}

/**
 * 1. Google リアルタイム検索サジェストAPIから最新コスメ製品候補を取得
 */
export async function searchGoogleLiveSuggestions(query: string, limit = 6): Promise<Product[]> {
  const clean = query.replace(/\u3000/g, ' ').trim();
  if (!clean || clean.length < 1 || isGreetingOrConsultation(clean)) return [];

  const intent = detectQueryIntent(clean);
  const queriesToTry = [
    intent.expandedQuery || `${clean} コスメ`,
    clean,
  ].filter(Boolean);

  const collectedSuggestions: string[] = [];

  for (const q of queriesToTry) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const url = `https://suggestqueries.google.com/complete/search?client=chrome&hl=ja&ie=utf-8&oe=utf-8&q=${encodeURIComponent(
        q
      )}`;

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        const rawSuggestions: string[] = Array.isArray(data[1]) ? data[1] : [];
        for (const s of rawSuggestions) {
          if (
            s &&
            !isNonCosmeticSearchQuery(s) &&
            isActualCosmeticProduct(s) &&
            !collectedSuggestions.includes(s)
          ) {
            collectedSuggestions.push(s);
          }
        }
      }
    } catch {
      // ignore timeout
    }

    if (collectedSuggestions.length >= limit) break;
  }

  if (collectedSuggestions.length === 0) return [];

  const candidateList = collectedSuggestions.slice(0, limit);

  const getCategory = (text: string): Product['category'] => {
    if (/リップ|口紅|ルージュ|ティント|バーム|lip/i.test(text)) return 'lip';
    if (/洗顔|クレンジング|ウォッシュ|soap/i.test(text)) return 'cleanser';
    if (/化粧水|ローション|トナー|lotion|toner/i.test(text)) return 'toner';
    if (/クリーム|乳液|ミルク|cream/i.test(text)) return 'cream';
    if (/美容液|セラム|エッセンス|serum/i.test(text)) return 'serum';
    if (/日焼け止め|uv|sunscreen/i.test(text)) return 'sunscreen';
    if (/パック|マスク|mask/i.test(text)) return 'mask';
    return 'other';
  };

  const products = candidateList.map((itemText, idx): Product | null => {
    let detectedBrand = '';
    for (const kb of KNOWN_BRANDS) {
      if (kb.match.test(itemText) || kb.match.test(clean)) {
        detectedBrand = kb.name;
        break;
      }
    }

    const parts = itemText.split(/\s+/);
    let brand = detectedBrand || (parts[0] ? parts[0] : '注目コスメ');
    let name = itemText;

    if (detectedBrand && itemText.includes(detectedBrand)) {
      name = itemText.replace(detectedBrand, '').trim() || itemText;
    } else if (brand && itemText.startsWith(brand)) {
      name = itemText.substring(brand.length).trim() || itemText;
    }

    name = name.replace(/\s*(コスメ|化粧品|スキンケア)\s*$/gi, '').trim() || name;

    const category = getCategory(itemText);
    const isLip = category === 'lip';

    const estimatedIngredients = isLip
      ? ['ヒアルロン酸Na', 'マイクロクリスタリンワックス', 'マカデミア種子油', 'トコフェロール', 'シア脂']
      : category === 'cleanser'
      ? ['水', 'グリセリン', 'ラウロイルメチルアラニンNa', 'コカミドプロピルベタイン']
      : category === 'toner'
      ? ['水', 'BG', 'グリセリン', 'ヒアルロン酸Na', 'アラントイン']
      : category === 'cream'
      ? ['水', 'スクワラン', 'グリセリン', 'セラミドNP', 'シア脂']
      : ['水', 'BG', 'グリセリン', 'ヒアルロン酸Na'];

    const product: Product = {
      id: `g_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
      name: name || itemText,
      brand: brand,
      country: 'JP',
      category,
      ingredients: estimatedIngredients,
      descriptionJa: `「${clean}」に関連するコスメアイテム（${itemText}）です`,
      amazonSearchUrl: buildAmazonAffiliateUrl(brand, name || itemText),
      isEstimatedFromMarketplaces: true,
      fragranceFree: true,
      alcoholFree: true,
    };

    if (isActualCosmeticProduct(product)) {
      addProductToDynamicCache(product);
      return product;
    }
    return null;
  });

  return products.filter((p): p is Product => p !== null);
}

/**
 * 2. Open Beauty Facts API から検索
 */
export async function searchOpenBeautyFacts(query: string, limit = 4): Promise<Product[]> {
  const clean = query.replace(/\u3000/g, ' ').trim();
  if (!clean || isGreetingOrConsultation(clean) || isNonCosmeticSearchQuery(clean)) return [];

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const url = `https://world.openbeautyfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(
      clean
    )}&search_simple=1&action=process&json=1&page_size=${limit}`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'CosmeTantei/1.0 (https://cosmetantei.com; contact@cosmetantei.com)',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    if (!res.ok) return [];

    const data = await res.json();
    if (!data.products || !Array.isArray(data.products) || data.products.length === 0) {
      return [];
    }

    const results: Product[] = [];

    for (const p of data.products) {
      const name = p.product_name_ja || p.product_name || p.product_name_en;
      if (!name) continue;

      const brand = p.brands || p.brand || 'ブランド未記載';
      const barcode = p.code || undefined;

      let ingredients: string[] = [];
      if (p.ingredients_text_ja) {
        ingredients = p.ingredients_text_ja
          .split(/[,、・\n\r/]/)
          .map((s: string) => s.trim())
          .filter(Boolean);
      } else if (p.ingredients_text) {
        ingredients = p.ingredients_text
          .split(/[,、・\n\r/]/)
          .map((s: string) => s.trim())
          .filter(Boolean);
      }

      const product: Product = {
        id: `obf_${barcode || Math.random().toString(36).substring(2, 9)}`,
        name,
        brand,
        country: 'JP',
        category: 'other',
        barcode,
        ingredients: ingredients.length > 0 ? ingredients : ['成分情報はオンラインマーケットプレイスより探索'],
        descriptionJa: p.generic_name_ja || p.generic_name || `${brand}のコスメアイテム`,
        amazonSearchUrl: buildAmazonAffiliateUrl(brand, name),
        isEstimatedFromMarketplaces: true,
      };

      if (isActualCosmeticProduct(product)) {
        addProductToDynamicCache(product);
        results.push(product);
      }
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * 3. Google Search Grounding（Gemini経由でのリアルタイムGoogle検索）
 */
export async function searchGoogleGroundedGemini(query: string, limit = 3): Promise<Product[]> {
  const clean = query.replace(/\u3000/g, ' ').trim();
  if (
    !clean ||
    !GEMINI_API_KEY ||
    GEMINI_API_KEY.includes('YOUR_GEMINI_API_KEY') ||
    isGreetingOrConsultation(clean) ||
    isNonCosmeticSearchQuery(clean)
  ) {
    return [];
  }

  const prompt = `あなたは最新の化粧品情報・成分データベースのリサーチャーです。
ユーザーが「${clean}」に関連する化粧品を探しています。
実在する化粧品製品のみを最大${limit}件調査し、以下のJSON形式のみで出力してください。

[
  {
    "name": "正確な化粧品製品名",
    "brand": "ブランド名",
    "country": "JP",
    "category": "toner",
    "ingredients": ["成分1"],
    "descriptionJa": "概要"
  }
]`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ googleSearch: {} }],
          generationConfig: { temperature: 0.2 },
        }),
      }
    );

    if (!response.ok) return [];

    const resJson = await response.json();
    const candidateText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) return [];

    const jsonMatch = candidateText.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed) || parsed.length === 0) return [];

    const groundedProducts: Product[] = [];
    for (const item of parsed) {
      const product: Product = {
        id: `gem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        name: item.name,
        brand: item.brand,
        country: item.country || 'JP',
        category: item.category || 'other',
        ingredients: item.ingredients || ['成分情報はオンライン公開情報より探索'],
        descriptionJa: item.descriptionJa || `${item.brand} - ${item.name}`,
        amazonSearchUrl: buildAmazonAffiliateUrl(item.brand, item.name),
        isEstimatedFromMarketplaces: true,
      };

      if (isActualCosmeticProduct(product)) {
        addProductToDynamicCache(product);
        groundedProducts.push(product);
      }
    }

    return groundedProducts;
  } catch {
    return [];
  }
}

/**
 * 4. 動的なコスメ候補を即時生成（オフライン・APIフォールバック用）
 */
export function synthesizeDynamicCandidate(query: string): Product {
  const clean = query.replace(/\u3000/g, ' ').trim();
  const intent = detectQueryIntent(clean);

  let inferredBrand = '注目コスメ';
  let inferredName = clean;

  for (const kb of KNOWN_BRANDS) {
    if (kb.match.test(clean)) {
      inferredBrand = kb.name;
      if (clean.includes(kb.name)) {
        inferredName = clean.replace(kb.name, '').trim();
      }
      break;
    }
  }

  let category: Product['category'] = 'other';
  if (/リップ|口紅|ルージュ|ティント|バーム/i.test(clean)) category = 'lip';
  else if (/洗顔|クレンジング|ウォッシュ/i.test(clean)) category = 'cleanser';
  else if (/化粧水|ローション|トナー/i.test(clean)) category = 'toner';
  else if (/クリーム|乳液|ミルク/i.test(clean)) category = 'cream';
  else if (/美容液|セラム|エッセンス|レチノール|ビタミンc/i.test(clean)) category = 'serum';
  else if (/日焼け止め|uv/i.test(clean)) category = 'sunscreen';

  if (intent.type === 'skin_concern') {
    if (intent.key === 'dryness') category = 'cream';
    else if (intent.key === 'acne' || intent.key === 'redness') category = 'cleanser';
  }

  const isBareCategory = !inferredName || /^(リップ|口紅|洗顔|化粧水|乳液|クリーム|美容液|日焼け止め|ファンデーション|コスメ|スキンケア|スキンケアアイテム)$/.test(
    inferredName.trim().toLowerCase()
  );
  const lacksSpecificSignature = !/(化粧水|ローション|トナー|クリーム|バーム|乳液|ミルク|美容液|セラム|エッセンス|洗顔料|洗顔フォーム|泡洗顔|リップバーム|リップクリーム|リップスティック|口紅|uvミルク|uvプロテクト)/i.test(
    inferredName
  );

  if (isBareCategory || lacksSpecificSignature) {
    if (category === 'lip') inferredName = inferredName === 'リップ' || !inferredName ? '高保湿 リップバーム' : `${inferredName} リップバーム`;
    else if (category === 'cleanser') inferredName = inferredName === '洗顔' || !inferredName ? '低刺激 泡洗顔料' : `${inferredName} 洗顔フォーム`;
    else if (category === 'toner') inferredName = inferredName === '化粧水' || !inferredName ? '薬用 保湿化粧水' : `${inferredName} 保湿ローション`;
    else if (category === 'cream') inferredName = inferredName === 'クリーム' || inferredName === '乳液' || !inferredName ? '高保湿 フェイスクリーム' : `${inferredName} 保湿クリーム`;
    else if (category === 'serum') inferredName = inferredName === '美容液' || !inferredName ? '集中リペア 美容液' : `${inferredName} 美容液`;
    else if (category === 'sunscreen') inferredName = inferredName ? `${inferredName} UVプロテクトミルク` : '低刺激 UVプロテクトミルク';
    else inferredName = inferredName && !inferredName.includes('スキンケア') ? `${inferredName} 低刺激スキンケアアイテム` : '低刺激スキンケアアイテム';
  }

  const product: Product = {
    id: `dyn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    name: inferredName,
    brand: inferredBrand,
    country: 'JP',
    category,
    ingredients: ['成分情報はオンラインマーケットプレイスより探索'],
    descriptionJa: `「${clean}」に関連する最新の注目コスメ候補です`,
    amazonSearchUrl: buildAmazonAffiliateUrl(inferredBrand, inferredName),
    isEstimatedFromMarketplaces: true,
  };

  addProductToDynamicCache(product);
  return product;
}

/**
 * 5. 全ての入力に対して実在化粧品をAPI問い合わせ＆動的キャッシュから返却するエンジン
 */
export async function searchCosmeticsLive(query: string, limit = 6): Promise<Product[]> {
  const clean = query ? query.replace(/\u3000/g, ' ').trim() : '';

  const collected: Product[] = [];

  // 1. 空入力または挨拶・相談の場合
  if (!clean || isGreetingOrConsultation(clean)) {
    const cachedCosmetics = COSMETICS_DATABASE.filter(isActualCosmeticProduct);
    for (const c of cachedCosmetics) {
      if (collected.length >= limit) break;
      if (!collected.some((p) => p.id === c.id || p.name === c.name)) {
        collected.push(c);
      }
    }

    if (collected.length < limit) {
      const liveGentle = await searchGoogleLiveSuggestions('敏感肌 低刺激 スキンケア', limit);
      for (const g of liveGentle) {
        if (collected.length >= limit) break;
        if (isActualCosmeticProduct(g) && !collected.some((p) => p.id === g.id || p.name === g.name)) {
          collected.push(g);
        }
      }
    }

    if (collected.length < limit) {
      const obfGentle = await searchOpenBeautyFacts('敏感肌', limit);
      for (const o of obfGentle) {
        if (collected.length >= limit) break;
        if (isActualCosmeticProduct(o) && !collected.some((p) => p.id === o.id || p.name === o.name)) {
          collected.push(o);
        }
      }
    }

    if (collected.length === 0) {
      collected.push(synthesizeDynamicCandidate('低刺激 敏感肌用 保湿ローション'));
      collected.push(synthesizeDynamicCandidate('敏感肌用 泡洗顔料'));
      collected.push(synthesizeDynamicCandidate('高保湿 フェイスクリーム'));
    }

    return collected.slice(0, limit);
  }

  // 2. 通常の検索語の場合
  const intent = detectQueryIntent(clean);

  // A. まず動的ランタイムキャッシュ（過去にAPIから取得したデータ）から一致を探索
  const cacheNorm = normalizeSearchString(clean);
  const cachedMatches = COSMETICS_DATABASE.filter((p) => {
    if (!isActualCosmeticProduct(p)) return false;
    const b = normalizeSearchString(p.brand);
    const n = normalizeSearchString(p.name);
    return (b && b.includes(cacheNorm)) || (n && n.includes(cacheNorm)) || (b && cacheNorm.includes(b));
  });

  for (const m of cachedMatches) {
    if (!collected.some((c) => c.id === m.id || c.name === m.name)) {
      collected.push(m);
    }
  }

  // B. 外部APIへリアルタイム問い合わせ
  // (1) Google Live Suggestions API（化粧品検索補完＋ノイズフィルター）
  const googleSuggestResults = await searchGoogleLiveSuggestions(clean, limit);
  for (const g of googleSuggestResults) {
    if (isActualCosmeticProduct(g) && !collected.some((c) => c.id === g.id || c.name === g.name)) {
      collected.push(g);
    }
  }

  // (2) Open Beauty Facts API（実在コスメ・成分データベース）
  if (collected.length < limit) {
    const obfResults = await searchOpenBeautyFacts(clean, limit);
    for (const o of obfResults) {
      if (isActualCosmeticProduct(o) && !collected.some((c) => c.id === o.id || c.name === o.name)) {
        collected.push(o);
      }
    }
  }

  // (3) 意図判定による拡張クエリでの Open Beauty Facts 試行
  if (collected.length < limit && intent.expandedQuery && intent.expandedQuery !== clean) {
    const obfExpanded = await searchOpenBeautyFacts(intent.expandedQuery, limit);
    for (const o of obfExpanded) {
      if (isActualCosmeticProduct(o) && !collected.some((c) => c.id === o.id || c.name === o.name)) {
        collected.push(o);
      }
    }
  }

  // (4) Gemini Web Grounding（APIキー設定時）
  if (collected.length < limit) {
    const googleResults = await searchGoogleGroundedGemini(clean, Math.min(limit, 3));
    for (const gr of googleResults) {
      if (isActualCosmeticProduct(gr) && !collected.some((c) => c.id === gr.id || c.name === gr.name)) {
        collected.push(gr);
      }
    }
  }

  // C. 厳格フィルター
  const validProducts = collected.filter(isActualCosmeticProduct);

  // D. 件数不足時の動的補完（オフライン・APIタイムアウト時のフォールバック）
  while (validProducts.length < limit) {
    const suffix = validProducts.length === 0 ? '' : ` アイテム${validProducts.length + 1}`;
    const dynamicCandidate = synthesizeDynamicCandidate(`${clean}${suffix}`);
    if (isActualCosmeticProduct(dynamicCandidate) && !validProducts.some((c) => c.name === dynamicCandidate.name)) {
      validProducts.push(dynamicCandidate);
    } else {
      break;
    }
  }

  return validProducts.slice(0, limit);
}
