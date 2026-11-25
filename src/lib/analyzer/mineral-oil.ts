/**
 * 「鉱物油フリー」の頼みで、名前だけでは鉱物油か決まらない炭化水素・ロウ（流動イソパラフィン・水添ポリイソブテン・
 * イソドデカン等）。成分DBの「鉱物油」（ミネラルオイル・ワセリン等）は名前で決まるので、ここでは扱わない。
 * 鉱物油かどうかは AI が判定し（services/mineral-oil-judge.ts）、その判定をここに覚える。
 * 代わりの商品の確認（alternative-gate.ts）は、ここの判定だけを読む（確認は同期のまま。判定は確認の前に取ってくる）。
 * docs/plans/mineral-oil-avoid-request.md「Step 4」
 */
import { BoundedCache } from '../utils/bounded-cache';
import { LISTED_NAME_SEPARATOR, normalizeIngredientName } from '../utils/ingredient-name';
import { findMatchingKnownIngredient } from './ingredient-match';

export const MINERAL_OIL_VERDICTS = ['mineral_oil', 'not_mineral_oil', 'unsure'] as const;
export type MineralOilVerdict = (typeof MINERAL_OIL_VERDICTS)[number];

/** 炭化水素・ロウの名前（正規化した名前に対して） */
const HYDROCARBON =
  /パラフィン|イソブテン|ポリブテン|デカン|エイコサン|アルカン|デセン|オレフィン|ポリエチレン|ワックス|paraffin|isobutene|polybutene|decane|eicosane|alkane|decene|olefin|polyethylene|wax/;
/**
 * 炭化水素ではない（酸・塩・エステル・グリコール・スルホン酸・ポリマー。「ポリエチレングリコール」「パラフィンスルホン酸Na」）、
 * または名前で植物・動物のロウと分かる（ミツロウ・キャンデリラ・カルナウバ・ライスワックス等。聞かず、外さない）
 */
const NOT_HYDROCARBON =
  /酸|グリコール|エーテル|エステル|スルホ|ポリマー|共重合|ミツロウ|ビーズ|ビーワックス|キャンデリラ|カルナウバ|ライス|コメヌカ|ヒマワリ|ホホバ|ラノリン|glycol|acid|ether|ester|sulf|peg|polymer|bees|candelilla|carnauba|rice|sunflower|jojoba|lanolin/;

/**
 * 成分表示の1項目のうち、鉱物油かを AI に判定させる名前（name は表示のまま、norm は正規化した名前。無ければ空）。
 * 成分DBで鉱物油と決まる名前（流動パラフィン・マイクロクリスタリンワックス等）は聞かない
 */
export function unclearHydrocarbonNames(raw: string): { name: string; norm: string }[] {
  const cached = unclearNames.get(raw);
  if (cached) return cached;
  const names = raw
    .split(LISTED_NAME_SEPARATOR)
    .map((part) => ({ name: part.normalize('NFKC').trim(), norm: normalizeIngredientName(part) }))
    .filter(
      ({ name, norm }) =>
        norm && HYDROCARBON.test(norm) && !NOT_HYDROCARBON.test(norm) && findMatchingKnownIngredient(name)?.id !== 'mineral_oil'
    );
  // 長い名前は覚えない（findMatchingKnownIngredient と同じ）
  if (raw.length <= 200) unclearNames.set(raw, names);
  return names;
}
/** 成分表示の1項目 → 判定させる名前（同じ成分は多くの製品に出てくるので、分け方を覚える） */
const unclearNames = new BoundedCache<{ name: string; norm: string }[]>(5000);

/** 正規化した名前 → AI の判定（このアイソレートの分。KV にも30日残す） */
const verdicts = new BoundedCache<MineralOilVerdict>(2000);

export function mineralOilVerdict(norm: string): MineralOilVerdict | undefined {
  return verdicts.get(norm);
}

export function rememberMineralOilVerdict(norm: string, verdict: MineralOilVerdict): void {
  verdicts.set(norm, verdict);
}

/**
 * 鉱物油を避けるとき、この項目を鉱物油でないと確かめられないか。判定が「鉱物油でない」の名前だけが通る
 * （判定が無い・「鉱物油」・「分からない」は通さない。返事で「含まない」と言うので、確かめられない物は出さない）
 */
export function mayBeMineralOil(raw: string): boolean {
  return unclearHydrocarbonNames(raw).some(({ norm }) => verdicts.get(norm) !== 'not_mineral_oil');
}
