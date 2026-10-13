/**
 * 成分名の正規化（全角英数を半角に、小文字化、空白・ハイフン・中点・スラッシュ・括弧の除去）。
 * 成分DBとの照合（ingredient-analyzer）とルールの解説（dynamic-ingredient-service）で同じものを使う
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
