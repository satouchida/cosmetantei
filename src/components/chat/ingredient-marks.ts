/**
 * 成分ボタンの1文字の印・段階の名前・凡例（IngredientAnalysisCard で使う）。
 * 画面の部品から分けて、テストで印そのものを確かめられるようにしている（docs/plans/live-review-4-fixes.md）
 */
import type { AnalyzedIngredient } from '@/lib/types';
import { riskOf } from '../ui/design';

/** 日本の化粧品基準で、この製品の種類には配合できない成分（別表第1は全化粧品） */
export const outsideStandard = (ing: AnalyzedIngredient): boolean => !!ing.jpStandard?.notAllowedHere;

/** 刺激の段階のほうが強い印になる成分（基準の外でも、段階の色と印を残す） */
export const isIrritantLevel = (ing: AnalyzedIngredient): boolean =>
  ing.riskLevel === 'high_irritant' || ing.riskLevel === 'moderate_irritant' || ing.riskLevel === 'active_caution';

/**
 * 総合判定で「軽度の注意」に数える成分（表示指定成分で引き上げただけの成分は除く）。
 * カードの「軽度の注意の成分」（src/lib/caution-reason.ts）と同じ。基準の外でも「注」を付け、数を合わせる
 */
const isMildLevel = (ing: AnalyzedIngredient): boolean => ing.riskLevel === 'low_caution' && !ing.raisedForLabel;

/** 基準の外でも、段階の印を残す成分 */
const keepsLevelMark = (ing: AnalyzedIngredient): boolean => isIrritantLevel(ing) || isMildLevel(ing);

/** 表示指定成分の印（「注」と分け、「軽度の注意の成分」の数とボタンの数を合わせる） */
export const RAISED_MARK = '表';

/** ボタンの1文字の印。基準の外は「基準」（段階の印もあれば「基準・高」「基準・注」）。表示指定成分で引き上げた成分は「表」 */
export function pillMark(ing: AnalyzedIngredient): string {
  const mark = riskOf(ing.riskLevel).mark;
  if (!outsideStandard(ing)) return ing.raisedForLabel ? RAISED_MARK : mark;
  return keepsLevelMark(ing) && mark ? `基準・${mark}` : '基準';
}

/** 成分の段階の名前。表示指定成分で引き上げた成分は、理由の名前で示す（「軽度の注意」と「刺激になりにくい」を並べない） */
export function riskLabelFor(ing: AnalyzedIngredient): string {
  return ing.raisedForLabel ? '表示指定成分' : riskOf(ing.riskLevel).label;
}

/** 全成分リストの凡例（この一覧にある印だけ）。段階 → 表 → 基準の順 */
export function legendEntries(ingredients: AnalyzedIngredient[]): string[] {
  // 基準の外の成分は、段階の印も出しているときだけ段階の凡例に数える。
  // 表示指定成分で引き上げた成分は「表」なので、段階（「注」）には数えない
  const levels = [
    ...new Set(ingredients.filter((i) => (!outsideStandard(i) || keepsLevelMark(i)) && !i.raisedForLabel).map((i) => i.riskLevel)),
  ].filter((l) => riskOf(l).mark);
  const entries = levels.map((l) => `${riskOf(l).mark}＝${riskOf(l).label}`);
  if (ingredients.some((i) => i.raisedForLabel && !outsideStandard(i))) entries.push(`${RAISED_MARK}＝表示指定成分`);
  if (ingredients.some(outsideStandard)) entries.push('基準＝日本の化粧品基準で配合できない');
  return entries;
}
