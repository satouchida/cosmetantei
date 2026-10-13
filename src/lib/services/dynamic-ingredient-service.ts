import { KnownIngredient, IngredientCategory, IngredientRiskLevel, INGREDIENT_RISK_LEVELS } from '../types';
import { KNOWN_INGREDIENTS } from '../data/ingredients-db';
import { stripMarkdownEmphasis } from './gemini';
import { callGeminiJSON, isGeminiConfigured } from './gemini-client';
import { cacheGetJSON, cachePutJSON, hashedCacheKey } from '../server/cloudflare';
import { BoundedCache } from '../utils/bounded-cache';

/**
 * Layer 1: 動的ランタイムキャッシュ（上限つき）
 * 既知DB照合・ルール推論の結果をメモリ上に保持する。AI解説は KV にも保存する
 */
export const DYNAMIC_INGREDIENT_CACHE = new BoundedCache<KnownIngredient>(2000);

/** AI解説の KV 保存期間（成分の性質は変わらないため長め） */
const AI_EXPLANATION_TTL_SECONDS = 60 * 60 * 24 * 30;

const INGREDIENT_CATEGORIES: IngredientCategory[] = [
  'fragrance',
  'essential_oil',
  'drying_alcohol',
  'sulfate',
  'preservative',
  'uv_filter',
  'potent_active',
  'soothing',
  'barrier_support',
  'moisturizer',
  'other',
];

/**
 * 成分名の正規化（小文字化、全角半角スペース・ハイフン除去等）
 */
function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s　\-_()（）]/g, '');
}

/**
 * Layer 2: 化粧品化学・皮膚科学ルールベース動的推論エンジン
 * 接尾辞、骨格、命名規則から成分の役割・敏感肌向けアドバイス・リスク度を自動推論
 */
export function generateIngredientExplanation(rawName: string): KnownIngredient {
  const norm = normalizeName(rawName);
  const id = `dyn_${norm || 'unknown'}`;

  // 1. 水・温泉水・基剤
  if (norm === '水' || norm.includes('温泉水') || norm.includes('精製水') || norm.includes('water') || norm.includes('aqua')) {
    return {
      id,
      nameJa: rawName,
      nameEn: 'Water / Aqua',
      aliases: [rawName],
      category: 'other',
      riskLevel: 'safe',
      reasonJa: '化粧品の大部分（基剤）を構成する精製水です。他の成分を溶解・均一に保ち、肌に水分を補給します。',
      sensitiveSkinAdviceJa: '皮膚刺激性やアレルギー性はなく、すべての肌質・敏感肌において安全に使用できます。',
    };
  }

  // 2. 炭・泥・クレイ・吸着剤
  if (
    // 「炭酸〜」（炭酸水素Na など）は炭ではないため除外
    (norm.includes('炭') && !norm.includes('炭酸')) ||
    norm.includes('クレイ') ||
    norm.includes('カオリン') ||
    norm.includes('ベントナイト') ||
    norm.includes('海シルト') ||
    norm.includes('モロッコ溶岩クレイ') ||
    norm.includes('charcoal') ||
    norm.includes('clay')
  ) {
    return {
      id,
      nameJa: rawName,
      nameEn: 'Charcoal / Mineral Clay',
      aliases: [rawName],
      category: 'other',
      riskLevel: 'low_caution',
      reasonJa: '微細な多孔質構造を持ち、毛穴の余分な皮脂や汚れ、角栓を物理的に吸着して洗い流す清浄成分です。',
      sensitiveSkinAdviceJa: '皮脂吸着力が比較的高いため、乾燥肌や極度の敏感肌が毎日使うとつっぱり感を感じる場合があります。擦らず優しく洗い流してください。',
    };
  }

  // 3. セルロース・グルコマンナン・植物性スクラブ
  if (
    norm.includes('セルロース') ||
    norm.includes('結晶セルロース') ||
    norm.includes('グルコマンナン') ||
    norm.includes('コンニャク') ||
    norm.includes('cellulose') ||
    norm.includes('scrub')
  ) {
    return {
      id,
      nameJa: rawName,
      nameEn: 'Cellulose / Natural Scrub',
      aliases: [rawName],
      category: 'other',
      riskLevel: 'low_caution',
      reasonJa: '植物繊維由来のマイルドな粒子で、古い角質や毛穴汚れをやさしく絡め取るスクラブ・テクスチャー調整成分です。',
      sensitiveSkinAdviceJa: '化学合成プラスチックビーズよりも肌当たりは穏やかですが、肌のバリア機能が低下している時は擦りすぎないよう注意が必要です。',
    };
  }

  // 4. 高級脂肪酸（石けん原料・エモリエント）
  if (
    norm.includes('ミリスチン酸') ||
    norm.includes('ステアリン酸') ||
    norm.includes('パルミチン酸') ||
    norm.includes('ラウリン酸') ||
    norm.includes('オレイン酸') ||
    norm.includes('ベヘン酸')
  ) {
    const isLauric = norm.includes('ラウリン酸');
    return {
      id,
      nameJa: rawName,
      nameEn: 'Fatty Acid (Soap Base / Emollient)',
      aliases: [rawName],
      category: 'other',
      riskLevel: isLauric ? 'moderate_irritant' : 'safe',
      reasonJa: '洗顔料や石けんの主原料となる脂肪酸です。アルカリ剤と反応してクリーミーで濃密な泡を形成し、汚れを落とします。',
      sensitiveSkinAdviceJa: isLauric
        ? 'ラウリン酸は泡立ちに優れますが、肌の脱脂力がやや強く、敏感肌にはつっぱり感の原因になることがあります。'
        : '皮脂膜を構成する脂肪酸に近く刺激性は低めですが、洗い流しを十分に行い肌に残さないことが大切です。',
    };
  }

  // 5. アルカリ剤・中和剤（石けん形成）
  if (
    norm.includes('水酸化k') ||
    norm.includes('水酸化カリウム') ||
    norm.includes('水酸化na') ||
    norm.includes('水酸化ナトリウム') ||
    // TEA（トリエタノールアミン）。「tea tree」などを誤って含めないよう完全一致で判定
    norm === 'tea' ||
    norm.includes('triethanolamine') ||
    norm.includes('トリエタノールアミン') ||
    norm.includes('アルギニン') ||
    norm.includes('potassiumhydroxide') ||
    norm.includes('sodiumhydroxide')
  ) {
    return {
      id,
      nameJa: rawName,
      nameEn: 'Alkalizing / Neutralizing Agent',
      aliases: [rawName],
      category: 'other',
      riskLevel: 'safe',
      reasonJa: 'pH調整剤および脂肪酸とケン化反応を起こして石けんを形成するためのアルカリ成分です。製品中では中和されて存在します。',
      sensitiveSkinAdviceJa: '製品のpHを適切に保つために配合されており、最終製品中では中和されているため直接的なアルカリ刺激の心配は通常ありません。',
    };
  }

  // 6. 多価アルコール・高保湿剤（グリセリン、BG、DPG、プロパンジオール等）
  if (
    norm.includes('グリセリン') ||
    norm.includes('濃グリセリン') ||
    norm === 'bg' ||
    norm.includes('ブチレングリコール') ||
    norm === 'dpg' ||
    norm.includes('ジプロピレングリコール') ||
    norm.includes('プロパンジオール') ||
    norm.includes('ペンチレングリコール') ||
    norm.includes('ヘキサンジオール') ||
    norm.includes('グリコール')
  ) {
    const isDPG = norm === 'dpg' || norm.includes('ジプロピレングリコール');
    return {
      id,
      nameJa: rawName,
      nameEn: 'Polyol / Humectant Base',
      aliases: [rawName],
      category: 'moisturizer',
      riskLevel: isDPG ? 'low_caution' : 'safe',
      reasonJa: '角層に水分を抱え込み、うるおいを保つ代表的な多価アルコール系保湿成分です。化粧品のテクスチャーをしっとり整えます。',
      sensitiveSkinAdviceJa: isDPG
        ? 'DPGは高濃度で配合された場合、超敏感肌や赤み肌でごく稀にピリピリ感を感じることがあります。グリセリンやBG主体の処方はより低刺激です。'
        : '肌への親和性が高く、刺激性は極めて低いため、乾燥性敏感肌でも安心して使える基本の保湿成分です。',
    };
  }

  // 7. アミノ酸系・ベタイン系マイルド界面活性剤
  if (
    norm.includes('ベタイン') ||
    norm.includes('コカミド') ||
    norm.includes('ココイル') ||
    norm.includes('ラウロイル') ||
    norm.includes('タウリン') ||
    norm.includes('サルコシン') ||
    norm.includes('アラニン') ||
    norm.includes('グルタミン酸')
  ) {
    return {
      id,
      nameJa: rawName,
      nameEn: 'Mild Surfactant (Betaine / Amino Acid)',
      aliases: [rawName],
      category: 'other',
      riskLevel: 'safe',
      reasonJa: '皮脂を取りすぎず、アミノ酸や両性イオンの力でマイルドに洗浄する低刺激な界面活性剤です。キメ細やかな泡立ちを補助します。',
      sensitiveSkinAdviceJa: 'バリア機能を壊しにくく、肌の天然保湿因子（NMF）を守りながら洗えるため、敏感肌や乾燥肌に最もおすすめされる洗浄処方です。',
    };
  }

  // 8. 硫酸塩系（強力な脱脂力）
  if (
    norm.includes('ラウリル硫酸') ||
    norm.includes('ラウレス硫酸') ||
    norm.includes('スルホン酸') ||
    norm.includes('sulfate')
  ) {
    return {
      id,
      nameJa: rawName,
      nameEn: 'Sulfate Surfactant',
      aliases: [rawName],
      category: 'sulfate',
      riskLevel: 'high_irritant',
      reasonJa: '極めて高い脱脂力と起泡力を持つ陰イオン界面活性剤です。頑固な皮脂や油分を強力に落とします。',
      sensitiveSkinAdviceJa: '皮膚のバリア脂質（細胞間脂質やセラミド）まで過剰に洗い流してしまい、肌荒れ・乾燥・かゆみを引き起こす代表的な刺激成分です。敏感肌は避けることを推奨します。',
    };
  }

  // 9. シリコーン・エモリエント油
  if (
    norm.includes('ジメチコン') ||
    norm.includes('シクロペンタシロキサン') ||
    norm.includes('メチコン') ||
    norm.includes('スクワラン') ||
    norm.includes('ホホバ') ||
    norm.includes('マカデミア') ||
    norm.includes('ミネラルオイル') ||
    norm.includes('ワセリン') ||
    norm.includes('トリエチルヘキサノイン')
  ) {
    return {
      id,
      nameJa: rawName,
      nameEn: 'Emollient / Silicone Oil',
      aliases: [rawName],
      category: 'barrier_support',
      riskLevel: 'safe',
      reasonJa: '肌表面に薄い保護ヴェールを形成し、水分の蒸発を防いで滑らかな感触を与えるエモリエント・保護成分です。',
      sensitiveSkinAdviceJa: '肌の角層に浸透せず表面を保護するため化学的刺激性はほとんどなく、バリア機能が低下した肌の水分保護に適しています。',
    };
  }

  // 10. 高分子・増粘剤・ポリマー
  if (
    norm.includes('カルボマー') ||
    norm.includes('キサンタンガム') ||
    norm.includes('アクリレーツ') ||
    norm.includes('クロスポリマー') ||
    norm.includes('ポリマー') ||
    norm.includes('ペクチン') ||
    norm.includes('アルギン酸')
  ) {
    return {
      id,
      nameJa: rawName,
      nameEn: 'Thickener / Polymer',
      aliases: [rawName],
      category: 'other',
      riskLevel: 'safe',
      reasonJa: '化粧水やジェルのとろみ・粘度を安定させ、肌に塗布した際の摩擦を軽減する高分子ポリマーです。',
      sensitiveSkinAdviceJa: '分子量が非常に大きいため皮膚内に浸透せず、アレルギーや刺激のリスクは極めて低いです。敏感肌でも安全に使用できます。',
    };
  }

  // 11. 酵素（プロテアーゼ・パパイン等）
  if (
    norm.includes('パパイン') ||
    norm.includes('プロテアーゼ') ||
    norm.includes('リパーゼ') ||
    norm.includes('スブチリシン') ||
    norm.includes('酵素') ||
    norm.includes('enzyme')
  ) {
    return {
      id,
      nameJa: rawName,
      nameEn: 'Enzyme (Exfoliating / Cleansing)',
      aliases: [rawName],
      category: 'potent_active',
      riskLevel: 'active_caution',
      reasonJa: '古い角質（タンパク質）や過剰な角栓（皮脂）を選択的に分解し、ざらつきやくすみをオフする酵素成分です。',
      sensitiveSkinAdviceJa: '角質分解作用があるため、肌がデリケートな時期や連日使用すると角層が薄くなりヒリつきを感じる場合があります。週1〜2回のスペシャルケアが安全です。',
    };
  }

  // 12. キレート剤・酸化防止剤・pH調整剤
  if (
    norm.includes('edta') ||
    norm.includes('エチドロン酸') ||
    norm.includes('クエン酸') ||
    norm.includes('トコフェロール') ||
    norm.includes('ビタミンe') ||
    norm.includes('フェチン酸')
  ) {
    return {
      id,
      nameJa: rawName,
      nameEn: 'Chelating / Antioxidant / Buffer',
      aliases: [rawName],
      category: 'other',
      riskLevel: 'safe',
      reasonJa: '水道水中のミネラル（銅・鉄イオン）を封鎖して石けんカスの発生を防ぎ、製品の酸化・変質を防止する品質保持成分です。',
      sensitiveSkinAdviceJa: '微量配合で製品の安定性を高める役割を持ち、敏感肌に対しても一般的な配合量では刺激になりにくい成分です。',
    };
  }

  // 13. 植物エキス・発酵液
  if (
    norm.includes('エキス') ||
    norm.includes('発酵') ||
    norm.includes('extract') ||
    norm.includes('filtrate')
  ) {
    return {
      id,
      nameJa: rawName,
      nameEn: 'Botanical Extract / Ferment',
      aliases: [rawName],
      category: 'other',
      riskLevel: 'low_caution',
      reasonJa: '植物や発酵由来の美容成分（ポリフェノール・アミノ酸・ビタミン等）を含み、肌のキメや透明感をサポートします。',
      sensitiveSkinAdviceJa: '天然由来成分ですが、植物固有の成分に対して稀にアレルギー反応を起こす体質の方もいます。初めて使う際はパッチテストを行うと安心です。',
    };
  }

  // 14. 一般フォールバック：どのルールにも該当しない成分は「未評価」とし、安全とは断定しない
  return {
    id,
    nameJa: rawName,
    nameEn: rawName,
    aliases: [rawName],
    category: 'other',
    riskLevel: 'unknown',
    reasonJa: 'この成分はコスメ探偵の成分データに登録がなく、刺激性を評価できていません。',
    sensitiveSkinAdviceJa: '安全とも危険とも判断できないため、気になる場合は「AIでさらに詳しく調べる」で確認するか、パッチテストを行ってから使用してください。',
  };
}

/**
 * 成分の解説を取得（キャッシュ確認 → 既知DB照合 → 動的ルール生成 → キャッシュ格納）
 * 100%確実に KnownIngredient を返却する
 */
export function getOrGenerateIngredientExplanation(rawName: string): KnownIngredient {
  if (!rawName || !rawName.trim()) {
    return {
      id: 'empty',
      nameJa: '未指定',
      nameEn: 'Unknown',
      aliases: [],
      category: 'other',
      riskLevel: 'safe',
      reasonJa: '成分情報がありません。',
      sensitiveSkinAdviceJa: '特になし',
    };
  }

  const norm = normalizeName(rawName);

  // 1. Layer 1: 動的キャッシュ確認
  if (DYNAMIC_INGREDIENT_CACHE.has(norm)) {
    return DYNAMIC_INGREDIENT_CACHE.get(norm)!;
  }

  // 2. 既知DB（KNOWN_INGREDIENTS）照合
  for (const item of KNOWN_INGREDIENTS) {
    const normJa = normalizeName(item.nameJa);
    const normEn = normalizeName(item.nameEn);
    if (norm === normJa || norm === normEn || item.aliases.some((a) => normalizeName(a) === norm)) {
      DYNAMIC_INGREDIENT_CACHE.set(norm, item);
      return item;
    }
  }

  // 部分一致（長めの主要キーワード）
  for (const item of KNOWN_INGREDIENTS) {
    for (const alias of item.aliases) {
      const normAlias = normalizeName(alias);
      if (normAlias.length >= 3 && norm === normAlias) {
        DYNAMIC_INGREDIENT_CACHE.set(norm, item);
        return item;
      }
    }
  }

  // 3. Layer 2: ルールベース動的推論。結果には呼び出した人の表記が入るので、共有のキャッシュには入れない
  //    （名前から決まる軽い処理なので、毎回作り直す）
  return generateIngredientExplanation(rawName);
}

/**
 * Layer 3: Gemini 3.8 Flash によるオンデマンドAI成分解説
 * より専門的な皮膚科学解説をAIで動的生成し、キャッシュに格納
 */
export async function explainIngredientWithAI(rawName: string): Promise<KnownIngredient> {
  const norm = normalizeName(rawName);

  // すでにキャッシュにある場合は即時返却
  const existing = DYNAMIC_INGREDIENT_CACHE.get(norm);
  if (existing && existing.id.startsWith('ai_')) {
    return existing;
  }

  // APIキーが無い、またはモックキーの場合はルール生成を返す
  if (!isGeminiConfigured()) {
    return getOrGenerateIngredientExplanation(rawName);
  }

  const kvKey = await hashedCacheKey('ingredient:v1', norm);
  const stored = await cacheGetJSON<KnownIngredient>(kvKey);
  if (stored) {
    DYNAMIC_INGREDIENT_CACHE.set(norm, stored);
    return stored;
  }

  const prompt = `化粧品成分「${rawName}」について、皮膚科学・化粧品成分学の観点から解説してください。
【厳格な禁止ルール】
回答内のテキストに太字(**)やイタリック(*)などのMarkdown強調記法は絶対に含めないでください。必要な強調には「」や【】を使用してください。
- nameJa: 日本語の成分名（入力が日本語ならそのまま）
- nameEn: 英語INCI名
- category / riskLevel: 指定の選択肢から選ぶ。根拠が乏しく判断できない場合は riskLevel を "unknown" にする
- reasonJa: 配合目的・肌への作用についての明快な解説（1〜2文）
- sensitiveSkinAdviceJa: 敏感肌・肌荒れ時の使用に関する具体的なアドバイス（1〜2文）`;

  const parsed = await callGeminiJSON<Record<string, unknown>>({
    prompt,
    responseSchema: {
      type: 'OBJECT',
      properties: {
        nameJa: { type: 'STRING' },
        nameEn: { type: 'STRING' },
        category: { type: 'STRING', enum: INGREDIENT_CATEGORIES },
        riskLevel: { type: 'STRING', enum: INGREDIENT_RISK_LEVELS },
        reasonJa: { type: 'STRING' },
        sensitiveSkinAdviceJa: { type: 'STRING' },
      },
      required: ['nameJa', 'nameEn', 'category', 'riskLevel', 'reasonJa', 'sensitiveSkinAdviceJa'],
    },
    generationConfig: {
      temperature: 0.2,
      // 思考トークンも上限に含まれるため、思考レベルを上げた場合に備えて余裕を持たせる
      maxOutputTokens: 1024,
    },
  });

  if (!parsed) {
    return getOrGenerateIngredientExplanation(rawName);
  }

  const asText = (v: unknown, fallback: string) =>
    typeof v === 'string' && v.trim() ? stripMarkdownEmphasis(v.trim()) : fallback;

  // モデル出力は列挙値を検証してから採用する（不正値は「未評価」「その他」に倒す）
  const riskLevel = INGREDIENT_RISK_LEVELS.includes(parsed.riskLevel as IngredientRiskLevel)
    ? (parsed.riskLevel as IngredientRiskLevel)
    : 'unknown';
  const category = INGREDIENT_CATEGORIES.includes(parsed.category as IngredientCategory)
    ? (parsed.category as IngredientCategory)
    : 'other';

  const reasonJa = asText(parsed.reasonJa, '');
  const sensitiveSkinAdviceJa = asText(parsed.sensitiveSkinAdviceJa, '');
  if (!reasonJa || !sensitiveSkinAdviceJa) {
    return getOrGenerateIngredientExplanation(rawName);
  }

  const result: KnownIngredient = {
    id: `ai_${norm}`,
    nameJa: asText(parsed.nameJa, rawName),
    nameEn: asText(parsed.nameEn, rawName),
    aliases: [rawName],
    category,
    riskLevel,
    reasonJa,
    sensitiveSkinAdviceJa,
  };

  DYNAMIC_INGREDIENT_CACHE.set(norm, result);
  await cachePutJSON(kvKey, result, AI_EXPLANATION_TTL_SECONDS);
  return result;
}
