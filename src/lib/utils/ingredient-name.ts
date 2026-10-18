/**
 * 成分名の正規化（全角英数を半角に、小文字化、空白・ハイフン・中点・スラッシュ・括弧の除去）。
 * 成分DBとの照合（ingredient-analyzer）・ルールの解説（dynamic-ingredient-service）・化粧品基準（jp-standards）で同じものを使う
 */
/**
 * 小麦由来であることの注記（「グリセリン（小麦由来）」）。厚生労働省の2011年の通知
 * （薬食審査発0909第1号）で、成分名のあとにカッコ書きで付ける。成分名の照合では除く
 */
export const WHEAT_ORIGIN_NOTE = /[(（]\s*(?:小麦|コムギ|こむぎ)\s*(?:に)?由来(?:成分)?\s*[)）]/;
const WHEAT_ORIGIN_NOTE_ALL = new RegExp(WHEAT_ORIGIN_NOTE.source, 'g');

/** 小麦由来の成分か（注記がある、または名前に小麦・コムギ・wheat が入る。buckwheat はソバ） */
export function isWheatDerivedName(raw: string): boolean {
  if (WHEAT_ORIGIN_NOTE.test(raw)) return true;
  const n = raw.normalize('NFKC').toLowerCase();
  return /コムギ|小麦|トリティカム|triticum/.test(n) || /(?<!buck)wheat/.test(n.replace(/\s+/g, ''));
}

export function normalizeIngredientName(name: string): string {
  if (!name) return '';
  // 全角英数（ＢＧ・ＤＰＧ など、Web ページの成分表示に多い）を半角にそろえる
  return name
    .normalize('NFKC')
    .replace(WHEAT_ORIGIN_NOTE_ALL, '')
    .trim()
    .toLowerCase()
    .replace(/[\(\)（）]/g, '')
    // ハイフンの仲間（‐ ‑ ‒ – — ― −）も区切りとして外す。「ー」（長音）は名前の一部なので残す
    .replace(/[\s\-_・/\u2010-\u2015\u2212]/g, '');
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
