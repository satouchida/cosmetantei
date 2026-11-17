import { Product } from '../types';
import { AlternativeCategory, BODY_ONLY, FACE_ONLY, mostCommon, productCategory } from './product-category';

/**
 * 製品の形（ミスト・ジェル等）と使う場所（顔・からだ）、日焼け止めの SPF・PA・ウォータープルーフ。名前の決まった語から読む
 * （docs/plans/alternative-search-improvements.md「Path 2」）。代わりの商品の並べ替えにだけ使い、形で候補を外さない。
 * ブラウザのカードでも読めるように、サーバー専用のものは読み込まない
 */

export type ProductForm = 'mist' | 'sheet' | 'stick' | 'foam' | 'balm' | 'oil' | 'gel' | 'milk' | 'cream' | 'powder' | 'water';

export interface FormProfile {
  form?: ProductForm;
  use?: 'face' | 'body';
  /** 日焼け止めだけ */
  spf?: number;
  /** PA の + の数（日焼け止めだけ） */
  pa?: number;
  /** ウォータープルーフと書いてある（日焼け止めだけ） */
  waterproof?: boolean;
}

/**
 * 形の語（先に一致したものを使う）
 * - ミストが最初（「オイルミスト」「ミスト化粧水」はミスト）。シート・スティック・泡が次（「泡洗顔」「クレンジングフォーム」は泡）
 * - バーム・オイルがジェル・ミルク・クリームより先（「クレンジングバーム」「クレンジングオイル」）。「オイルフリー」「ノンオイル」は
 *   オイルではない
 * - ジェルがミルク・クリームより先（「ジェル乳液」「ジェルクリーム」はジェル）。ミルクがクリームより先
 * - パウダーは液の形より後（「パウダー配合 UV ミルク」はミルク）
 * - 水は最後。「化粧水」「保水」「防水」「水分」「水性」「水溶性」は水の形ではない。「ウォータープルーフ」はウォーターではない
 */
const FORM_WORDS: readonly [RegExp, ProductForm][] = [
  [/ミスト|スプレー/, 'mist'],
  [/シート/, 'sheet'],
  [/スティック/, 'stick'],
  [/泡|フォーム|ホイップ/, 'foam'],
  [/バーム/, 'balm'],
  [/(?<!ノン)オイル(?!フリー|カット)/, 'oil'],
  [/ジェル|ゲル/, 'gel'],
  [/ミルク|乳液|エマルジョン|エマルション/, 'milk'],
  [/クリーム/, 'cream'],
  [/パウダー/, 'powder'],
  [/ウォーター(?!プルーフ)|ウオーター(?!プルーフ)|(?<!化粧|保|防)水(?!分|性|溶)/, 'water'],
];

const SPF = /SPF\s*(\d{1,3})/i;
const PA = /PA\s*(\+{1,4})/i;
const WATERPROOF = /ウォータープルーフ|ウオータープルーフ|water\s?proof|耐水/i;

/** 名前・文章の形 */
export function formFromText(text: string): ProductForm | undefined {
  const t = text.normalize('NFKC');
  return FORM_WORDS.find(([pattern]) => pattern.test(t))?.[1];
}

/** 名前・文章から形・使う場所・（日焼け止めなら）SPF・PA・ウォータープルーフを読む。書いていないものは入れない */
export function formProfile(text: string, kind: AlternativeCategory | undefined): FormProfile {
  const t = text.normalize('NFKC');
  const form = formFromText(t);
  const use = BODY_ONLY.test(t) ? 'body' : FACE_ONLY.test(t) ? 'face' : undefined;
  const profile: FormProfile = { ...(form && { form }), ...(use && { use }) };
  if (kind !== 'sunscreen') return profile;
  const spf = SPF.exec(t);
  const pa = PA.exec(t);
  return {
    ...profile,
    ...(spf && { spf: Number(spf[1]) }),
    ...(pa && { pa: pa[1].length }),
    ...(WATERPROOF.test(t) && { waterproof: true }),
  };
}

/** 肌荒れしたコスメのうち、その種類の製品に多い形（比較リストから探すとき）。同数・無ければ undefined */
export function mostCommonForm(products: Pick<Product, 'category' | 'name'>[], kind: AlternativeCategory | undefined): ProductForm | undefined {
  return mostCommon(products.filter((p) => kind && productCategory(p) === kind).map((p) => formFromText(p.name)));
}

/** SPF の帯（30 未満・30〜49・50 以上）。同じ帯なら近いとみなす */
const spfBand = (spf: number) => (spf >= 50 ? 2 : spf >= 30 ? 1 : 0);

/**
 * 分析した製品と候補の近さ（大きいほど先）。同じ形 → 同じ使う場所 → 日焼け止めの SPF の帯・PA・ウォータープルーフの順に重い。
 * 分析した製品に書いていないことは比べない（何も書いていなければ、どの候補も 0 で今までの順のまま）
 */
export function formSimilarity(wanted: FormProfile, candidate: FormProfile): number {
  let score = 0;
  if (wanted.form && candidate.form === wanted.form) score += 100;
  if (wanted.use && candidate.use === wanted.use) score += 10;
  if (wanted.spf !== undefined && candidate.spf !== undefined && spfBand(candidate.spf) === spfBand(wanted.spf)) score += 1;
  if (wanted.pa !== undefined && candidate.pa === wanted.pa) score += 1;
  if (wanted.waterproof && candidate.waterproof) score += 1;
  return score;
}

/** 分析した製品に対して取りうる、いちばん大きい近さ（お店の候補を、それ以上確かめなくてよいかを決める） */
export function bestFormSimilarity(wanted: FormProfile): number {
  return formSimilarity(wanted, wanted);
}

/** 並べ替えに使えることが書いてあるか */
export function hasFormProfile(profile: FormProfile | undefined): profile is FormProfile {
  return !!profile && bestFormSimilarity(profile) > 0;
}
