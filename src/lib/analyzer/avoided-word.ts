/**
 * 成分DBに無い、避けたいと書かれた語（「シリコンフリー」のシリコン）。ほかの成分と同じく避ける。
 * 成分名がその語に当たるか（ジメチコンは「シリコン」か）は AI が成分名ごとに判定し（services/avoided-word-judge.ts）、
 * その判定をここに覚える。代わりの商品の確認（alternative-gate.ts）は、ここの判定だけを読む（確認は同期のまま）
 */
import { BoundedCache } from '../utils/bounded-cache';
import { LISTED_NAME_SEPARATOR, normalizeIngredientName } from '../utils/ingredient-name';

export const AVOIDED_WORD_VERDICTS = ['contains', 'absent', 'unsure'] as const;
export type AvoidedWordVerdict = (typeof AVOIDED_WORD_VERDICTS)[number];

/** 判定を覚える名前（語と、正規化した成分名） */
function avoidedWordKey(word: string, norm: string): string {
  return `${word}\u0000${norm}`;
}

/** 成分表示の1項目の名前（name は表示のまま、norm は正規化した名前）。並んで入っている名前は分ける */
export function listedNames(raw: string): { name: string; norm: string }[] {
  const cached = names.get(raw);
  if (cached) return cached;
  const found = raw
    .split(LISTED_NAME_SEPARATOR)
    .map((part) => ({ name: part.normalize('NFKC').trim(), norm: normalizeIngredientName(part) }))
    .filter(({ norm }) => norm);
  // 長い名前は覚えない（findMatchingKnownIngredient と同じ）
  if (raw.length <= 200) names.set(raw, found);
  return found;
}
/** 成分表示の1項目 → 名前（同じ成分は多くの製品に出てくるので、分け方を覚える） */
const names = new BoundedCache<{ name: string; norm: string }[]>(5000);

/** 語と正規化した成分名 → AI の判定（このアイソレートの分。KV にも30日残す） */
const verdicts = new BoundedCache<AvoidedWordVerdict>(10000);

export function avoidedWordVerdict(word: string, norm: string): AvoidedWordVerdict | undefined {
  return verdicts.get(avoidedWordKey(word, norm));
}

export function rememberAvoidedWordVerdict(word: string, norm: string, verdict: AvoidedWordVerdict): void {
  verdicts.set(avoidedWordKey(word, norm), verdict);
}

/**
 * この項目が、避けたい語（正規化した語）に当たらないと確かめられないか。名前にその語がある（「シリコンパウダー」）か、
 * 判定が「当たらない」でない（無い・「当たる」・「分からない」）名前があれば true（返事で「含まない」と言うので、確かめられない物は出さない）
 */
export function mayContainAvoidedWord(word: string, raw: string): boolean {
  return listedNames(raw).some(({ norm }) => norm.includes(word) || verdicts.get(avoidedWordKey(word, norm)) !== 'absent');
}
