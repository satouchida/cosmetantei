import { KNOWN_INGREDIENTS } from '../data/ingredients-db';
import { COSMETICS_DATABASE } from '../data/cosmetics-db';
import { MARKETPLACE_DISCLAIMER_JA } from '../services/gemini';
import {
  AnalyzedIngredient,
  CulpritIngredient,
  DifferentialAnalysisResult,
  KnownIngredient,
  Product,
  ProductAnalysisResult,
} from '../types';

/**
 * 原材料テキストの正規化
 */
export function normalizeIngredientName(name: string): string {
  if (!name) return '';
  return name
    .trim()
    .toLowerCase()
    .replace(/[\(\)（）]/g, '')
    .replace(/[\s\-_・/]/g, '');
}

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
    for (const alias of item.aliases) {
      const normAlias = normalizeIngredientName(alias);
      // 3文字未満の略語（pg, bg, bha, aha等）は完全一致のみ
      if (normAlias.length < 3) continue;

      if (norm === normAlias) {
        return item;
      }

      // 「無水エタノール」「変性アルコール」などはエタノールにマッチ
      if (item.id === 'ethanol' && (norm.includes('エタノール') || norm.includes('アルコール') || norm.includes('alcohol'))) {
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
 * 疑わしい成分を含まない安心なコスメ（Amazonおすすめ候補）を抽出する
 */
export function findSafeAlternatives(
  avoidCulprits: (CulpritIngredient | { nameJa: string })[],
  excludedProductIds: string[] = [],
  limit = 3
): Product[] {
  const avoidKeywords = avoidCulprits.map((c) => normalizeIngredientName(c.nameJa));

  // COSMETICS_DATABASEの中から、除外キーワードを含まない製品を探索
  const safeItems = COSMETICS_DATABASE.filter((product) => {
    if (excludedProductIds.includes(product.id)) return false;

    // 製品の全成分をチェック
    for (const raw of product.ingredients) {
      const normRaw = normalizeIngredientName(raw);
      for (const avoid of avoidKeywords) {
        if (normRaw === avoid || normRaw.includes(avoid)) {
          return false;
        }
      }
    }

    return true;
  });

  // 敏感肌向け度の高い順（無香料・アルコールフリー・医薬部外品・セラミド等配合）にソート
  return safeItems
    .sort((a, b) => {
      let scoreA = (a.fragranceFree ? 2 : 0) + (a.alcoholFree ? 2 : 0) + (a.isQuasiDrug ? 1 : 0);
      let scoreB = (b.fragranceFree ? 2 : 0) + (b.alcoholFree ? 2 : 0) + (b.isQuasiDrug ? 1 : 0);
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
  };

  const warningsJa: string[] = [];
  const soothingHighlightsJa: string[] = [];

  const isEstimatedFromMarketplaces =
    product.isEstimatedFromMarketplaces ||
    product.ingredients.some(
      (i) => i.includes('取得できませんでした') || i.includes('オンラインマーケットプレイス')
    );

  for (const raw of product.ingredients) {
    const matched = findMatchingKnownIngredient(raw);

    if (matched) {
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
      });

      if (matched.riskLevel === 'high_irritant' || matched.riskLevel === 'moderate_irritant') {
        warningsJa.push(`【${matched.nameJa}】: ${matched.reasonJa}`);
      } else if (matched.riskLevel === 'active_caution') {
        warningsJa.push(`【${matched.nameJa}】: ${matched.reasonJa}`);
      } else if (matched.category === 'soothing' || matched.category === 'barrier_support') {
        soothingHighlightsJa.push(`【${matched.nameJa}】: ${matched.reasonJa}`);
      }
    } else {
      // 未知の安全と推定される基剤
      riskCounts.safe++;
      analyzedIngredients.push({
        rawName: raw,
        normalizedJa: raw,
        riskLevel: 'safe',
        isSuspect: false,
        category: 'other',
      });
    }
  }

  // 総合リスク判定
  let overallRiskLevel: 'safe' | 'caution' | 'warning' = 'safe';
  if (riskCounts.high_irritant > 0 || riskCounts.moderate_irritant >= 2) {
    overallRiskLevel = 'warning';
  } else if (riskCounts.moderate_irritant > 0 || riskCounts.active_caution > 0 || riskCounts.low_caution >= 3) {
    overallRiskLevel = 'caution';
  }

  let summaryJa = '';
  if (isEstimatedFromMarketplaces) {
    summaryJa = 'Amazon / 楽天市場 / Olive Young / Sephora 等の公開情報から成分を探索・補完して解析しています。';
  } else if (overallRiskLevel === 'safe') {
    summaryJa = '刺激になりやすい成分は見当たらず、敏感肌にも配慮されたマイルドな処方です。';
  } else if (overallRiskLevel === 'caution') {
    summaryJa = '一部にアルコール、防腐剤、またはアクティブ成分が含まれています。肌がゆらいでいる時は様子を見ながらの使用が推奨されます。';
  } else {
    summaryJa = '香料、精油、旧表示指定成分、または高刺激物質が含まれているため、敏感肌・肌荒れ時は刺激や赤みの原因になりやすいです。';
  }

  // 高リスク時は代替品を提示
  const suspectItems = analyzedIngredients.filter((i) => i.isSuspect).map((i) => ({ nameJa: i.normalizedJa }));
  const safeAlternatives =
    overallRiskLevel !== 'safe'
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
    p.ingredients.forEach((ing) => {
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
    p.ingredients.forEach((ing) => {
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
    return {
      nameJa: c.nameJa,
      nameEn: c.nameEn,
      riskLevel: matched ? matched.riskLevel : 'low_caution',
      category: matched ? matched.category : 'other',
      reasonJa: matched
        ? matched.reasonJa
        : '普段使えている安全なアイテムには入っていない成分です。個人のアレルギー・相性の可能性があります。',
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
    summaryJa = `安全なアイテムと比較した結果、肌荒れ原因の有力候補として「${topCulprits.join('、')}」など ${culprits.length} 個の特有成分があぶり出されました。`;

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
