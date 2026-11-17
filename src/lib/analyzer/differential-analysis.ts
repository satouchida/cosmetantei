import { ProductIdentity } from '../search/product-identity';
import { getOrGenerateIngredientExplanation } from '../services/dynamic-ingredient-service';
import { normalizeIngredientName } from '../utils/ingredient-name';
import { findPairFindings, PairContext } from './pair-rules';
import { mostCommonCategory, mostCommonSubKind } from './product-category';
import { findMatchingKnownIngredient, isPlaceholderIngredient, labelIngredients } from './ingredient-match';
import { findSafeAlternatives } from './alternative-gate';
import {
  CulpritIngredient,
  CurrentUseCheckResult,
  DifferentialAnalysisResult,
  KnownIngredient,
  PairFinding,
  Product,
} from '../types';

/** 肌荒れしたコスメにだけある成分（原因候補になる前の形） */
interface CulpritCandidate {
  nameJa: string;
  nameEn: string;
  matchedKnown?: KnownIngredient;
  foundInProducts: string[];
}

/**
 * 差分分析（あぶり出し）：
 * 「肌荒れしたコスメ群」に含まれ、「安全に使えるコスメ群」には含まれていない成分を抽出してランク付けする
 */
export function performDifferentialAnalysis(
  badProducts: Product[],
  safeProducts: Product[],
  /** 代わりの商品に出さない、ほかに登録した製品。肌荒れした・使えるコスメ（badProducts・safeProducts）は必ず除く */
  otherRegistered: readonly ProductIdentity[] = []
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

  const { safeIngredientIds, safeNormalizedNames } = safeIngredientSets(safeProducts);
  const candidateMap = candidatesAbsentFromSafe(badProducts, safeIngredientIds, safeNormalizedNames);
  // 容疑成分（Culprits）をリスク度と出現回数でランキング
  const culprits = culpritsOf(candidateMap, safeProducts);
  sortByRisk(culprits);
  const { summaryJa, adviceJa } = summaryAndAdvice(culprits, safeProducts);

  // 肌荒れした製品を一緒に使っていた場合の組み合わせの注意
  const pairFindings = pairFindingsFor(badProducts, 'trouble');

  // あぶり出された疑わしい成分を含まない代替コスメを、肌荒れした製品に多い種類（と、その中の下位の種類）から探す
  // （種類が分からなければ出さない）。登録した製品（肌荒れした・使えるコスメ）は勧めない
  const category = mostCommonCategory(badProducts);
  const safeAlternatives = category
    ? findSafeAlternatives(culprits, [...badProducts, ...safeProducts, ...otherRegistered], 3, {
        category,
        subKind: mostCommonSubKind(badProducts, category),
      })
    : [];

  return {
    badProducts,
    safeProducts,
    culprits: culprits.slice(0, 10),
    ...(pairFindings.length > 0 && { pairFindings }),
    sharedIngredients: Array.from(safeNormalizedNames),
    summaryJa,
    adviceJa,
    safeAlternatives,
  };
}

/** 安全なコスメに含まれる全成分ID・正規化名のセット */
function safeIngredientSets(safeProducts: Product[]): { safeIngredientIds: Set<string>; safeNormalizedNames: Set<string> } {
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
  return { safeIngredientIds, safeNormalizedNames };
}

/** 肌荒れコスメに含まれる成分の出現頻度と安全コスメ不在判定 */
function candidatesAbsentFromSafe(
  badProducts: Product[],
  safeIngredientIds: Set<string>,
  safeNormalizedNames: Set<string>
): Map<string, CulpritCandidate> {
  const candidateMap = new Map<string, CulpritCandidate>();

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
  return candidateMap;
}

/** 肌荒れしたコスメにだけある成分を、原因候補の形にする */
function culpritsOf(candidateMap: Map<string, CulpritCandidate>, safeProducts: Product[]): CulpritIngredient[] {
  return Array.from(candidateMap.values()).map((c) => {
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
          ? '使えているアイテムには入っていない成分です。個人のアレルギー・相性の可能性があります。'
          : '刺激性のデータがない成分です。問題なく使えるコスメと比較すると、候補かどうかを絞り込めます。',
      foundInProducts: c.foundInProducts,
      absenceConfirmedInSafeCount: safeProducts.length,
    };
  });
}

/** リスク度順に並び替え（high_irritant > moderate_irritant > active_caution > low_caution > safe） */
function sortByRisk(culprits: CulpritIngredient[]): void {
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
}

/** サマリーとアドバイス生成 */
function summaryAndAdvice(culprits: CulpritIngredient[], safeProducts: Product[]): { summaryJa: string; adviceJa: string[] } {
  let summaryJa = '';
  const adviceJa: string[] = [];

  if (culprits.length > 0) {
    const topCulprits = culprits.slice(0, 3).map((c) => c.nameJa);
    // 安全なコスメが無いと比較による絞り込みはできないため、そのことを明示する
    summaryJa =
      safeProducts.length > 0
        ? `使えているアイテムと比較した結果、肌トラブルの要因になった可能性のある成分として「${topCulprits.join('、')}」など ${culprits.length} 個の成分が候補に挙がりました。`
        : `使えるコスメが未登録のため、比較による絞り込みはしていません。肌荒れしたコスメの成分のうち「${topCulprits.join('、')}」など ${culprits.length} 個を候補として挙げています。使えるコスメを追加すると、候補を絞り込めます。`;

    const highRisks = culprits.filter(
      (c) => c.riskLevel === 'high_irritant' || c.riskLevel === 'moderate_irritant'
    );
    if (highRisks.length > 0) {
      adviceJa.push(
        `特に【${highRisks.map((c) => c.nameJa).join('、')}】は敏感肌にとって強い刺激やアレルゲンになりやすい代表的成分です。`
      );
    }

    adviceJa.push(
      '今後のコスメ選びでは、これらの成分を含まない製品（無香料・アルコールフリーなど）を候補にして、初めて使うときは腕の内側などの目立たない部分で試してください。'
    );
    adviceJa.push(
      // 肌の手当ての仕方は書かない（医師法第17条。利用規約の第3条と同じ言い方）
      '赤みやヒリつきなどがあるときは使用を中止し、皮膚科専門医にご相談ください。'
    );
  } else {
    summaryJa = '肌荒れした製品と使えている製品の間で顕著な成分の差異が見つかりませんでした。';
    adviceJa.push('成分そのものではなく、使用量・摩擦・肌のバリア状態の低下・または併用による刺激の可能性があります。');
  }
  return { summaryJa, adviceJa };
}

/** 製品をまたぐ組み合わせの注意（成分DB、無ければルールで成分を判定） */
function pairFindingsFor(products: Product[], context: PairContext): PairFinding[] {
  return findPairFindings(
    products,
    (p) => labelIngredients(p).map(({ raw }) => raw).filter((raw) => !isPlaceholderIngredient(raw)),
    (raw) => findMatchingKnownIngredient(raw) ?? getOrGenerateIngredientExplanation(raw),
    context
  );
}

/** 今使っている製品の組み合わせチェック（使えるコスメの「組み合わせをチェック」。今も使っている製品だけ） */
export function checkCurrentUse(products: Product[]): CurrentUseCheckResult {
  const unique = [...new Map(products.map((p) => [p.id, p])).values()];
  return {
    productNames: unique.map((p) => p.name.trim() || '名前のない製品'),
    findings: pairFindingsFor(unique, 'current'),
  };
}
