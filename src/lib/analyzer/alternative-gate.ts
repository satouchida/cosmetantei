import { COSMETICS_DATABASE, isVerifiedSource } from '../data/cosmetics-db';
import { isSellerTextProduct } from '../product-source';
import { notSingleItem } from '../search/listing-name';
import { ProductIdentity, registeredMatcher } from '../search/product-identity';
import { getOrGenerateIngredientExplanation } from '../services/dynamic-ingredient-service';
import { abbreviateIngredientName, normalizeIngredientName } from '../utils/ingredient-name';
import { findStandardEntry, productUseType, standardNote } from './jp-standards';
import { candidateSubKind, isMakeupName, productCategory, SubKind, subKindFit } from './product-category';
import { FormProfile, formProfile, formSimilarity, hasFormProfile } from './product-form';import { findMatchingKnownIngredient, isPlaceholderIngredient, labelIngredients } from './ingredient-match';
import { mayContainAvoidedWord } from './avoided-word';
import { fitsKindWord } from './kind-word';
import { mayBeMineralOil } from './mineral-oil';
import { AnalyzedIngredient, CulpritIngredient, IngredientCategory, KnownIngredient, Product } from '../types';

/**
 * 強い刺激成分のうち、避けると言われていなければ代わりの商品から外さず、カードに注意を書いて出す種類（香り・アルコール）。
 * 香料と精油は同じ「香り」として扱う（香料を避ける人には精油の香りも勧めない。その逆も）
 */
type CautionGroup = 'scent' | 'alcohol';
const CAUTION_GROUPS: Partial<Record<IngredientCategory, CautionGroup>> = {
  fragrance: 'scent',
  essential_oil: 'scent',
  drying_alcohol: 'alcohol',
};

function isStrongIrritant(rating: KnownIngredient): boolean {
  return rating.riskLevel === 'high_irritant' || rating.riskLevel === 'moderate_irritant';
}

/** 成分DBの評価、無ければルールの評価 */
function ratingOf(raw: string): KnownIngredient {
  return findMatchingKnownIngredient(raw) ?? getOrGenerateIngredientExplanation(raw);
}

/** 注意を書いて出す強い刺激成分か（香料・精油・乾燥性のアルコール） */
function isCautionIrritant(rating: KnownIngredient): boolean {
  return isStrongIrritant(rating) && CAUTION_GROUPS[rating.category] !== undefined;
}

/**
 * 代わりの商品のカードに注意を書く成分（香料・精油・アルコールのうち強い刺激成分。表示の名前のまま、表示の順に）。
 * 避けると言われた種類のものは、確認（alternativeGateReason）で外してあるので、ここには残らない
 */
export function alternativeCautions(product: Product): string[] {
  const names = new Set<string>();
  for (const { raw } of labelIngredients(product)) {
    if (isCautionIrritant(ratingOf(raw))) names.add(raw);
  }
  return [...names];
}

/** 注意を書く成分があれば、それを付けた写し（もとの製品は保存済みの製品と共有なので書き換えない） */
export function withAlternativeCautions(product: Product, cautions = alternativeCautions(product)): Product {
  if (cautions.length > 0) return { ...product, cautionIngredients: cautions };
  if (!product.cautionIngredients) return product;
  // 前に付けた注意（送り返された製品など）は、今の成分で無ければ外す
  const rest = { ...product };
  delete rest.cautionIngredients;
  return rest;
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
  /**
   * 分析した製品の下位の種類（category と一緒に使う。無ければ、ハンド・からだ用・目元用・口紅・ボディローションの候補を外す）。
   * 別の下位の種類は「別の種類」（kind）として外す
   */
  subKind?: SubKind;
  /**
   * アプリの種類に無い、頼まれた種類の語（「下地」。category の代わり）。AI の判定でその種類と確かめた商品だけ
   * （analyzer/kind-word.ts）
   */
  kindWord?: string;
  /** お店の商品説明から読んだ成分表示の製品も確かめる（その返答にだけ使う。確認済みの出典ではない） */
  allowShopListing?: boolean;
  /**
   * 成分DBとルールで評価できた成分の割合の下限（0〜1）。お店の説明から読んだ一覧は、読めない名前が多いと
   * 「原因成分フリー」の根拠にならないので、8割以上を求める
   */
  minRatedShare?: number;
}

/**
 * 確認の結果。ok 以外は、最初に外れた決まり（ログで、どこで候補が減ったかを数えるため）
 * kind: 別の種類 / unverified: 全成分を確かめられない / userLabel: 利用者が入力した成分表示 /
 * standard: 化粧品基準でこの種類に配合できない成分 / suspect: 避ける成分 / irritant: 強い刺激成分 /
 * unrated: 評価できた成分が下限に満たない
 */
export type AlternativeGateReason = 'ok' | 'kind' | 'unverified' | 'userLabel' | 'standard' | 'suspect' | 'irritant' | 'unrated';

/**
 * 避ける成分から、代わりの商品の確認を作る。含まない・強い刺激成分を含まない（香料・精油・アルコールは避ける種類だけ）・
 * 同じ種類・全成分が確かめられている
 */
export function alternativeGate(
  avoidCulprits: (CulpritIngredient | { nameJa: string; nameEn?: string })[],
  avoidWords: readonly string[] = []
): (product: Product, options?: AlternativeGateOptions) => boolean {
  const reason = alternativeGateReason(avoidCulprits, avoidWords);
  return (product, options) => reason(product, options) === 'ok';
}

/**
 * 確認で避ける成分を「既知DBのID」と「日本語名・英語名（正規化）」の両方で表す（英語INCI表記の製品にも対応）。
 * 低刺激と判定済みの成分（水・グリセリン等）まで避けると候補がほぼ無くなるため除く
 */
export function avoidedIngredients(avoidCulprits: (CulpritIngredient | { nameJa: string; nameEn?: string })[]): {
  ids: Set<string>;
  names: Set<string>;
} {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const c of avoidCulprits) {
    if ('riskLevel' in c && c.riskLevel === 'safe') continue;
    for (const name of [c.nameJa, c.nameEn]) {
      if (!name) continue;
      const norm = normalizeIngredientName(name);
      if (norm) names.add(norm);
      const known = findMatchingKnownIngredient(name);
      if (known) ids.add(known.id);
    }
  }
  return { ids, names };
}

/** 避ける成分に入っている、注意を書いて出す種類（香り・アルコール）。その種類の強い刺激成分は、注意ではなく外す */
function avoidedCautionGroups(avoidCulprits: (CulpritIngredient | { nameJa: string; nameEn?: string })[]): Set<CautionGroup> {
  const groups = new Set<CautionGroup>();
  for (const c of avoidCulprits) {
    if ('riskLevel' in c && c.riskLevel === 'safe') continue;
    for (const name of [c.nameJa, c.nameEn]) {
      const group = name ? CAUTION_GROUPS[ratingOf(name).category] : undefined;
      if (group) groups.add(group);
    }
  }
  return groups;
}

/**
 * alternativeGate と同じ確認で、外れた理由を返す（決まりはここにだけ書く）。
 * avoidWords: 成分DBに無い、避けたいと書かれた語（「シリコン」）。AI の判定で「当たらない」名前だけ通す（analyzer/avoided-word.ts）
 */
export function alternativeGateReason(
  avoidCulprits: (CulpritIngredient | { nameJa: string; nameEn?: string })[],
  avoidWords: readonly string[] = [],
  /**
   * 香料・精油・アルコールを外すかを決める避ける成分（既定は avoidCulprits）。避ける成分の確認を抜いた確認
   * （お店の候補の、AI に聞く前の確認）でも、避けると言われた種類は外す
   */
  cautionAvoids: (CulpritIngredient | { nameJa: string; nameEn?: string })[] = avoidCulprits
): (product: Product, options?: AlternativeGateOptions) => AlternativeGateReason {
  const { ids: avoidIds, names: avoidNames } = avoidedIngredients(avoidCulprits);
  const words = avoidWords.map(normalizeIngredientName).filter(Boolean);
  // 鉱物油を避けるとき、名前で決まらない炭化水素（イソパラフィン等）は AI の判定で「鉱物油でない」ものだけ通す
  // （判定は確認の前に取ってくる。services/mineral-oil-judge.ts）
  const avoidsMineralOil = avoidIds.has('mineral_oil');
  // 香料・精油・アルコールは、避けると言われた種類だけ外す（ほかは注意を書いて出す。alternativeCautions）
  const blockedGroups = avoidedCautionGroups(cautionAvoids);
  const blocks = (rating: KnownIngredient) => {
    const group = CAUTION_GROUPS[rating.category];
    return isStrongIrritant(rating) && (group === undefined || blockedGroups.has(group));
  };

  return (product, options = {}) => {
    if (options.category && !fitsKind(product, options.category, options.subKind)) return 'kind';
    if (options.kindWord && !fitsKindWord(options.kindWord, product.name)) return 'kind';
    const shopListing = options.allowShopListing && isSellerTextProduct(product) && product.ingredients.length > 0;
    if (!shopListing && !hasVerifiedIngredients(product)) return 'unverified';
    // ユーザーが入力した成分表示の製品は、ほかの人へのおすすめにしない（共有キャッシュにも入れていない）
    if (product.ingredientSource === 'user_label') return 'userLabel';

    const label = labelIngredients(product);
    // 日本の化粧品基準で、この種類の化粧品に配合できない成分（別表第1は全化粧品）。医薬部外品は対象外
    const useType = productUseType(product);
    let rated = 0;
    for (const { raw } of label) {
      if (!product.isQuasiDrug) {
        const norm = normalizeIngredientName(raw);
        const standard = findStandardEntry(norm, abbreviateIngredientName(norm));
        if (standard && standardNote(standard, useType).notAllowedHere) return 'standard';
      }
      const known = findMatchingKnownIngredient(raw);
      if (known && avoidIds.has(known.id)) return 'suspect';
      if (avoidsMineralOil && mayBeMineralOil(raw)) return 'suspect';
      if (words.some((word) => mayContainAvoidedWord(word, raw))) return 'suspect';
      // 原因成分以外でも、強い刺激成分を含む製品は代替品として推奨しない（成分DBに無い精油などはルールの評価で見る）。
      // 香料・精油・アルコールは、避けると言われていなければ外さない（カードに注意を書く）
      const rating = known ?? getOrGenerateIngredientExplanation(raw);
      if (blocks(rating)) return 'irritant';
      if (rating.riskLevel !== 'unknown') rated++;

      const names = [normalizeIngredientName(raw)];
      if (known) names.push(normalizeIngredientName(known.nameJa), normalizeIngredientName(known.nameEn));
      // 名前の一部での一致は、成分DBで何の成分か分からない名前だけ（「フェノキシエタノール」は防腐剤で、
      // 「エタノール」を避けても除かない。DBで別の成分と分かる名前は、上の ID の照合で決める）
      for (const avoid of avoidNames) {
        if (names.some((n) => n === avoid || (!known && n.includes(avoid)))) return 'suspect';
      }
    }
    if (options.minRatedShare && label.length > 0 && rated / label.length < options.minRatedShare) return 'unrated';
    return 'ok';
  };
}

/** 代わりの商品の名前の順（並べ替えのたびに作らない） */
const NAME_ORDER = new Intl.Collator('ja');

/** 候補の下位の種類（探している種類の中で、名前から。美容液ファンデは形にかかわらず：candidateSubKind） */
/**
 * 種類の語が名前に無くても、その語だけで種類が分かる下位の種類（「TIRTIR マスクフィット レッド クッション」はクッションファンデ）。
 * ほかの下位の種類の語は種類を決めない（「ハンドソープ」はハンドクリームではなく、「ボディミスト」はボディクリームではない）
 */
const NAMES_THE_CATEGORY: ReadonlySet<SubKind> = new Set(['cushion']);

/**
 * 探している種類（と下位の種類）の製品か。種類が「その他」の製品は名前から推し量る（「UV ミスト」→ 日焼け止め）。種類の語が
 * 無くても、NAMES_THE_CATEGORY の下位の種類の語があれば、その種類（お店の名前の確かめでは通していた）。メイク用品の名前
 * （「クッションチーク」）は除く。代わりの商品の確認と、種類で探す依頼の名前の検索の結果に使う
 */
export function fitsKind(product: Pick<Product, 'category' | 'name'>, category: Product['category'], subKind: SubKind | undefined): boolean {
  const candidate = candidateSubKindOf(product, category, subKind);
  const named =
    subKind && candidate === subKind && NAMES_THE_CATEGORY.has(subKind) && !isMakeupName(product.name) ? category : undefined;
  if ((productCategory(product) ?? named) !== category) return false;
  return subKindFit(subKind, candidate, category) !== 'other';
}

function candidateSubKindOf(product: Pick<Product, 'name'>, category: Product['category'], wanted: SubKind | undefined): SubKind | undefined {
  return category === 'other' ? undefined : candidateSubKind(wanted, category, product.name);
}

/**
 * 代わりの商品（成分確認済みの製品のうち、避ける成分・強い刺激成分を含まない同じ種類の製品。避けると言われていない香料・精油・
 * アルコールは外さず、cautionIngredients を付けて後に並べる）。
 * excluded：勧めない製品。ID、または製品（ID・JAN コード・ブランドと名前で同じ製品を除く。比較リストに登録した製品は、
 * 別の表記で保存された同じ製品も勧めない）
 */
export function findSafeAlternatives(
  avoidCulprits: (CulpritIngredient | { nameJa: string; nameEn?: string })[],
  excluded: readonly (string | ProductIdentity)[] = [],
  limit = 3,
  /** profile: 分析した製品の形・使う場所（並べ替えにだけ使う。product-form.ts） */
  /** avoidWords: 成分DBに無い避けたい語。pool: 探す製品（無ければ保存済みのすべて。AI の判定を取った候補だけを確かめ直すとき） */
  options: Pick<AlternativeGateOptions, 'category' | 'subKind' | 'kindWord'> & {
    profile?: FormProfile;
    avoidWords?: readonly string[];
    pool?: readonly Product[];
  } = {}
): Product[] {
  const passes = alternativeGate(avoidCulprits, options.avoidWords);
  const excludedIds = new Set(excluded.filter((e): e is string => typeof e === 'string'));
  const isExcluded = registeredMatcher(excluded.filter((e): e is ProductIdentity => typeof e !== 'string'));
  const sheet = options.category === 'mask' && options.subKind === 'sheet';
  // 成分確認済みの製品の中から、避けるべき成分・強い刺激成分（香料・精油・アルコールは避ける種類だけ）を含まないものを探索。お店のページから保存した
  // セット・まとめ売り（「6個セット」）は1個の商品ではないので勧めない（お店の候補と同じ決まり）
  const safeItems = (options.pool ?? COSMETICS_DATABASE).filter(
    (product) =>
      !excludedIds.has(product.id) &&
      !notSingleItem(product.name, sheet) &&
      passes(product, { category: options.category, subKind: options.subKind, kindWord: options.kindWord }) &&
      !isExcluded(product)
  );

  // 同じ下位の種類を先に（名前で分からない候補は後に）。次に形・使う場所の近いもの、アクティブ成分（レチノール等）が
  // 少ないもの、「やや注意」の成分が少ないもの（植物エキス6つより、レチノール1つのほうが刺激になりやすい）。
  // 同じなら名前と ID の順（保存した順・新しく保存された製品で入れ替わらない）。
  // 香料・精油・アルコールの強い刺激成分を含む製品（避けると言われていない種類。カードに注意を書く）は、含まない製品の後に。
  // 無香料・アルコールフリーの印は順位に使わない：製品の fragranceFree・alcoholFree の印は Open Beauty Facts の製品にしか無い
  // （印のある製品だけが先に並んでいた）。成分で見る注意の有無で並べる。
  // 医薬部外品であることは有効成分の効能が承認されていることを示すだけで、刺激の少なさとは関係しないため順位に使わない
  const { category, profile } = options;
  const sameSubKind = (p: Product) =>
    category && subKindFit(options.subKind, candidateSubKindOf(p, category, options.subKind), category) === 'same' ? 1 : 0;
  const similarity = (p: Product) =>
    hasFormProfile(profile) ? formSimilarity(profile, formProfile(p.name, category === 'other' ? undefined : category)) : 0;
  const ratings = new Map<string, KnownIngredient>();
  const ranked = safeItems.map((product) => ({
    product,
    subKind: sameSubKind(product),
    similarity: similarity(product),
    ...cautionCounts(product, ratings),
  }));
  return ranked
    .sort(
      (a, b) =>
        Number(a.cautions.length > 0) - Number(b.cautions.length > 0) ||
        b.subKind - a.subKind ||
        b.similarity - a.similarity ||
        a.active - b.active ||
        a.caution - b.caution ||
        NAME_ORDER.compare(a.product.name, b.product.name) ||
        (a.product.id < b.product.id ? -1 : a.product.id > b.product.id ? 1 : 0)
    )
    .slice(0, limit)
    .map((r) => withAlternativeCautions(r.product, r.cautions));
}

/**
 * 「アクティブ成分」の数・「やや注意」の成分の数と、カードに注意を書く成分（alternativeCautions と同じ。強い刺激成分の
 * うち、香料・精油・アルコール以外を含む製品は確認で外してある）
 */
function cautionCounts(product: Product, ratings: Map<string, KnownIngredient>): { active: number; caution: number; cautions: string[] } {
  let active = 0;
  let caution = 0;
  const cautions = new Set<string>();
  for (const { raw } of labelIngredients(product)) {
    // 同じ名前（水・BG・グリセリン等）は多くの製品にあるので、1回の呼び出しの中で評価を使い回す
    let rating = ratings.get(raw);
    if (rating === undefined) {
      rating = ratingOf(raw);
      ratings.set(raw, rating);
    }
    if (rating.riskLevel === 'active_caution') active++;
    else if (rating.riskLevel === 'low_caution') caution++;
    else if (isCautionIrritant(rating)) cautions.add(raw);
  }
  return { active, caution, cautions: [...cautions] };
}
