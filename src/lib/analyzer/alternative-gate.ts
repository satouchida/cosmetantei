import { COSMETICS_DATABASE, isVerifiedSource } from '../data/cosmetics-db';
import { isSellerTextProduct } from '../product-source';
import { ProductIdentity, registeredMatcher } from '../search/product-identity';
import { getOrGenerateIngredientExplanation } from '../services/dynamic-ingredient-service';
import { abbreviateIngredientName, normalizeIngredientName } from '../utils/ingredient-name';
import { findStandardEntry, productUseType, standardNote } from './jp-standards';
import { productCategory } from './product-category';
import { findMatchingKnownIngredient, isPlaceholderIngredient, labelIngredients } from './ingredient-match';
import { AnalyzedIngredient, CulpritIngredient, Product } from '../types';

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
/**
 * 1つの製品の分析で、代わりの商品が避ける成分。原因候補の成分。無ければ「やや注意」の成分
 * （紫外線吸収剤の多い日焼け止め等、「やや注意」が重なっただけの「注意」は、それらを避ける）
 */
export function alternativeAvoidItems(ingredients: AnalyzedIngredient[]): { nameJa: string; nameEn?: string }[] {
  const suspects = ingredients.filter((i) => i.isSuspect);
  // 表示指定成分で引き上げただけの成分（評価は「刺激の報告が少ない」）は避けない（乳液・クリームの多くに入っている）
  const avoid =
    suspects.length > 0
      ? suspects
      : ingredients.filter((i) => i.riskLevel === 'low_caution' && !i.raisedForLabel);
  return avoid.map((i) => ({ nameJa: i.normalizedJa, nameEn: i.matchedKnown?.nameEn }));
}

/** 代わりの商品として勧めてよいかの確認（findSafeAlternatives と、お店の候補の確認で同じものを使う） */
export interface AlternativeGateOptions {
  category?: Product['category'];
  /** お店の商品説明から読んだ成分表示の製品も確かめる（その返答にだけ使う。確認済みの出典ではない） */
  allowShopListing?: boolean;
  /**
   * 成分DBとルールで評価できた成分の割合の下限（0〜1）。お店の説明から読んだ一覧は、読めない名前が多いと
   * 「原因成分フリー」の根拠にならないので、8割以上を求める
   */
  minRatedShare?: number;
}

/**
 * 避ける成分から、代わりの商品の確認を作る。含まない・強い刺激成分を含まない・同じ種類・全成分が確かめられている
 */
export function alternativeGate(
  avoidCulprits: (CulpritIngredient | { nameJa: string; nameEn?: string })[]
): (product: Product, options?: AlternativeGateOptions) => boolean {
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

  return (product, options = {}) => {
    // 種類が「その他」の製品は名前から推し量る（「UV ミスト」→ 日焼け止め）
    if (options.category && productCategory(product) !== options.category) return false;
    const shopListing = options.allowShopListing && isSellerTextProduct(product) && product.ingredients.length > 0;
    if (!shopListing && !hasVerifiedIngredients(product)) return false;
    // ユーザーが入力した成分表示の製品は、ほかの人へのおすすめにしない（共有キャッシュにも入れていない）
    if (product.ingredientSource === 'user_label') return false;

    const label = labelIngredients(product);
    // 日本の化粧品基準で、この種類の化粧品に配合できない成分（別表第1は全化粧品）。医薬部外品は対象外
    const useType = productUseType(product);
    let rated = 0;
    for (const { raw } of label) {
      if (!product.isQuasiDrug) {
        const norm = normalizeIngredientName(raw);
        const standard = findStandardEntry(norm, abbreviateIngredientName(norm));
        if (standard && standardNote(standard, useType).notAllowedHere) return false;
      }
      const known = findMatchingKnownIngredient(raw);
      if (known && avoidIds.has(known.id)) return false;
      // 原因成分以外でも、強い刺激成分を含む製品は代替品として推奨しない（成分DBに無い精油などはルールの評価で見る）
      const rating = known ?? getOrGenerateIngredientExplanation(raw);
      if (rating.riskLevel === 'high_irritant' || rating.riskLevel === 'moderate_irritant') return false;
      if (rating.riskLevel !== 'unknown') rated++;

      const names = [normalizeIngredientName(raw)];
      if (known) names.push(normalizeIngredientName(known.nameJa), normalizeIngredientName(known.nameEn));
      // 名前の一部での一致は、成分DBで何の成分か分からない名前だけ（「フェノキシエタノール」は防腐剤で、
      // 「エタノール」を避けても除かない。DBで別の成分と分かる名前は、上の ID の照合で決める）
      for (const avoid of avoidNames) {
        if (names.some((n) => n === avoid || (!known && n.includes(avoid)))) return false;
      }
    }
    if (options.minRatedShare && label.length > 0 && rated / label.length < options.minRatedShare) return false;
    return true;
  };
}

/**
 * 代わりの商品（成分確認済みの製品のうち、避ける成分・強い刺激成分を含まない同じ種類の製品）。
 * excluded：勧めない製品。ID、または製品（ID・JAN コード・ブランドと名前で同じ製品を除く。比較リストに登録した製品は、
 * 別の表記で保存された同じ製品も勧めない）
 */
export function findSafeAlternatives(
  avoidCulprits: (CulpritIngredient | { nameJa: string; nameEn?: string })[],
  excluded: readonly (string | ProductIdentity)[] = [],
  limit = 3,
  options: { category?: Product['category'] } = {}
): Product[] {
  const passes = alternativeGate(avoidCulprits);
  const excludedIds = new Set(excluded.filter((e): e is string => typeof e === 'string'));
  const isExcluded = registeredMatcher(excluded.filter((e): e is ProductIdentity => typeof e !== 'string'));
  // 成分確認済みの製品の中から、避けるべき成分・強い刺激成分を含まないものを探索
  const safeItems = COSMETICS_DATABASE.filter(
    (product) => !excludedIds.has(product.id) && passes(product, { category: options.category }) && !isExcluded(product)
  );

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
