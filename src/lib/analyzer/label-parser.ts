/**
 * 全成分表示の読み取り（化粧品・医薬部外品）
 *
 * 医薬部外品の成分表示は業界の自主基準（日本化粧品工業連合会「医薬部外品の成分表示に係る基本方針」2006年）による:
 * - 「有効成分」と「その他の成分」の2グループに分けるか、※印等を付けて印の説明を別に書く（§7）
 * - 企業秘密の成分は名称を書かず「他 n成分」と書ける（§3(2)）
 * - 「その他の成分」の記載順は企業の判断で、配合量順とは限らない（§8）
 * 手順と出典: docs/plans/japan-ingredient-data.md
 */

import { Product } from '../types';

/** 製品データの上限。サーバーが作った製品が、ブラウザから送り返されたときの検証（validation.ts）を通るようにそろえる */
export const LABEL_LIMITS = { ingredients: 300, activeIngredients: 30, undisclosed: 999 } as const;

export interface ParsedLabel {
  /** 有効成分以外の成分（化粧品は全成分） */
  ingredients: string[];
  /** 医薬部外品の有効成分 */
  activeIngredients: string[];
  /** 「有効成分」の見出し・印の説明、または「医薬部外品」の記載があった */
  isQuasiDrug: boolean;
  /** 「他 n成分」で名称が書かれていない成分の数 */
  undisclosedCount: number;
}

/**
 * 有効成分を示す印の説明（「※印は有効成分」「*:有効成分」「※印の成分は有効成分です」「※有効成分」等）。
 * 「※有効成分:トラネキサム酸」のように後ろに「:」が続くものは見出しなので除く
 */
const MARK_LEGEND =
  /([※*★☆])\s*(?:印|マーク)?\s*(?:の(?:付いた|ついた|ある)?成分)?\s*(?:は|:|=)?\s*[「『]?有効成分[」』]?(?:です|であります|を示す|を示します|を表す)?(?!\s*:)/g;
/** 「有効成分」「その他の成分」の見出し。文頭・区切りの後・括弧の中だけ（文中の「有効成分」では区切らない） */
const GROUP_HEADING = /(?:^|(?<=[\s、,;。]))[※*★☆]?[【\[<(]?\s*(有効成分|その他の成分)\s*[】\]>)]?\s*:?/g;
/** 「[医薬部外品]」等の区分の記載（「医薬部外品ではありません」は除く） */
const QUASI_DRUG_LABEL = /[【\[<(]?\s*医薬部外品(?!\s*(?:では|でな))\s*[】\]>)]?/g;
/** 「他 n成分」「その他 n 成分」 */
const UNDISCLOSED = /(?:その)?他\s*(\d{1,3})\s*成分/g;
/** 先頭の「全成分：」「【成分】」等の見出し */
const LIST_HEADING = /^\s*(?:[【\[<(]\s*(?:全成分(?:表示)?|成分|ingredients?)\s*[】\]>)]\s*:?|(?:全成分(?:表示)?|成分|ingredients?)\s*:)/i;

// 「<」「>」は「pH<7」のような本文にも出てくるため括弧として扱わない
const OPENERS = '([{「『【';
const CLOSERS = ')]}」』】';

/**
 * 成分の区切りで分ける。括弧の中では分けない
 * - 「、」「,」「;」改行で分ける。ただし位置番号の「,」（1,3-ブチレングリコール、1,2,6-ヘキサントリオール）は名称の一部。
 *   「ポリソルベート80,1,2-ヘキサンジオール」「CI 77891,77492」は区切る
 * - 括弧が閉じていなければ（壊れたテキスト）、括弧を無視して分け直す
 * - 「・」「/」は名称に含まれることが多い（医薬部外品の「〜・〜共重合体」、INCI の「〜/〜 Crosspolymer」）ため、
 *   ほかの区切りが無いラベル（「水・BG・グリセリン」）でだけ区切りとして扱う
 */
export function splitIngredientList(text: string): string[] {
  const s = text.normalize('NFKC');
  const isSeparator = (ch: string, i: number, useSecondary: boolean, current: string): boolean => {
    if (ch === '、' || ch === ';' || ch === '\n' || ch === '\r') return true;
    if (ch === ',') {
      // 位置番号：1〜2桁の数字だけの語の後で、後ろが「2-」「2,6-」のように続く
      const isLocant = /(?:^|[\s(,])\d{1,2}$/.test(current) && /^\d{1,2}(?:,\d{1,2})*-/.test(s.slice(i + 1));
      return !isLocant;
    }
    return useSecondary && (ch === '・' || ch === '/');
  };

  const split = (useSecondary: boolean, trackBrackets = true): string[] => {
    const items: string[] = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (trackBrackets) {
        if (OPENERS.includes(ch)) depth++;
        else if (CLOSERS.includes(ch)) depth = Math.max(0, depth - 1);
      }
      if (depth === 0 && isSeparator(ch, i, useSecondary, current)) {
        items.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    items.push(current);
    if (trackBrackets && depth > 0) return split(useSecondary, false);
    return items.map(cleanItem).filter(Boolean);
  };

  const primary = split(false);
  return primary.length > 1 ? primary : split(true);
}

/** 前後の空白・句点・引用符を取り除く */
function cleanItem(item: string): string {
  return item.replace(/^[\s"'。.]+|[\s"'。.]+$/g, '');
}

/** 成分名の前後に付いた印（※ * 等）。印の説明に関係なく名称からは取り除く */
const ITEM_MARK = /^[※*★☆]+|[※*★☆]+$/g;

/**
 * 全成分表示の文字列を読み取る。医薬部外品の2グループ・※印の両方の書き方に対応する
 */
export function parseIngredientLabel(text: string): ParsedLabel {
  let s = text.normalize('NFKC');

  const activeMarks = new Set<string>();
  s = s.replace(MARK_LEGEND, (_, mark: string) => {
    activeMarks.add(mark);
    return '\n';
  });

  let undisclosedCount = 0;
  s = s.replace(UNDISCLOSED, (_, n: string) => {
    undisclosedCount = Math.min(undisclosedCount + Number(n), LABEL_LIMITS.undisclosed);
    return '\n';
  });

  let isQuasiDrug = activeMarks.size > 0;
  s = s.replace(QUASI_DRUG_LABEL, () => {
    isQuasiDrug = true;
    return '\n';
  });
  s = s.replace(LIST_HEADING, '');

  // 見出しで区切る。最初の見出しより前は「その他の成分」として扱う
  const ingredients: string[] = [];
  const activeIngredients: string[] = [];
  let group: 'active' | 'other' = 'other';
  let last = 0;
  for (const m of s.matchAll(GROUP_HEADING)) {
    (group === 'active' ? activeIngredients : ingredients).push(...splitIngredientList(s.slice(last, m.index)));
    group = m[1] === '有効成分' ? 'active' : 'other';
    isQuasiDrug = true;
    last = m.index + m[0].length;
  }
  (group === 'active' ? activeIngredients : ingredients).push(...splitIngredientList(s.slice(last)));

  // ※印の書き方：印の付いた成分を有効成分にする
  const others: string[] = [];
  for (const item of ingredients) {
    const marked = [...activeMarks].some((mark) => item.startsWith(mark) || item.endsWith(mark));
    const name = cleanItem(item.replace(ITEM_MARK, ''));
    if (!name) continue;
    (marked ? activeIngredients : others).push(name);
  }

  return {
    ingredients: others,
    activeIngredients: activeIngredients.map((i) => cleanItem(i.replace(ITEM_MARK, ''))).filter(Boolean),
    isQuasiDrug,
    undisclosedCount,
  };
}

/** 読み取った成分表示の、Product に入れる項目（医薬部外品の項目は該当するときだけ） */
export function labelProductFields(
  label: ParsedLabel
): Pick<Product, 'ingredients' | 'activeIngredientsJa' | 'isQuasiDrug' | 'undisclosedIngredientCount'> {
  return {
    ingredients: label.ingredients.slice(0, LABEL_LIMITS.ingredients),
    ...(label.activeIngredients.length > 0 && {
      activeIngredientsJa: label.activeIngredients.slice(0, LABEL_LIMITS.activeIngredients),
    }),
    ...(label.isQuasiDrug && { isQuasiDrug: true }),
    ...(label.undisclosedCount > 0 && { undisclosedIngredientCount: label.undisclosedCount }),
  };
}
