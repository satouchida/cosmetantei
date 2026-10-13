import { Product } from '../types';
import {
  addProductToDynamicCache,
  COSMETICS_DATABASE,
  isVerifiedSource,
  rememberVerifiedProducts,
} from '../data/cosmetics-db';
import { buildAmazonAffiliateUrl } from './amazon-affiliate';
import { LABEL_FORMAT, labelProductFields, parseIngredientLabel } from '../analyzer/label-parser';
import { isKnownGenericTerm } from './brand-check';
import { researchProducts, toProductSearchQuery } from './web-research';
import { getDisplayBrand as getDisplayBrandWith } from '../display-brand';
import { filterSearchResults } from './search-filter';

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
export function getServicePurposeExplanation(): string {
  return `こんにちは！コスメ探偵（CosmeTantei）へようこそ。

当サービスは、あなたが「肌荒れを起こしてしまった化粧品」と「普段問題なく使えている安全な化粧品」の全成分を比較・差分分析し、肌トラブルの真の原因成分（香料、エタノール、特定の防腐剤や紫外線吸収剤など）をあぶり出すサービスです。

【使い方】
1. まず、最近肌荒れした化粧品や、現在お使いのコスメ名（例: 「キュレル 泡洗顔料」「ちふれ 口紅」など）をメッセージに入力してください。
2. カメラでバーコードをスキャンして登録することも可能です。
3. 実在するコスメ候補が表示されたら、「肌荒れした」または「安全に使えている」に追加して差分分析を実行してください。

まずは、肌荒れした化粧品名やお使いのコスメ名を入力するか、下の実在コスメ候補から選んでみてください！`;
}

/**
 * 非コスメのGoogle検索クエリ・ノイズワードの判定
 */
export function isNonCosmeticSearchQuery(text: string): boolean {
  if (!text) return true;
  const clean = text.toLowerCase().trim();

  // 一般的なWeb検索ワード・ノイズ・疑問文・非コスメ名
  const nonCosmeticPattern =
    /(株価|配当|年収|会長|社長|役員|歴史|求人|バイト|採用|会社概要|株式会社|本社|工場|cm\s*女優|cm\s*俳優|モデル|芸能人|誰|どなた|店舗|どこで買える|売ってない|どこに売ってる|取扱店|販売店|売り場|ドラッグストア|薬局|通販|amazon|楽天|ショップ|ストア|公式|メルカリ|フリマ|治し方|原因|食べ物|サプリ|病院|皮膚科|病気|病名|治療|市販薬|処方薬|ステロイド|順番|タイミング|どっち|違い|比較|選び方|塗り方|使い方|使用方法|落とし方|洗い方|朝と夜|塗る順番|口コミ|評判|レビュー|ブログ|アットコスメ|知恵袋|評価|ランキング|おすすめ|人気色|オワコン|ステマ|効果|効かない|効く|荒れる|荒れた|落ちない|崩れる|毛穴落ち|モロモロ|ブルベ|イエベ|パーソナルカラー|色選び|似てる|ジェネリック|代用|類似|危険性|発がん|副作用|安全性|英語|意味|とは|wiki|wikipedia|無料|プレゼント|懸賞|いくら|定価|値段|安く|セール|クーポン|落とし穴|リップル|リップス(?![ティク])|暗号資産|仮想通貨|ヘアサロン|美容室|メンズ.*おすすめ|高校生|中学生|小学生|年代|年齢層|どうやって|どれがいい|少ない|多い|ない|すみしょう|かずのすけ|youtuber|youtube)/i;

  if (nonCosmeticPattern.test(clean)) {
    return true;
  }

  // 検索サジェストで末尾や語間に単なる肌悩み・検索単語が付いているだけの非製品クエリ
  // 例: 「炭 洗顔 敏感 肌」「泡洗顔 角栓」「泡洗顔 炭酸泡」
  const querySuffixPattern =
    /[\s\-_・/](少ない|多い|すみしょう|かずのすけ|角栓|黒ずみ|いちご鼻|テカリ|皮脂|敏感\s*肌|乾燥\s*肌|脂性\s*肌|混合\s*肌|ニキビ|赤み|炭酸\s*泡|炭酸\s*洗顔|毛穴汚れ)$/i;

  if (querySuffixPattern.test(clean)) {
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
 * 化粧品の一般名詞であるかの同期判定（語彙チェック＋判定済みブランドのキャッシュ）
 * ブランド判定の本体は brand-check.ts の judgeBrands（非同期）
 */
export function isGenericCosmeticTerm(text: string): boolean {
  return isKnownGenericTerm(text);
}

/**
 * UI表示用の安全なブランド名取得
 * - 万が一一般名詞や不正ワードが入っていた場合でも、商品名や安全な表記にフォールバック
 */
export function getDisplayBrand(brand?: string, name?: string): string {
  return getDisplayBrandWith(brand, name, isGenericCosmeticTerm);
}

/**
 * 実際の化粧品製品名（コスメ・スキンケア・メイクアイテム）であるかの厳格判定
 * - 架空のブランド名やプレースホルダーは厳格に除外
 * - 単なる検索クエリや疑問文、架空テンプレートは厳格に除外
 * - ブランド名が一般名詞・検索ワードであるものは厳格に除外
 */
export function isActualCosmeticProduct(p: Product | string): boolean {
  if (!p) return false;

  const text = typeof p === 'string' ? p : `${p.brand} ${p.name}`;
  if (!text) return false;

  // 1. ノイズワードが含まれていれば即NG
  if (isNonCosmeticSearchQuery(text)) return false;

  if (typeof p !== 'string') {
    if (isNonCosmeticSearchQuery(p.name) || isNonCosmeticSearchQuery(p.brand)) {
      return false;
    }

    // ブランド名が一般名詞である場合は即NG（Gemini判断）
    if (isGenericCosmeticTerm(p.brand)) {
      return false;
    }

    // 架空ブランド・プレースホルダーの厳格除外
    const FAKE_BRANDS =
      /^(注目コスメ|注目スキンケア|薬用スキンケア|低刺激ラボ|酵素洗顔|ディープクリア|バーコード照合|ブランド未記載|未記載|モイストリップ|プランプケア|カラーケア|無添加ラボ)$/i;
    if (FAKE_BRANDS.test(p.brand.trim())) {
      return false;
    }

    // 架空製品名・テンプレート名・アイテム連番の厳格除外
    const FAKE_NAMES =
      /(炭＆植物スクラブ|薬用 炭クレイ スクラブ|ディープクリア 炭スクラブ|低刺激 炭スクラブ|酵素＆炭スクラブ|アイテム\d+|アイテム \d+)/i;
    if (FAKE_NAMES.test(p.name)) {
      return false;
    }

    // ブランド名と商品名が同一で、かつ単なる一般カテゴリ名の場合
    if (p.brand === p.name && /^(洗顔|化粧水|乳液|クリーム|美容液|リップ|日焼け止め)$/i.test(p.name)) {
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

  return false;
}

/**
 * ユーザーの入力意図の自動判定
 * - 特定ブランドの静的一覧を持たず、入力文字列と自然言語パターンから動的に判定
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

  // 1. 肌トラブル・お悩み
  if (/乾燥|カサつき|かさつき|つっぱり|粉ふき|皮むけ/i.test(clean)) {
    return { type: 'skin_concern', key: 'dryness', expandedQuery: `${clean} 保湿 スキンケア` };
  }
  if (/ニキビ|吹き出物|コメド|アクネ/i.test(clean)) {
    return { type: 'skin_concern', key: 'acne', expandedQuery: `${clean} 洗顔料` };
  }
  if (/赤み|赤ら顔|ヒリヒリ|ピリピリ|しみる|敏感|酒さ|痒い|かゆみ|肌荒れ|荒れ/i.test(clean)) {
    return { type: 'skin_concern', key: 'redness', expandedQuery: `${clean} 低刺激 スキンケア` };
  }
  if (/毛穴|黒ずみ|角栓|テカリ|皮脂/i.test(clean)) {
    return { type: 'skin_concern', key: 'pores', expandedQuery: `${clean} 洗顔 美容液` };
  }
  if (/日焼け|紫外線|uv/i.test(clean)) {
    return { type: 'skin_concern', key: 'sunburn', expandedQuery: `${clean} 日焼け止め` };
  }

  // 2. 成分名
  if (/レチノール|ビタミンa/i.test(clean)) {
    return { type: 'ingredient', key: 'retinol', expandedQuery: `${clean} 美容液` };
  }
  if (/セラミド/i.test(clean)) {
    return { type: 'ingredient', key: 'ceramide', expandedQuery: `${clean} 保湿` };
  }
  if (/ビタミンc|アスコルビン/i.test(clean)) {
    return { type: 'ingredient', key: 'vitaminc', expandedQuery: `${clean} 美容液` };
  }
  if (/cica|シカ|ツボクサ/i.test(clean)) {
    return { type: 'ingredient', key: 'cica', expandedQuery: `${clean} スキンケア` };
  }

  // 3. カテゴリ
  if (/リップ|口紅|ルージュ|ティント|バーム|lip/i.test(clean)) {
    return { type: 'category', key: 'lip', expandedQuery: `${clean} コスメ` };
  }
  if (/化粧水|ローション|トナー|lotion|toner/i.test(clean)) {
    return { type: 'category', key: 'toner', expandedQuery: `${clean} 化粧品` };
  }
  if (/洗顔|クレンジング|ウォッシュ|soap|cleanser/i.test(clean)) {
    return { type: 'category', key: 'cleanser', expandedQuery: `${clean} コスメ` };
  }
  if (/クリーム|乳液|ミルク|cream/i.test(clean)) {
    return { type: 'category', key: 'cream', expandedQuery: `${clean} スキンケア` };
  }
  if (/美容液|セラム|エッセンス|serum/i.test(clean)) {
    return { type: 'category', key: 'serum', expandedQuery: `${clean} 美容液` };
  }
  if (/日焼け止め|日やけ止め|sunscreen/i.test(clean)) {
    return { type: 'category', key: 'sunscreen', expandedQuery: `${clean} 日焼け止め` };
  }

  // 複数単語または2文字以上のコスメ検索
  if (clean.length >= 2) {
    return { type: 'product_search', expandedQuery: `${clean} コスメ` };
  }

  return { type: 'general', expandedQuery: `${clean} コスメ` };
}

/**
 * 1. Open Beauty Facts API から実在コスメを検索
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

      const brand = p.brands || p.brand;
      if (!brand || brand.trim().length === 0) continue;

      const barcode = p.code || undefined;

      const labelText = p.ingredients_text_ja || p.ingredients_text;
      const label = labelProductFields(parseIngredientLabel(typeof labelText === 'string' ? labelText : ''));
      const { ingredients } = label;

      const hasIngredients = ingredients.length > 0;
      const product: Product = {
        id: `obf_${barcode || Math.random().toString(36).substring(2, 9)}`,
        name,
        brand,
        country: 'JP',
        category: 'other',
        barcode,
        // 有効成分だけでは全成分がわからないため、その他の成分が無ければ医薬部外品の項目も使わない
        ...(hasIngredients && label),
        labelFormat: LABEL_FORMAT,
        ingredients: hasIngredients ? ingredients : ['成分情報はオンラインマーケットプレイスより探索'],
        descriptionJa: p.generic_name_ja || p.generic_name || `${brand}のコスメアイテム`,
        amazonSearchUrl: buildAmazonAffiliateUrl(brand, name),
        isEstimatedFromMarketplaces: !hasIngredients,
        ingredientSource: hasIngredients ? 'open_beauty_facts' : undefined,
      };

      if (isActualCosmeticProduct(product)) {
        addProductToDynamicCache(product);
        results.push(product);
      }
    }

    await rememberVerifiedProducts(results);
    return results;
  } catch {
    return [];
  }
}

/** 全成分が確認済みのデータ源（Open Beauty Facts・出典ページ等）から来た候補か */
function hasVerifiedIngredientList(p: Product): boolean {
  return isVerifiedSource(p) && p.ingredients.length > 0;
}

/** 製品名（ブランド名つきも含む）が検索語を含むか。ブランド名だけの一致は数えない */
function namesProduct(p: Product, query: string): boolean {
  const q = normalizeSearchString(query);
  return !!q && (normalizeSearchString(p.name).includes(q) || normalizeSearchString(`${p.brand}${p.name}`).includes(q));
}

/**
 * 3. 代表コスメ・トレンドコスメを生成AIおよび外部APIから動的取得
 * 固定の配列を持たず、リアルタイムに実在する市販コスメを探索・動的キャッシュ
 */
export async function fetchDynamicTrendingCosmetics(
  categoryOrConcern = '低刺激 スキンケア',
  limit = 6
): Promise<Product[]> {
  const clean = categoryOrConcern.trim();
  const collected: Product[] = [];

  // 1. 動的ランタイムキャッシュ（過去に取得された実在コスメ）から優先抽出
  const cached = COSMETICS_DATABASE.filter(isActualCosmeticProduct);
  for (const c of cached) {
    if (collected.length >= limit) break;
    if (!collected.some((p) => p.id === c.id || p.name === c.name)) {
      collected.push(c);
    }
  }

  if (collected.length >= limit) {
    return collected.slice(0, limit);
  }

  // 2. Open Beauty Facts API から動的探索（有料の Web 検索・Gemini は使わない）
  const obfResults = await searchOpenBeautyFacts(clean || 'スキンケア', limit);
  for (const o of obfResults) {
    if (collected.length >= limit) break;
    if (isActualCosmeticProduct(o) && !collected.some((p) => p.id === o.id || p.name === o.name)) {
      collected.push(o);
    }
  }

  // 件数が足りなくても架空の候補は合成しない
  return collected.filter(isActualCosmeticProduct).slice(0, limit);
}

/**
 * 4. 実在するコスメ候補のみを検索・特定して返却するメインエンジン
 * 固定カタログを持たず、動的キャッシュ・Open Beauty Facts・Web リサーチから実在商品のみを返却
 *
 * webResearch: 見つからない場合に Web 検索と出典ページの読み取り（有料）まで行うか。
 * 入力途中の候補表示（/api/products/search）では使わず、チャットで商品名が送られたときだけ使う
 */
export async function searchCosmeticsLive(
  query: string,
  limit = 6,
  options: { webResearch?: boolean } = {}
): Promise<Product[]> {
  const clean = query ? query.replace(/\u3000/g, ' ').trim() : '';

  const collected: Product[] = [];

  // 1. 空入力または挨拶・相談の場合：外部APIから動的に実在人気コスメを取得
  if (!clean || isGreetingOrConsultation(clean)) {
    const trending = await fetchDynamicTrendingCosmetics('敏感肌 低刺激 スキンケア', limit);
    for (const t of trending) {
      if (collected.length >= limit) break;
      collected.push(t);
    }
    if (collected.length >= limit) return collected.slice(0, limit);
  }

  // 2. 通常の検索語の場合
  const cacheNorm = normalizeSearchString(clean);
  const intent = detectQueryIntent(clean);

  // A. 動的ランタイムキャッシュ（過去に取得した実在データ）から探索
  const cachedMatches = COSMETICS_DATABASE.filter((p) => {
    if (!isActualCosmeticProduct(p)) return false;
    // カテゴリ指定（例: 「リップ」「洗顔」等）の場合は別カテゴリの混入を厳格排除
    if (intent.type === 'category' && intent.key && p.category !== intent.key) {
      return false;
    }
    const b = normalizeSearchString(p.brand);
    const n = normalizeSearchString(p.name);
    return (b && b.includes(cacheNorm)) || (n && n.includes(cacheNorm)) || (b && cacheNorm.includes(b));
  });

  for (const m of cachedMatches) {
    if (!collected.some((c) => c.id === m.id || c.name === m.name)) {
      collected.push(m);
    }
  }

  // B. Open Beauty Facts API（世界規模の実在コスメデータベース。無料）
  if (collected.length < limit) {
    const obfResults = await searchOpenBeautyFacts(clean, limit);
    for (const o of obfResults) {
      if (isActualCosmeticProduct(o) && !collected.some((c) => c.id === o.id || c.name === o.name)) {
        collected.push(o);
      }
    }
  }

  // C. Web リサーチ（Web 検索 → 出典ページの読み取り）。
  //    検索語を製品名に含む、全成分付きの候補が既にあれば行わない（同じブランドの別製品だけでは行う）
  const productQuery = options.webResearch ? toProductSearchQuery(clean) : null;
  if (
    productQuery &&
    !collected.some((p) => hasVerifiedIngredientList(p) && namesProduct(p, productQuery)) &&
    !isNonCosmeticSearchQuery(clean)
  ) {
    const webResults = await researchProducts(productQuery, Math.min(limit, 4));
    for (const w of webResults) {
      if (isActualCosmeticProduct(w) && !collected.some((c) => c.id === w.id || c.name === w.name)) {
        collected.push(w);
      }
    }
  }

  // 件数が足りなくても架空の候補は合成しない（0件ならUI側で再検索・バーコードを案内）

  // D. 厳格フィルター（実在コスメのみを確実に保証）
  const validProducts = collected.filter(isActualCosmeticProduct).slice(0, limit);

  // E. Clef による検索語との照合（SEARCH_FILTER_MODE。既定は off）。空の検索・挨拶は照合しない
  return filterSearchResults(clean && !isGreetingOrConsultation(clean) ? clean : '', validProducts);
}
