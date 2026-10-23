import { KNOWN_INGREDIENTS, QUASI_DRUG_LABEL_REFERENCES, WHEAT_LABEL_REFERENCES } from '../data/ingredients-db';
import { COSMETICS_DATABASE, isVerifiedSource } from '../data/cosmetics-db';
import { getOrGenerateIngredientExplanation } from '../services/dynamic-ingredient-service';
import { abbreviateIngredientName, isWheatDerivedName, normalizeIngredientName } from '../utils/ingredient-name';
import { findStandardEntry, productUseType, standardLabelNotes, standardNote } from './jp-standards';
import { findPairFindings, PairContext } from './pair-rules';
import { designatedNote, findDesignatedEntry } from './jp-designated';
import { COSMETIC_STANDARD_REFERENCE, StandardEntry } from '../data/cosmetic-standards-jp';
import { mostCommonCategory, productCategory } from './product-category';
import { ordinaryIngredients, quasiDrugActives } from '../quasi-drug';
import { withoutSafetyRating } from '../wording';
import {
  AnalyzedIngredient,
  CulpritIngredient,
  CurrentUseCheckResult,
  DifferentialAnalysisResult,
  IngredientCategory,
  KnownIngredient,
  PairFinding,
  Product,
  ProductAnalysisResult,
} from '../types';

/** 旧来の AI 推定（マーケットプレイス情報からの補完）で成分を得た製品の注意書き */
export const MARKETPLACE_DISCLAIMER_JA =
  '※本製品の全成分情報は、Amazon / 楽天市場 / Olive Young / Sephora などのオンラインマーケットプレイスおよび公開情報をもとに探索・収集したものです。商品のリニューアルや販売地域（国内処方・並行輸入・海外処方）により実際のパッケージ表記と一部異なる（誤差を含む）場合がありますので、ご使用前にお手元の製品パッケージ表記もご確認ください。';

export { normalizeIngredientName, abbreviateIngredientName };

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

/** text の中の needle のどれかが、直前が before に一致しない位置にあるか */
function hasOccurrenceNotAfter(text: string, needle: string, before: RegExp): boolean {
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
    if (!before.test(text.slice(0, i))) return true;
  }
  return false;
}

/** 「注意」の要約に書く、成分の種類 */
const CAUTION_KIND_JA: Partial<Record<IngredientCategory, string>> = {
  drying_alcohol: 'アルコール',
  preservative: '防腐剤',
  potent_active: 'アクティブ成分',
  uv_filter: '紫外線吸収剤',
  fragrance: '香料',
  essential_oil: '精油',
  sulfate: '洗浄成分',
};

/**
 * 部分一致させない成分。名前を含む別成分が多い
 * （ジプロピレングリコール≠PG、エチルヘキシルグリセリン・ポリグリセリン≠グリセリン）
 */
const EXACT_MATCH_ONLY = new Set(['propylene_glycol', 'glycerin']);
/** 部分一致させない成分でも、この修飾語（「植物性」「(PG)」等）を除くと別名に一致すれば同じ成分とみなす */
const QUALIFIER_PATTERN = /植物性|植物由来|天然|濃|vegetable|natural|pg|\d+(\.\d+)?%/g;
/**
 * 酸の名前の後ろに付いてよいもの（塩）。アクティブ成分の酸は、これ以外の名前の一部としては照合しない
 * （「サリチル酸ベンジル」「サリチル酸ヘキシル」などのエステル、「チオグリコール酸〜」「3-O-エチルアスコルビン酸」は別の成分）
 */
const ACID_SALT_SUFFIX = /^(na|2na|3na|k|2k|ca|mg|tea|アンモニウム|ナトリウム|カリウム|カルシウム|マグネシウム)?$/;

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

  // 加水分解コムギデンプンはタンパク質ではない（加水分解コムギの事例はタンパク質の成分）
  if (/加水分解(コムギ|小麦)(でんぷん|デンプン)|hydrolyzedwheatstarch/.test(norm)) return undefined;

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

      // アクティブ成分の酸（サリチル酸・グリコール酸・アスコルビン酸）は、その酸と塩だけ
      if (item.category === 'potent_active' && /(酸|acid)$/.test(normAlias)) {
        if (norm.startsWith(normAlias) && ACID_SALT_SUFFIX.test(norm.slice(normAlias.length))) return item;
        continue;
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
        // 水酸化亜鉛・過酸化亜鉛・水酸化チタンは紫外線散乱剤の酸化亜鉛・酸化チタンではない
        //（「水酸化Al・酸化チタン」のように、別の所に本物の酸化チタンがあれば一致）
        if ((item.id === 'zinc_oxide' || item.id === 'titanium_dioxide') && !hasOccurrenceNotAfter(norm, normAlias, /[水過]$/)) continue;
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
 * 分析する成分。医薬部外品は有効成分も含める。医薬部外品の印が無い製品の有効成分の一覧は、ほかの成分として数える
 * （有効成分の印を付けない。src/lib/quasi-drug.ts）。
 * 有効成分とその他の成分の両方に書かれた成分（業界の自主基準で両方に書く）や重複は1回だけ数える
 */
export function labelIngredients(product: Product): { raw: string; isActive: boolean }[] {
  const seen = new Set<string>();
  const list: { raw: string; isActive: boolean }[] = [];
  const groups: [string[], boolean][] = [
    [quasiDrugActives(product), true],
    [ordinaryIngredients(product), false],
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
      : ingredients.filter((i) => i.riskLevel === 'low_caution' && i.matchedKnown?.riskLevel !== 'safe');
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
    const shopListing = options.allowShopListing && product.ingredientSource === 'shop_listing' && product.ingredients.length > 0;
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

export function findSafeAlternatives(
  avoidCulprits: (CulpritIngredient | { nameJa: string; nameEn?: string })[],
  excludedProductIds: string[] = [],
  limit = 3,
  options: { category?: Product['category'] } = {}
): Product[] {
  const passes = alternativeGate(avoidCulprits);
  // 成分確認済みの製品の中から、避けるべき成分・強い刺激成分を含まないものを探索
  const safeItems = COSMETICS_DATABASE.filter(
    (product) => !excludedProductIds.includes(product.id) && passes(product, { category: options.category })
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

/** 成分DBとルールで評価できなかった成分（AI の評価の対象） */
export function unratedIngredientNames(analysis: ProductAnalysisResult): string[] {
  return analysis.ingredients.filter((i) => i.riskLevel === 'unknown').map((i) => i.rawName);
}

/**
 * 単一製品の全成分を解析し、リスク度・注意成分・肌を整える成分を抽出する
 * aiEvaluations（正規化した成分名 → AI の評価）があれば、成分DBとルールで「未評価」の成分にだけ使う
 */
export function analyzeProduct(
  product: Product,
  aiEvaluations?: Map<string, KnownIngredient>
): ProductAnalysisResult {
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
  // 化粧品基準（化粧品のみ。医薬部外品は品目ごとの承認による）
  const useType = productUseType(product);
  const standardFound: { rawName: string; entry: StandardEntry; note: ReturnType<typeof standardNote> }[] = [];
  // 小麦由来の成分（加水分解コムギの事例。小麦アレルギーの人に知らせる）
  const wheatNames: string[] = [];
  let aiEvaluatedCount = 0;

  const isEstimatedFromMarketplaces =
    product.isEstimatedFromMarketplaces ||
    product.ingredients.some(
      (i) => i.includes('取得できませんでした') || i.includes('オンラインマーケットプレイス')
    );

  for (const { raw, isActive } of labelIngredients(product)) {
    // 「成分情報は〜より補完」などのプレースホルダーは成分として解析しない
    if (isPlaceholderIngredient(raw)) continue;

    // 既知DBまたは動的推論・キャッシュから成分解説を取得（該当しない成分は「未評価」）
    const known = findMatchingKnownIngredient(raw);
    let matched = known || getOrGenerateIngredientExplanation(raw);
    // 成分DBとルールで評価できない成分だけ、AI の評価を使う（AI も判断できなければ「未評価」のまま、解説だけ使う）
    const ai = !known && matched.riskLevel === 'unknown' ? aiEvaluations?.get(normalizeIngredientName(raw)) : undefined;
    if (ai) {
      // 名前は成分表示のまま（AI の書いた名前は推測を含む）
      matched = { ...ai, nameJa: raw, aliases: [raw] };
    }
    // AI も判断できなかった成分は「未評価」のまま（解説だけ使う）
    const aiRated = !!ai && ai.riskLevel !== 'unknown';
    if (aiRated) aiEvaluatedCount++;
    const aiLabel = aiRated ? '（AIによる評価）' : '';

    // 総合判定は成分DB・ルールの評価で数える（表示指定成分の引き上げでは数えない）
    riskCounts[matched.riskLevel]++;

    const isSuspect =
      matched.riskLevel === 'high_irritant' ||
      matched.riskLevel === 'moderate_irritant' ||
      matched.riskLevel === 'active_caution';

    const norm = normalizeIngredientName(raw);
    const standardEntry = product.isQuasiDrug ? undefined : findStandardEntry(norm, abbreviateIngredientName(norm));
    const jpStandard = standardEntry ? standardNote(standardEntry, useType) : undefined;
    if (standardEntry && jpStandard) standardFound.push({ rawName: raw, entry: standardEntry, note: jpStandard });
    const designatedEntry = findDesignatedEntry(raw, product.isQuasiDrug);
    const jpDesignated = designatedEntry ? designatedNote(designatedEntry) : undefined;
    const wheatDerived = isWheatDerivedName(raw);
    if (wheatDerived && !wheatNames.includes(raw)) wheatNames.push(raw);
    // 表示指定成分（アレルギー等の皮膚障害を起こすおそれ）は「刺激の報告が少ない」（緑）と並べず、「肌質により注意」で表示する。
    // 総合判定の件数（上の riskCounts）と原因候補の比較には使わない。小麦由来の成分は引き上げない
    // （緑のまま残るのは「グリセリン（小麦由来）」のような精製した成分。小麦の注意は labelNotesJa に出る）
    const raisedForLabel = matched.riskLevel === 'safe' && !!designatedEntry;
    const riskLevel = raisedForLabel ? 'low_caution' : matched.riskLevel;

    analyzedIngredients.push({
      rawName: raw,
      normalizedJa: matched.nameJa,
      matchedKnown: matched,
      riskLevel,
      isSuspect,
      category: matched.category,
      reasonJa: matched.reasonJa,
      ...(isActive && { isActive }),
      ...(jpStandard && { jpStandard }),
      ...(jpDesignated && { jpDesignated }),
      ...(wheatDerived && { wheatDerived }),
      ...(aiRated && { aiEvaluated: true }),
    });

    if (matched.riskLevel === 'high_irritant' || matched.riskLevel === 'moderate_irritant') {
      warningsJa.push(`【${matched.nameJa}】${aiLabel}: ${matched.reasonJa}`);
    } else if (matched.riskLevel === 'active_caution') {
      warningsJa.push(`【${matched.nameJa}】${aiLabel}: ${matched.reasonJa}`);
    } else if (!raisedForLabel && (matched.category === 'soothing' || matched.category === 'barrier_support')) {
      soothingHighlightsJa.push(`【${matched.nameJa}】${aiLabel}: ${withoutSafetyRating(matched.reasonJa)}`);
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
  const standardNotes = standardLabelNotes(product, standardFound);
  labelNotesJa.push(...standardNotes);
  if (wheatNames.length > 0) {
    labelNotesJa.push(
      `小麦由来の成分が表示されています：${wheatNames.join('、')}。小麦アレルギーがある方は注意してください。使用中にかゆみやまぶたのはれなどが出たら使用をやめ、医師に相談してください（加水分解コムギ末を含む石けんで、小麦の全身性アレルギーを起こした事例があります）。`
    );
  }

  const labelReferences = [
    ...(product.isQuasiDrug || undisclosedCount > 0 ? QUASI_DRUG_LABEL_REFERENCES : []),
    ...(standardFound.length > 0 ? [COSMETIC_STANDARD_REFERENCE] : []),
    ...(wheatNames.length > 0 ? WHEAT_LABEL_REFERENCES : []),
  ];

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
    summaryJa = '刺激になりやすい成分は見当たりませんでした。肌に合うかは人によって違うため、初めて使うときは少量から試してください。';
  } else if (overallRiskLevel === 'caution') {
    // 見つかった種類を書く（紫外線吸収剤だけの日焼け止めを「アルコール・防腐剤」とは言わない）
    const kinds = [
      ...new Set(
        analyzedIngredients
          // 表示指定成分で引き上げただけの成分は、総合判定の理由ではないので数えない（元の評価で見る）
          .filter((i) => {
            const rated = i.matchedKnown?.riskLevel ?? i.riskLevel;
            return rated === 'low_caution' || rated === 'moderate_irritant' || rated === 'active_caution';
          })
          .map((i) => CAUTION_KIND_JA[i.category])
          .filter((k): k is string => !!k)
      ),
    ].slice(0, 3);
    summaryJa = `一部に${kinds.length > 0 ? `${kinds.join('・')}など、` : ''}肌がゆらいでいる時に刺激になることがある成分が含まれています。様子を見ながらの使用が推奨されます。`;
  } else {
    summaryJa = '香料、精油、または刺激になりやすい成分が含まれているため、敏感肌・肌荒れ時は刺激や赤みの原因になりやすいです。';
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

  // AI の評価を使ったときは、そのことと誤りを含みうることを書く
  if (aiEvaluatedCount > 0) {
    summaryJa += ` ${aiEvaluatedCount}成分は成分データに無いため、AIが評価しました（誤りを含む可能性があります）。`;
  }

  // 高リスク時は同じ種類の代替品を提示する。種類が分からなければ出さない（日焼け止めにリップを勧めない）
  const suspectItems = alternativeAvoidItems(analyzedIngredients);
  const category = productCategory(product);
  const safeAlternatives =
    overallRiskLevel === 'caution' || overallRiskLevel === 'warning'
      ? category
        ? findSafeAlternatives(suspectItems, [product.id], 3, { category })
        : []
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
    ...(labelNotesJa.length > 0 && { labelNotesJa }),
    ...(labelReferences.length > 0 && { labelReferences }),
    ...(standardNotes.length > 0 && { outsideJpStandard: true }),
    isEstimatedFromMarketplaces,
    dataSourceDisclaimer: isEstimatedFromMarketplaces ? MARKETPLACE_DISCLAIMER_JA : undefined,
    ...(aiEvaluations && { aiEvaluation: { evaluatedCount: aiEvaluatedCount } }),
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
          ? '普段使えているアイテムには入っていない成分です。個人のアレルギー・相性の可能性があります。'
          : '刺激性のデータがない成分です。普段問題なく使えているコスメと比較すると、候補かどうかを絞り込めます。',
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
        ? `普段使えているアイテムと比較した結果、肌トラブルの要因になった可能性のある成分として「${topCulprits.join('、')}」など ${culprits.length} 個の成分が候補に挙がりました。`
        : `普段使えているコスメが未登録のため、比較による絞り込みはしていません。肌荒れしたコスメの成分のうち「${topCulprits.join('、')}」など ${culprits.length} 個を候補として挙げています。普段使えているコスメを追加すると、候補を絞り込めます。`;

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
    summaryJa = '肌荒れした製品と普段使えている製品の間で顕著な成分の差異が見つかりませんでした。';
    adviceJa.push('成分そのものではなく、使用量・摩擦・肌のバリア状態の低下・または併用による刺激の可能性があります。');
  }

  // 肌荒れした製品を一緒に使っていた場合の組み合わせの注意
  const pairFindings = pairFindingsFor(badProducts, 'trouble');

  // あぶり出された疑わしい成分を含まない代替コスメを、肌荒れした製品に多い種類から探す（種類が分からなければ出さない）
  const badProductIds = badProducts.map((p) => p.id);
  const category = mostCommonCategory(badProducts);
  const safeAlternatives = category ? findSafeAlternatives(culprits, badProductIds, 3, { category }) : [];

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

/** 製品をまたぐ組み合わせの注意（成分DB、無ければルールで成分を判定） */
function pairFindingsFor(products: Product[], context: PairContext): PairFinding[] {
  return findPairFindings(
    products,
    (p) => labelIngredients(p).map(({ raw }) => raw).filter((raw) => !isPlaceholderIngredient(raw)),
    (raw) => findMatchingKnownIngredient(raw) ?? getOrGenerateIngredientExplanation(raw),
    context
  );
}

/** 今使っている製品の組み合わせチェック（「今使っているコスメ」のボタン） */
export function checkCurrentUse(products: Product[]): CurrentUseCheckResult {
  const unique = [...new Map(products.map((p) => [p.id, p])).values()];
  return {
    productNames: unique.map((p) => p.name.trim() || '名前のない製品'),
    findings: pairFindingsFor(unique, 'current'),
  };
}

