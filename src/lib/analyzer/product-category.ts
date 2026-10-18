import { Product } from '../types';

/**
 * 製品の種類（日焼け止め・化粧水 等）。代わりの商品は同じ種類からだけ選ぶ（docs/plans/alternative-recommendations.md）
 * ブラウザのカードでも使うので、サーバー専用のものは読み込まない
 */

export type AlternativeCategory = Exclude<Product['category'], 'other'>;

export const CATEGORY_LABELS_JA: Readonly<Record<AlternativeCategory, string>> = {
  cleanser: '洗顔料',
  toner: '化粧水',
  serum: '美容液',
  cream: 'クリーム',
  sunscreen: '日焼け止め',
  mask: 'パック',
  lip: 'リップ',
};

/**
 * 文章・製品名に出てくる種類の言葉（先に一致したものを使う）
 * - 日焼け止め落としは洗顔料（日焼け止めより先に見る）
 * - リップが日焼け止め・クリームより先（「リップクリーム UV」はリップ）。カタカナの語の一部（フィリップ・
 *   チューリップ・クリップ）は除く。「唇」は「唇が荒れた」のように症状の文に出るので使わない
 * - 日焼け止めが洗顔料より先（「クレンジング不要の日焼け止め」「洗顔料で落とせる UV ミルク」は日焼け止め）
 * - 「洗顔後の化粧水」は洗顔料ではない
 * - UV は単語のときだけ（Nuvo 等の名前の一部は除く）
 */
const CATEGORY_WORDS: readonly [RegExp, AlternativeCategory][] = [
  [/日焼け止め落とし|(?<![a-z])uv(クレンジング|リムーバー)/i, 'cleanser'],
  [/(?<![ァ-ヴー])リップ|口紅|\blips?\b/i, 'lip'],
  [/日焼け止め|サンスクリーン|sunscreen|(?<![a-z])uv(?![a-z])/i, 'sunscreen'],
  [/洗顔(?!後)|クレンジング(?!後)|メイク落とし|\bcleanser\b/i, 'cleanser'],
  [/化粧水|ローション|トナー|\btoner\b/i, 'toner'],
  [/美容液|セラム|エッセンス|\bserum\b/i, 'serum'],
  [/クリーム|乳液|ミルク|保湿ジェル/, 'cream'],
  [/パック|シートマスク/, 'mask'],
];

export function categoryFromText(text: string): AlternativeCategory | undefined {
  const t = text.normalize('NFKC');
  return CATEGORY_WORDS.find(([pattern]) => pattern.test(t))?.[1];
}

const isAlternativeCategory = (c: string): c is AlternativeCategory => Object.hasOwn(CATEGORY_LABELS_JA, c);

/**
 * 製品の種類。「その他」なら製品名から推し量る（「UV」→ 日焼け止め）。分からなければ undefined
 * 名前がリップなら、保存された種類より名前を使う（ページの読み取りでリップクリームが「クリーム」になることがある）
 */
export function productCategory(product: Pick<Product, 'category' | 'name'>): AlternativeCategory | undefined {
  const fromName = categoryFromText(product.name);
  if (fromName === 'lip') return 'lip';
  return isAlternativeCategory(product.category) ? product.category : fromName;
}

/** 製品に多い種類（比較の肌荒れしたコスメ等）。どれも分からない・同数で決まらなければ undefined */
export function mostCommonCategory(products: Pick<Product, 'category' | 'name'>[]): AlternativeCategory | undefined {
  const counts = new Map<AlternativeCategory, number>();
  for (const p of products) {
    const c = productCategory(p);
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return undefined;
  return ranked[0]?.[0];
}
