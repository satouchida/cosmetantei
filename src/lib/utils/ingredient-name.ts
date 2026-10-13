/**
 * 成分名の正規化（全角英数を半角に、小文字化、空白・ハイフン・中点・スラッシュ・括弧の除去）。
 * 成分DBとの照合（ingredient-analyzer）・ルールの解説（dynamic-ingredient-service）・化粧品基準（jp-standards）で同じものを使う
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
