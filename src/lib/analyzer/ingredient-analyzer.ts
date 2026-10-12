import { KNOWN_INGREDIENTS, QUASI_DRUG_LABEL_REFERENCES } from '../data/ingredients-db';
import { COSMETICS_DATABASE, isVerifiedSource } from '../data/cosmetics-db';
import { getOrGenerateIngredientExplanation } from '../services/dynamic-ingredient-service';
import {
  AnalyzedIngredient,
  CulpritIngredient,
  DifferentialAnalysisResult,
  KnownIngredient,
  Product,
  ProductAnalysisResult,
} from '../types';

/** 旧来の AI 推定（マーケットプレイス情報からの補完）で成分を得た製品の注意書き */
export const MARKETPLACE_DISCLAIMER_JA =
  '※本製品の全成分情報は、Amazon / 楽天市場 / Olive Young / Sephora などのオンラインマーケットプレイスおよび公開情報をもとに探索・収集したものです。商品のリニューアルや販売地域（国内処方・並行輸入・海外処方）により実際のパッケージ表記と一部異なる（誤差を含む）場合がありますので、ご使用前にお手元の製品パッケージ表記もご確認ください。';

/**
 * 原材料テキストの正規化
 */
export function normalizeIngredientName(name: string): string {
  if (!name) return '';
  // 全角英数（ＢＧ・ＤＰＧ など、Web ページの成分表示に多い）を半角にそろえる
  return name
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\(\)（）]/g, '')
    .replace(/[\s\-_・/]/g, '');
}

/**
 * 成分名と簡略名（「ポリオキシエチレン〜ナトリウム」と「POE〜Na」）を同じ形にそろえる。完全一致の照合だけに使う。
 * 日本化粧品工業連合会「医薬部外品簡略名作成ガイドライン」(2006) の略号（1.）・元素記号（2.）・漢数字（8-1）・
 * 天然の L 体の「L-」の省略（7-6）による。成分名の一覧（名称リスト）は使わない
 */
const ABBREVIATIONS: [RegExp, string][] = [
  [/ポリオキシエチレン/g, 'poe'],
  [/ポリオキシプロピレン/g, 'pop'],
  [/ポリエチレングリコール/g, 'peg'],
  [/ポリプロピレングリコール/g, 'ppg'],
  [/ジプロピレングリコール/g, 'dpg'],
  [/1,3ブチレングリコール/g, 'bg'],
  [/プロピレングリコール/g, 'pg'],
  [/トリエタノールアミン/g, 'tea'],
  [/ジエタノールアミン/g, 'dea'],
  [/モノエタノールアミン/g, 'mea'],
  [/エチレンジアミンテトラ酢酸/g, 'edta'],
  [/ピロリドンカルボン酸/g, 'pca'],
  [/ジメチルポリシロキサン/g, 'ジメチコン'],
];
const ELEMENTS: [string, string][] = [
  ['リチウム', 'li'],
  ['ナトリウム', 'na'],
  ['カリウム', 'k'],
  ['マグネシウム', 'mg'],
  ['カルシウム', 'ca'],
  ['バリウム', 'ba'],
  ['ジルコニウム', 'zr'],
  ['アルミニウム', 'al'],
  ['亜鉛', 'zn'],
  ['チタン', 'ti'],
  ['クロム', 'cr'],
  ['ビスマス', 'bi'],
  ['コバルト', 'co'],
];
const MULTIPLIERS: Record<string, string> = { モノ: '', ジ: '2', 二: '2', トリ: '3', 三: '3', テトラ: '4', 四: '4' };
const ELEMENT_PATTERN = new RegExp(
  `(モノ|ジ|二|トリ|三|テトラ|四)?(${ELEMENTS.map(([name]) => name).join('|')})`,
  'g'
);
const ELEMENT_SYMBOLS = new Map(ELEMENTS);

export function abbreviateIngredientName(norm: string): string {
  let s = norm.replace(/^l(?=[ァ-ヶ])/, '');
  for (const [pattern, abbr] of ABBREVIATIONS) s = s.replace(pattern, abbr);
  return s.replace(ELEMENT_PATTERN, (_, mult: string | undefined, name: string) => {
    return `${mult ? MULTIPLIERS[mult] : ''}${ELEMENT_SYMBOLS.get(name)}`;
  });
}

/** 既知DBの名称・別名の簡略形（照合のたびに作らない） */
let abbreviatedKnownNames: { item: KnownIngredient; names: Set<string> }[] | undefined;
function knownAbbreviatedNames() {
  abbreviatedKnownNames ??= KNOWN_INGREDIENTS.map((item) => ({
    item,
    names: new Set(
      [item.nameJa, item.nameEn, ...item.aliases].map((n) => abbreviateIngredientName(normalizeIngredientName(n)))
    ),
  }));
  return abbreviatedKnownNames;
}

/**
 * エタノールそのもの（無水エタノール・変性アルコール・alcohol denat. 等）か。
 * セテアリルアルコール等の高級アルコール、ベンジルアルコール、トリエタノールアミンは別の成分
 */
function isEthanolName(norm: string): boolean {
  // エタノールアミン・エタノールアミド（TEA・界面活性剤）は別成分
  if (/エタノールアミ|ethanolamine|ethanolamide/.test(norm)) return false;
  if (norm.includes('エタノール')) return true;
  // 先頭一致のみ（セチルアルコール・ベンジルアルコール等の「〜アルコール」を拾わない）
  return (
    /^(sd|変性|無水|含水|醸造|発酵|植物性|エチル)?アルコール/.test(norm) ||
    /^(denatured|sd)?(ethyl)?(alcohol|ethanol)/.test(norm)
  );
}

/**
 * 部分一致させない成分。名前を含む別成分が多い
 * （ジプロピレングリコール≠PG、エチルヘキシルグリセリン・ポリグリセリン≠グリセリン）
 */
const EXACT_MATCH_ONLY = new Set(['propylene_glycol', 'glycerin']);
/** 部分一致させない成分でも、この修飾語（「植物性」「(PG)」等）を除くと別名に一致すれば同じ成分とみなす */
const QUALIFIER_PATTERN = /植物性|植物由来|天然|濃|vegetable|natural|pg|\d+(\.\d+)?%/g;

/**
 * 既知の刺激成分辞書と照合する
 * 誤爆防止（フェノキシエタノールがエタノールにマッチする等のバグを防ぐ）
 */
export function findMatchingKnownIngredient(rawName: string): KnownIngredient | undefined {
  const norm = normalizeIngredientName(rawName);
  if (!norm) return undefined;

  // 1. 完全一致
  for (const item of KNOWN_INGREDIENTS) {
    if (
      normalizeIngredientName(item.nameJa) === norm ||
      normalizeIngredientName(item.nameEn) === norm ||
      item.aliases.some((a) => normalizeIngredientName(a) === norm)
    ) {
      return item;
    }
  }

  // 1b. 簡略名と成分名の違い（POE/ポリオキシエチレン、Na/ナトリウム、2K/ジカリウム 等）を除けば完全一致
  const abbreviated = abbreviateIngredientName(norm);
  const byAbbreviation = knownAbbreviatedNames().find(({ names }) => names.has(abbreviated));
  if (byAbbreviation) return byAbbreviation.item;

  // 2. 特殊ケースの除外ルール
  // 「フェノキシエタノール」は「エタノール」ではない
  const isPhenoxy = norm.includes('フェノキシエタノール') || norm.includes('phenoxyethanol');
  if (isPhenoxy) {
    return KNOWN_INGREDIENTS.find((i) => i.id === 'phenoxyethanol');
  }

  // 「セラミド機能成分」「ヘキサデシロキシPG...」はPGではない
  if (norm.includes('セラミド機能成分') || norm.includes('ヘキサデシロキシpg')) {
    return KNOWN_INGREDIENTS.find((i) => i.id === 'ceramides');
  }

  // 3. 部分一致（短すぎる略語は除外）
  for (const item of KNOWN_INGREDIENTS) {
    // 「無水エタノール」「変性アルコール」などはエタノールにマッチ（高級アルコール等は除く）
    if (item.id === 'ethanol') {
      if (isEthanolName(norm)) return item;
      continue;
    }
    if (EXACT_MATCH_ONLY.has(item.id)) {
      const stripped = norm.replace(QUALIFIER_PATTERN, '');
      if (stripped && item.aliases.some((a) => normalizeIngredientName(a) === stripped)) return item;
      continue;
    }

    for (const alias of item.aliases) {
      const normAlias = normalizeIngredientName(alias);
      // 3文字未満の略語（pg, bg, bha, aha等）は完全一致のみ
      if (normAlias.length < 3) continue;

      if (norm === normAlias) {
        return item;
      }

      // 精油・エキス系
      if (item.category === 'essential_oil' && norm.includes(normAlias)) {
        return item;
      }

      // 香料
      if (item.id === 'fragrance' && (norm.includes('香料') || norm.includes('fragrance') || norm.includes('parfum'))) {
        return item;
      }

      // 有効成分（グリチルリチン酸2K, アラントイン, ナイアシンアミド）
      if (norm.includes(normAlias) && normAlias.length >= 4) {
        return item;
      }
    }
  }

  return undefined;
}

/**
 * 成分リストの代わりに入っているプレースホルダー文言（「成分情報は〜より補完」等）か
 */
export function isPlaceholderIngredient(raw: string): boolean {
  return /成分情報は|取得できませんでした/.test(raw);
}

/**
 * 分析する成分。医薬部外品は有効成分も含める。
 * 有効成分とその他の成分の両方に書かれた成分（業界の自主基準で両方に書く）や重複は1回だけ数える
 */
export function labelIngredients(product: Product): { raw: string; isActive: boolean }[] {
  const seen = new Set<string>();
  const list: { raw: string; isActive: boolean }[] = [];
  const groups: [string[], boolean][] = [
    [product.activeIngredientsJa ?? [], true],
    [product.ingredients, false],
  ];
  for (const [items, isActive] of groups) {
    for (const raw of items) {
      const norm = normalizeIngredientName(raw);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      list.push({ raw, isActive });
    }
  }
  return list;
}

/**
 * おすすめ代替品として提示してよい製品か
 * - 実在データ源（Open Beauty Facts・ユーザー入力・出典ページ）の全成分がある製品のみ
 * - AI推定の製品や成分不明の製品は、成分を照合できないため推奨しない
 */
export function hasVerifiedIngredients(product: Product): boolean {
  return (
    isVerifiedSource(product) &&
    !product.isEstimatedFromMarketplaces &&
    product.ingredients.length > 0 &&
    !product.ingredients.some(isPlaceholderIngredient)
  );
}

/**
 * 疑わしい成分を含まない安心なコスメ（Amazonおすすめ候補）を抽出する
 */
export function findSafeAlternatives(
  avoidCulprits: (CulpritIngredient | { nameJa: string; nameEn?: string })[],
  excludedProductIds: string[] = [],
  limit = 3
): Product[] {
  // 避けるべき成分を「既知DBのID」と「日本語名・英語名」の両方で表す（英語INCI表記の製品にも対応）
  const avoidIds = new Set<string>();
  const avoidNames = new Set<string>();
  for (const c of avoidCulprits) {
    // 低刺激と判定済みの成分（水・グリセリン等）まで避けると候補がほぼ無くなるため除外する
    if ('riskLevel' in c && c.riskLevel === 'safe') continue;
    for (const name of [c.nameJa, c.nameEn]) {
      if (!name) continue;
      const norm = normalizeIngredientName(name);
      if (norm) avoidNames.add(norm);
      const known = findMatchingKnownIngredient(name);
      if (known) avoidIds.add(known.id);
    }
  }

  // 成分確認済みの製品の中から、避けるべき成分・強い刺激成分を含まないものを探索
  const safeItems = COSMETICS_DATABASE.filter((product) => {
    if (excludedProductIds.includes(product.id)) return false;
    if (!hasVerifiedIngredients(product)) return false;
    // ユーザーが入力した成分表示の製品は、ほかの人へのおすすめにしない（共有キャッシュにも入れていない）
    if (product.ingredientSource === 'user_label') return false;

    for (const { raw } of labelIngredients(product)) {
      const known = findMatchingKnownIngredient(raw);
      if (known) {
        if (avoidIds.has(known.id)) return false;
        // 原因成分以外でも、強い刺激成分を含む製品は代替品として推奨しない
        if (known.riskLevel === 'high_irritant' || known.riskLevel === 'moderate_irritant') return false;
      }

      const names = [normalizeIngredientName(raw)];
      if (known) names.push(normalizeIngredientName(known.nameJa), normalizeIngredientName(known.nameEn));
      for (const avoid of avoidNames) {
        if (names.some((n) => n === avoid || n.includes(avoid))) return false;
      }
    }

    return true;
  });

  // 無香料・アルコールフリーを優先する。医薬部外品であることは有効成分の効能が承認されていることを示すだけで、
  // 刺激の少なさとは関係しないため順位に使わない
  return safeItems
    .sort((a, b) => {
      const scoreA = (a.fragranceFree ? 2 : 0) + (a.alcoholFree ? 2 : 0);
      const scoreB = (b.fragranceFree ? 2 : 0) + (b.alcoholFree ? 2 : 0);
      return scoreB - scoreA;
    })
    .slice(0, limit);
}

/**
 * 単一製品の全成分を解析し、リスク度・注意成分・鎮静成分を抽出する
 */
export function analyzeProduct(product: Product): ProductAnalysisResult {
  const analyzedIngredients: AnalyzedIngredient[] = [];
  const riskCounts = {
    safe: 0,
    low_caution: 0,
    moderate_irritant: 0,
    high_irritant: 0,
    active_caution: 0,
    unknown: 0,
  };

  const warningsJa: string[] = [];
  const soothingHighlightsJa: string[] = [];

  const isEstimatedFromMarketplaces =
    product.isEstimatedFromMarketplaces ||
    product.ingredients.some(
      (i) => i.includes('取得できませんでした') || i.includes('オンラインマーケットプレイス')
    );

  for (const { raw, isActive } of labelIngredients(product)) {
    // 「成分情報は〜より補完」などのプレースホルダーは成分として解析しない
    if (isPlaceholderIngredient(raw)) continue;

    // 既知DBまたは動的推論・キャッシュから成分解説を取得（該当しない成分は「未評価」）
    const matched = findMatchingKnownIngredient(raw) || getOrGenerateIngredientExplanation(raw);

    riskCounts[matched.riskLevel]++;

    const isSuspect =
      matched.riskLevel === 'high_irritant' ||
      matched.riskLevel === 'moderate_irritant' ||
      matched.riskLevel === 'active_caution';

    analyzedIngredients.push({
      rawName: raw,
      normalizedJa: matched.nameJa,
      matchedKnown: matched,
      riskLevel: matched.riskLevel,
      isSuspect,
      category: matched.category,
      reasonJa: matched.reasonJa,
      ...(isActive && { isActive }),
    });

    if (matched.riskLevel === 'high_irritant' || matched.riskLevel === 'moderate_irritant') {
      warningsJa.push(`【${matched.nameJa}】: ${matched.reasonJa}`);
    } else if (matched.riskLevel === 'active_caution') {
      warningsJa.push(`【${matched.nameJa}】: ${matched.reasonJa}`);
    } else if (matched.category === 'soothing' || matched.category === 'barrier_support') {
      soothingHighlightsJa.push(`【${matched.nameJa}】: ${matched.reasonJa}`);
    }
  }

  // 医薬部外品の「他 n成分」：名称が無く評価できない成分
  const undisclosedCount = product.undisclosedIngredientCount ?? 0;
  const labelNotesJa: string[] = [];
  if (product.isQuasiDrug) {
    labelNotesJa.push('医薬部外品のため、「その他の成分」の記載順は配合量の多い順とは限りません（記載順は企業が決めます）。');
  }
  if (undisclosedCount > 0) {
    labelNotesJa.push(`企業秘密として名称が表示されていない成分が${undisclosedCount}個あります（「他${undisclosedCount}成分」）。`);
  }

  // 総合リスク判定（刺激成分の検出が優先。検出が無くても、評価できた成分が少なければ「安全」とは判定しない）
  const evaluatedCount = analyzedIngredients.length;
  const unratedCount = riskCounts.unknown + undisclosedCount;
  let overallRiskLevel: ProductAnalysisResult['overallRiskLevel'] = 'safe';
  if (riskCounts.high_irritant > 0 || riskCounts.moderate_irritant >= 2) {
    overallRiskLevel = 'warning';
  } else if (riskCounts.moderate_irritant > 0 || riskCounts.active_caution > 0 || riskCounts.low_caution >= 3) {
    overallRiskLevel = 'caution';
  } else if (evaluatedCount === 0 || unratedCount / (evaluatedCount + undisclosedCount) >= 0.5) {
    overallRiskLevel = 'insufficient_data';
  }

  let summaryJa = '';
  if (overallRiskLevel === 'insufficient_data') {
    summaryJa =
      evaluatedCount === 0
        ? '全成分データが取得できていないため、刺激リスクを判定できません。パッケージの全成分表示をご確認ください。'
        : '評価できた成分が少ないため、刺激リスクを判定できません。安全と確認されたわけではありません。';
  } else if (isEstimatedFromMarketplaces) {
    summaryJa = 'Amazon / 楽天市場 / Olive Young / Sephora 等の公開情報から成分を探索・補完して解析しています。';
  } else if (overallRiskLevel === 'safe') {
    summaryJa = '刺激になりやすい成分は見当たらず、敏感肌にも配慮されたマイルドな処方です。';
  } else if (overallRiskLevel === 'caution') {
    summaryJa = '一部にアルコール、防腐剤、またはアクティブ成分が含まれています。肌がゆらいでいる時は様子を見ながらの使用が推奨されます。';
  } else {
    summaryJa = '香料、精油、旧表示指定成分、または高刺激物質が含まれているため、敏感肌・肌荒れ時は刺激や赤みの原因になりやすいです。';
  }

  // 未評価・非表示の成分がある場合は「安全」と言い切らない
  if (unratedCount > 0 && overallRiskLevel !== 'insufficient_data') {
    const parts: string[] = [];
    if (riskCounts.unknown > 0) parts.push(`${riskCounts.unknown}成分は評価データがなく「未評価」です`);
    if (undisclosedCount > 0) parts.push(`${undisclosedCount}成分は名称が表示されていないため評価できません`);
    const unknownNote = `${parts.join('。また、')}。安全と確認されたわけではありません。`;
    summaryJa =
      overallRiskLevel === 'safe' && !isEstimatedFromMarketplaces
        ? `既知の刺激成分は見当たりませんでした。ただし、${unknownNote}`
        : `${summaryJa} なお、${unknownNote}`;
  }

  // 高リスク時は代替品を提示
  const suspectItems = analyzedIngredients.filter((i) => i.isSuspect).map((i) => ({ nameJa: i.normalizedJa, nameEn: i.matchedKnown?.nameEn }));
  const safeAlternatives =
    overallRiskLevel === 'caution' || overallRiskLevel === 'warning'
      ? findSafeAlternatives(suspectItems, [product.id], 3)
      : undefined;

  return {
    product,
    ingredients: analyzedIngredients,
    riskCounts,
    overallRiskLevel,
    summaryJa,
    warningsJa,
    soothingHighlightsJa,
    safeAlternatives,
    ...(labelNotesJa.length > 0 && { labelNotesJa, labelReferences: QUASI_DRUG_LABEL_REFERENCES }),
    isEstimatedFromMarketplaces,
    dataSourceDisclaimer: isEstimatedFromMarketplaces ? MARKETPLACE_DISCLAIMER_JA : undefined,
  };
}

/**
 * 差分分析（あぶり出し）：
 * 「肌荒れしたコスメ群」に含まれ、「安全に使えているコスメ群」には含まれていない成分を抽出してランク付けする
 */
export function performDifferentialAnalysis(
  badProducts: Product[],
  safeProducts: Product[]
): DifferentialAnalysisResult {
  if (badProducts.length === 0) {
    return {
      badProducts: [],
      safeProducts: [],
      culprits: [],
      sharedIngredients: [],
      summaryJa: '比較する「肌荒れしたコスメ」が指定されていません。',
      adviceJa: [],
      safeAlternatives: [],
    };
  }

  // 安全なコスメに含まれる全成分ID・正規化名のセット
  const safeIngredientIds = new Set<string>();
  const safeNormalizedNames = new Set<string>();

  safeProducts.forEach((p) => {
    labelIngredients(p).forEach(({ raw: ing }) => {
      const norm = normalizeIngredientName(ing);
      safeNormalizedNames.add(norm);
      const matched = findMatchingKnownIngredient(ing);
      if (matched) {
        safeIngredientIds.add(matched.id);
      }
    });
  });

  // 肌荒れコスメに含まれる成分の出現頻度と安全コスメ不在判定
  const candidateMap = new Map<
    string,
    {
      nameJa: string;
      nameEn: string;
      matchedKnown?: KnownIngredient;
      foundInProducts: string[];
    }
  >();

  badProducts.forEach((p) => {
    labelIngredients(p).forEach(({ raw: ing }) => {
      const norm = normalizeIngredientName(ing);
      const matched = findMatchingKnownIngredient(ing);
      const key = matched ? matched.id : norm;

      // 安全コスメに含まれているか厳密に判定
      const isPresentInSafe =
        (matched && safeIngredientIds.has(matched.id)) ||
        safeNormalizedNames.has(norm);

      if (!isPresentInSafe) {
        if (!candidateMap.has(key)) {
          candidateMap.set(key, {
            nameJa: matched ? matched.nameJa : ing,
            nameEn: matched ? matched.nameEn : ing,
            matchedKnown: matched,
            foundInProducts: [p.name],
          });
        } else {
          const entry = candidateMap.get(key)!;
          if (!entry.foundInProducts.includes(p.name)) {
            entry.foundInProducts.push(p.name);
          }
        }
      }
    });
  });

  // 容疑成分（Culprits）をリスク度と出現回数でランキング
  const culprits: CulpritIngredient[] = Array.from(candidateMap.values()).map((c) => {
    const matched = c.matchedKnown;
    // 既知DBに無い成分もルール推論で評価し、単品分析と同じリスク度（未評価を含む）を使う
    const resolved = matched ?? getOrGenerateIngredientExplanation(c.nameJa);
    return {
      nameJa: c.nameJa,
      nameEn: c.nameEn,
      riskLevel: resolved.riskLevel,
      category: resolved.category,
      reasonJa: matched
        ? matched.reasonJa
        : safeProducts.length > 0
          ? '普段使えている安全なアイテムには入っていない成分です。個人のアレルギー・相性の可能性があります。'
          : '刺激性のデータがない成分です。安全に使えているコスメと比較すると、候補かどうかを絞り込めます。',
      foundInProducts: c.foundInProducts,
      absenceConfirmedInSafeCount: safeProducts.length,
    };
  });

  // リスク度順に並び替え（high_irritant > moderate_irritant > active_caution > low_caution > safe）
  const priorityOrder = {
    high_irritant: 5,
    moderate_irritant: 4,
    active_caution: 3,
    low_caution: 2,
    unknown: 2,
    safe: 1,
  };

  culprits.sort((a, b) => {
    const pA = priorityOrder[a.riskLevel] || 0;
    const pB = priorityOrder[b.riskLevel] || 0;
    if (pB !== pA) return pB - pA;
    return b.foundInProducts.length - a.foundInProducts.length;
  });

  // サマリーとアドバイス生成
  let summaryJa = '';
  const adviceJa: string[] = [];

  if (culprits.length > 0) {
    const topCulprits = culprits.slice(0, 3).map((c) => c.nameJa);
    // 安全なコスメが無いと比較による絞り込みはできないため、そのことを明示する
    summaryJa =
      safeProducts.length > 0
        ? `安全なアイテムと比較した結果、肌荒れ原因の有力候補として「${topCulprits.join('、')}」など ${culprits.length} 個の特有成分があぶり出されました。`
        : `安全に使えているコスメが未登録のため、比較による絞り込みはしていません。肌荒れしたコスメの成分のうち「${topCulprits.join('、')}」など ${culprits.length} 個を候補として挙げています。安全に使えているコスメを追加すると、候補を絞り込めます。`;

    const highRisks = culprits.filter(
      (c) => c.riskLevel === 'high_irritant' || c.riskLevel === 'moderate_irritant'
    );
    if (highRisks.length > 0) {
      adviceJa.push(
        `特に【${highRisks.map((c) => c.nameJa).join('、')}】は敏感肌にとって強い刺激やアレルゲンになりやすい代表的成分です。`
      );
    }

    adviceJa.push(
      '今後のコスメ選びでは、これらの成分を含まない「無香料・アルコールフリー・低刺激設計」の製品を優先することをおすすめします。'
    );
    adviceJa.push(
      '赤みやヒリつきが引くまでは、安全と確認できている最小限の保湿アイテム（セラミドやワセリン等）のみで肌を休ませましょう。'
    );
  } else {
    summaryJa = '肌荒れした製品と安全な製品の間で顕著な成分の差異が見つかりませんでした。';
    adviceJa.push('成分そのものではなく、使用量・摩擦・肌のバリア状態の低下・または併用による刺激の可能性があります。');
  }

  // あぶり出された疑わしい成分を含まない安全な代替コスメ（Amazonアフィリエイト付き）を検索
  const badProductIds = badProducts.map((p) => p.id);
  const safeAlternatives = findSafeAlternatives(culprits, badProductIds, 3);

  return {
    badProducts,
    safeProducts,
    culprits: culprits.slice(0, 10),
    sharedIngredients: Array.from(safeNormalizedNames),
    summaryJa,
    adviceJa,
    safeAlternatives,
  };
}
