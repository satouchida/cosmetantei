import { QUASI_DRUG_LABEL_REFERENCES, WHEAT_LABEL_REFERENCES } from '../data/ingredients-db';
import { ProductIdentity } from '../search/product-identity';
import { getOrGenerateIngredientExplanation } from '../services/dynamic-ingredient-service';
import { abbreviateIngredientName, isWheatDerivedName, normalizeIngredientName } from '../utils/ingredient-name';
import { findStandardEntry, productUseType, standardLabelNotes, standardNote } from './jp-standards';
import { designatedNote, findDesignatedEntry } from './jp-designated';
import { COSMETIC_STANDARD_REFERENCE, StandardEntry } from '../data/cosmetic-standards-jp';
import { productCategory, productSubKind } from './product-category';
import { formProfile } from './product-form';
import { findMatchingKnownIngredient, isPlaceholderIngredient, labelIngredients } from './ingredient-match';
import { alternativeAvoidItems, findSafeAlternatives } from './alternative-gate';
import { withoutSafetyRating } from '../wording';
import { AnalyzedIngredient, IngredientCategory, KnownIngredient, Product, ProductAnalysisResult } from '../types';

/** 旧来の AI 推定（マーケットプレイス情報からの補完）で成分を得た製品の注意書き */
export const MARKETPLACE_DISCLAIMER_JA =
  '※本製品の全成分情報は、Amazon / 楽天市場 / Olive Young / Sephora などのオンラインマーケットプレイスおよび公開情報をもとに探索・収集したものです。商品のリニューアルや販売地域（国内処方・並行輸入・海外処方）により実際のパッケージ表記と一部異なる（誤差を含む）場合がありますので、ご使用前にお手元の製品パッケージ表記もご確認ください。';


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

/** 成分DBとルールで評価できなかった成分（AI の評価の対象） */
export function unratedIngredientNames(analysis: ProductAnalysisResult): string[] {
  return analysis.ingredients.filter((i) => i.riskLevel === 'unknown').map((i) => i.rawName);
}

/** 化粧品基準（別表）に載っていた成分と、その配合の禁止・上限の注意 */
type StandardFinding = { rawName: string; entry: StandardEntry; note: ReturnType<typeof standardNote> };

/** ラベルの成分を1つずつ評価した結果（analyzeProduct の途中の結果） */
interface RatedIngredients {
  analyzedIngredients: AnalyzedIngredient[];
  riskCounts: ProductAnalysisResult['riskCounts'];
  warningsJa: string[];
  soothingHighlightsJa: string[];
  standardFound: StandardFinding[];
  wheatNames: string[];
  aiEvaluatedCount: number;
}

/** 1つの成分の評価。成分DB・ルールで評価できない成分だけ AI の評価を使う（aiRated: AI が評価できた） */
function ratingOf(raw: string, aiEvaluations?: Map<string, KnownIngredient>): { matched: KnownIngredient; aiRated: boolean } {
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
  return { matched, aiRated };
}

/** ラベルの成分を1つずつ評価し、件数・注意・肌を整える成分・化粧品基準の成分・小麦由来の成分を集める */
function rateIngredients(product: Product, aiEvaluations?: Map<string, KnownIngredient>): RatedIngredients {
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
  const standardFound: StandardFinding[] = [];
  // 小麦由来の成分（加水分解コムギの事例。小麦アレルギーの人に知らせる）
  const wheatNames: string[] = [];
  let aiEvaluatedCount = 0;

  for (const { raw, isActive } of labelIngredients(product)) {
    // 「成分情報は〜より補完」などのプレースホルダーは成分として解析しない
    if (isPlaceholderIngredient(raw)) continue;

    const { matched, aiRated } = ratingOf(raw, aiEvaluations);
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
      ...(raisedForLabel && { raisedForLabel: true as const }),
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
  return { analyzedIngredients, riskCounts, warningsJa, soothingHighlightsJa, standardFound, wheatNames, aiEvaluatedCount };
}

/** 成分表示の読み方の注意（医薬部外品の記載順・非表示の成分・化粧品基準・小麦由来の成分）と、その出典 */
function labelNotesFor(product: Product, undisclosedCount: number, standardFound: StandardFinding[], wheatNames: string[]) {
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
  return { labelNotesJa, standardNotes, labelReferences };
}

/** 総合リスク判定（刺激成分の検出が優先。検出が無くても、評価できた成分が少なければ「安全」とは判定しない） */
function overallRiskOf(
  riskCounts: ProductAnalysisResult['riskCounts'],
  evaluatedCount: number,
  undisclosedCount: number
): ProductAnalysisResult['overallRiskLevel'] {
  const unratedCount = riskCounts.unknown + undisclosedCount;
  if (riskCounts.high_irritant > 0 || riskCounts.moderate_irritant >= 2) {
    return 'warning';
  } else if (riskCounts.moderate_irritant > 0 || riskCounts.active_caution > 0 || riskCounts.low_caution >= 3) {
    return 'caution';
  } else if (evaluatedCount === 0 || unratedCount / (evaluatedCount + undisclosedCount) >= 0.5) {
    return 'insufficient_data';
  }
  return 'safe';
}

/** 総合判定ごとの要約の文 */
function levelSummaryJa(
  overallRiskLevel: ProductAnalysisResult['overallRiskLevel'],
  analyzedIngredients: AnalyzedIngredient[],
  isEstimatedFromMarketplaces: boolean
): string {
  const evaluatedCount = analyzedIngredients.length;
  if (overallRiskLevel === 'insufficient_data') {
    return evaluatedCount === 0
      ? '全成分データが取得できていないため、刺激リスクを判定できません。パッケージの全成分表示をご確認ください。'
      : '評価できた成分が少ないため、刺激リスクを判定できません。安全と確認されたわけではありません。';
  } else if (isEstimatedFromMarketplaces) {
    return 'Amazon / 楽天市場 / Olive Young / Sephora 等の公開情報から成分を探索・補完して解析しています。';
  } else if (overallRiskLevel === 'safe') {
    return '刺激になりやすい成分は見当たりませんでした。肌に合うかは人によって違うため、初めて使うときは少量から試してください。';
  } else if (overallRiskLevel === 'caution') {
    // 見つかった種類を書く（紫外線吸収剤だけの日焼け止めを「アルコール・防腐剤」とは言わない）
    const kinds = [
      ...new Set(
        analyzedIngredients
          // 表示指定成分で引き上げただけの成分は、総合判定の理由ではないので数えない
          .filter(
            (i) =>
              !i.raisedForLabel &&
              (i.riskLevel === 'low_caution' || i.riskLevel === 'moderate_irritant' || i.riskLevel === 'active_caution')
          )
          .map((i) => CAUTION_KIND_JA[i.category])
          .filter((k): k is string => !!k)
      ),
    ].slice(0, 3);
    return `一部に${kinds.length > 0 ? `${kinds.join('・')}など、` : ''}肌がゆらいでいる時に刺激になることがある成分が含まれています。様子を見ながらの使用が推奨されます。`;
  }
  return '香料、精油、または刺激になりやすい成分が含まれているため、敏感肌・肌荒れ時は刺激や赤みの原因になりやすいです。';
}

/** 総合判定の要約。未評価・非表示の成分と、AI が評価した成分があれば、そのことを書き足す */
function summaryFor(
  overallRiskLevel: ProductAnalysisResult['overallRiskLevel'],
  { analyzedIngredients, riskCounts, aiEvaluatedCount }: RatedIngredients,
  undisclosedCount: number,
  isEstimatedFromMarketplaces: boolean
): string {
  const unratedCount = riskCounts.unknown + undisclosedCount;
  let summaryJa = levelSummaryJa(overallRiskLevel, analyzedIngredients, isEstimatedFromMarketplaces);

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
  return summaryJa;
}

/**
 * 単一製品の全成分を解析し、リスク度・注意成分・肌を整える成分を抽出する
 * aiEvaluations（正規化した成分名 → AI の評価）があれば、成分DBとルールで「未評価」の成分にだけ使う
 */
export function analyzeProduct(
  product: Product,
  aiEvaluations?: Map<string, KnownIngredient>,
  /** 代わりの商品に出さない製品（比較リストに登録した製品） */
  registered: readonly ProductIdentity[] = []
): ProductAnalysisResult {
  const isEstimatedFromMarketplaces =
    product.isEstimatedFromMarketplaces ||
    product.ingredients.some(
      (i) => i.includes('取得できませんでした') || i.includes('オンラインマーケットプレイス')
    );

  const rated = rateIngredients(product, aiEvaluations);
  const { analyzedIngredients, riskCounts, warningsJa, soothingHighlightsJa, aiEvaluatedCount } = rated;

  // 医薬部外品の「他 n成分」：名称が無く評価できない成分
  const undisclosedCount = product.undisclosedIngredientCount ?? 0;
  const { labelNotesJa, standardNotes, labelReferences } = labelNotesFor(
    product,
    undisclosedCount,
    rated.standardFound,
    rated.wheatNames
  );

  const overallRiskLevel = overallRiskOf(riskCounts, analyzedIngredients.length, undisclosedCount);
  const summaryJa = summaryFor(overallRiskLevel, rated, undisclosedCount, isEstimatedFromMarketplaces);

  // 高リスク時は同じ種類の代替品を提示する。種類が分からなければ出さない（日焼け止めにリップを勧めない）
  const suspectItems = alternativeAvoidItems(analyzedIngredients);
  const category = productCategory(product);
  const safeAlternatives =
    overallRiskLevel === 'caution' || overallRiskLevel === 'warning'
      ? category
        ? findSafeAlternatives(suspectItems, [product, ...registered], 3, {
            category,
            subKind: productSubKind(product),
            profile: formProfile(product.name, category),
          })
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
    // 成分の出どころの注意は、成分があるときだけ（全成分が無いカードに「収集したもの」と書かない）
    dataSourceDisclaimer: isEstimatedFromMarketplaces && analyzedIngredients.length > 0 ? MARKETPLACE_DISCLAIMER_JA : undefined,
    ...(aiEvaluations && { aiEvaluation: { evaluatedCount: aiEvaluatedCount } }),
  };
}
