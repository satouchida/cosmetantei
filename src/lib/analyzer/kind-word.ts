/**
 * アプリの種類に無い、頼まれた種類の語（「下地」「シャンプー」）。その種類の商品かは、商品名ごとに AI が判定し
 * （services/kind-word-judge.ts）、その判定をここに覚える。代わりの商品の確認（alternative-gate.ts）は、ここの判定だけを読む
 */
import { BoundedCache } from '../utils/bounded-cache';
import { normalizeIngredientName } from '../utils/ingredient-name';

export const KIND_WORD_VERDICTS = ['fits', 'other', 'unsure'] as const;
export type KindWordVerdict = (typeof KIND_WORD_VERDICTS)[number];

/** 判定を覚える商品名（成分名と同じ正規化。空白・記号の違いを同じにする） */
export function kindWordName(name: string): string {
  return normalizeIngredientName(name);
}

/** 語と正規化した商品名 → AI の判定（このアイソレートの分） */
const verdicts = new BoundedCache<KindWordVerdict>(5000);

export function kindWordVerdict(word: string, name: string): KindWordVerdict | undefined {
  return verdicts.get(`${word}\u0000${name}`);
}

export function rememberKindWordVerdict(word: string, name: string, verdict: KindWordVerdict): void {
  verdicts.set(`${word}\u0000${name}`, verdict);
}

/** 商品が頼まれた種類の物と確かめられたか（判定が「当たる」だけ。無い・「当たらない」・「分からない」は出さない） */
export function fitsKindWord(word: string, productName: string): boolean {
  return kindWordVerdict(word, kindWordName(productName)) === 'fits';
}
