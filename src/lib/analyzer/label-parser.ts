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

/**
 * 成分表示の読み取り方式の版。分け方を変えたら上げる。
 * 2: 2026-10-12 このパーサー（それ以前の Open Beauty Facts の製品は「,」「・」「/」で機械的に分けていた）
 */
export const LABEL_FORMAT = 2;

/**
 * 古い方式で分けた成分表示を持つ保存済みの製品か。元の文字列が無く直せないため、読み込まずに取り直す
 * （Web ページ由来の製品は Gemini が1成分ずつ返していたため対象外）
 */
export function hasStaleLabel(p: Product): boolean {
  return p.ingredientSource === 'open_beauty_facts' && p.labelFormat !== LABEL_FORMAT;
}

/** 製品データの上限。サーバーが作った製品が、ブラウザから送り返されたときの検証（validation.ts）を通るようにそろえる */
export const LABEL_LIMITS = { ingredients: 300, activeIngredients: 30, undisclosed: 999 } as const;
/**
 * 読み取る成分表示の長さの上限。これより長い文字列は読まない（成分表示として長すぎる。Open Beauty Facts・お店の説明など
 * ほかの人が書いた文字列で、読み取りの時間が延びすぎないように）
 */
export const MAX_PARSE_LENGTH = 10_000;

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
// 空白は上限つき（\s* を並べると、印の後に長い空白が続く入力で指数的に遅くなる）
const MARK_LEGEND =
  /([※*★☆])\s{0,3}(?:印|マーク)?\s{0,3}(?:の(?:付いた|ついた|ある)?成分)?\s{0,3}(?:は|:|=)?\s{0,3}[「『]?有効成分[」』]?(?:です|であります|を示す|を示します|を表す)?(?!\s*:)/g;
/**
 * 「有効成分」「その他の成分」の見出し。文頭・区切りの後・括弧の中、または後ろに「:」が続くもの
 * （「…ジカリウムその他の成分:精製水」のように前の成分に続けて書かれても見出しとわかる）。文中の「有効成分」では区切らない
 */
const GROUP_HEADING =
  /(?:(?:^|(?<=[\s、,;。]))[※*★☆]?[【\[<(]?\s*(有効成分|その他の成分)\s*[】\]>)]?\s*:?|[【\[<(]?(有効成分|その他の成分)[】\]>)]?\s*:)/g;
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
 *   ほかの区切りが無いラベル（「水・BG・グリセリン」）でだけ区切りとして扱い、名称の一部と判断できる部分はつなぎ直す
 *   （rejoinNameParts）
 */
export function splitIngredientList(text: string): string[] {
  const s = text.normalize('NFKC');
  const isSeparator = (ch: string, i: number, useSecondary: boolean, current: string): boolean => {
    if (ch === '、' || ch === ';' || ch === '\n' || ch === '\r') return true;
    if (ch === ',') {
      // 位置番号：1〜2桁の数字だけの語の後で、後ろが「2-」「2,6-」のように続く。
      // 見るのは前後の数文字だけ（「1,1,1,…」のような長い列で、「,」ごとに全体を読み直して遅くならないように）
      const isLocant =
        /(?:^|[\s(,・/])\d{1,2}$/.test(current.slice(-3)) && /^\d{1,2}(?:,\d{1,2}){0,5}-/.test(s.slice(i + 1, i + 25));
      return !isLocant;
    }
    return useSecondary && (ch === '・' || ch === '/');
  };

  const split = (useSecondary: boolean, trackBrackets = true): NamePart[] => {
    const items: NamePart[] = [];
    let depth = 0;
    let current = '';
    let sep = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (trackBrackets) {
        if (OPENERS.includes(ch)) depth++;
        else if (CLOSERS.includes(ch)) depth = Math.max(0, depth - 1);
      }
      if (depth === 0 && isSeparator(ch, i, useSecondary, current)) {
        items.push({ text: current, sep });
        current = '';
        sep = ch;
      } else {
        current += ch;
      }
    }
    items.push({ text: current, sep });
    if (trackBrackets && depth > 0) return split(useSecondary, false);
    return items.map((p) => ({ ...p, text: cleanItem(p.text) })).filter((p) => p.text);
  };

  const primary = split(false);
  if (primary.length <= 1) return rejoinNameParts(split(true));
  // 主な区切りがあっても、「・」が2つ以上残る項目は「・」で並べた一覧が混ざったものとみなして分け直す
  // （改行1つで「・」区切りの一覧全体が1項目になるのを防ぐ）
  return primary.flatMap((p) =>
    (p.text.match(/・/g) ?? []).length >= 2 ? splitIngredientList(p.text) : [p.text]
  );
}

interface NamePart {
  text: string;
  /** 直前の区切り文字（先頭は空） */
  sep: string;
}

/*
 * 「・」「/」で区切ったときに、名称の一部と判断できる部分のつなぎ直し。
 * 日本化粧品工業連合会「医薬部外品簡略名作成ガイドライン」(2006) 8-2 の「・」の使い方による:
 * 略号と略号の間（「硫酸Al・K」）、共重合体の成分の間（「アクリル酸アルキル・VA共重合体液」「POE・POPラノリン」）、
 * 複合体の成分の間。化粧品の表示名称では「PEG/PPG-14/7ジメチルエーテル」のように「/」も使われる。
 * 成分名の一覧（JCIA の名称リスト）は使わない（サイトポリシーにより無断の複製・加工ができないため）
 */
/** 単独では成分にならない元素記号（「硫酸Al・K」の「K」、「〜・2Na」） */
const ELEMENT_PART = /^\d?(?:Li|Na|K|Mg|Ca|Ba|Zr|Al|Zn|Fe|Ti|Cr|Bi|Co)$/;
/** 後ろの成分名に続く略号（「POE・POPラノリン」の「POE」「POE・POP」） */
const PREFIX_PART = /^(?:(?:POE|POP|PEG|PPG)[・/])*(?:POE|POP|PEG|PPG)$/i;
/** 単独の成分名になる略号。略号の後ろでも取り込まない（「PEG・BG」にしない） */
const STANDALONE_ABBREVIATION = /^(?:BG|PG|DPG|TEA|DEA|MEA|EDTA)$/i;
/** 「PEG/PPG-14/7ジメチルエーテル」：付加モル数の「14/7」 */
const MOLE_NUMBER_BEFORE = /(?:PEG|PPG)-?\d+$/i;
/** 付加モル数で始まる部分（位置番号の「1,2-」「2-」は除く） */
const MOLE_NUMBER_AFTER = /^\d{1,3}(?![\d,.-])/;
/**
 * 共重合体の名称の末尾。ガイドライン 8-2 の「・」は共重合体の単量体の間に入る。
 * 「〜クロスポリマー」「〜コポリマー」は化粧品の表示名称で、単独の成分名として多いので対象にしない
 */
const POLYMER_PART = /共重合体(?:液|末|エマルション|エマルジョン|分散液)?$/;
/**
 * 共重合体の単量体らしい名前。単独の成分として多い語（シクロペンタシロキサン等のシロキサン類、エチレン・プロピレンを
 * 含む界面活性剤、ピロリドンカルボン酸）は含めない。ジメチコンは共重合体の直前の1つだけ取り込む
 */
const MONOMER_LIKE = /アクリル|メタクリル|スチレン|ビニル(?!ジメチコン)|マレイン|ウレタン|ジフェニルポリシロキサン|^ブチレン$|^POE$|^POP$|^VA$|^VP$|HEMA/i;
const MONOMER_NEXT_TO_POLYMER = /^ジメチコン$/;
/** 単量体のような語を含むが、単独の成分であることが多いもの（BG・PG・DPG・グリセリン類・EDTA） */
const STANDALONE_LIKE = /グリコール|グリセリン|EDTA|エデト酸/i;
const MAX_MONOMERS = 4;
/** 化粧品基準で配合が決められている混合液（メチルクロロイソチアゾリノンとメチルイソチアゾリノンの混合物）の名称 */
const MCI_MI_PARTS = [/^メチルクロロイソチアゾリノン$/, /^メチルイソチアゾリノン液$/] as const;

function rejoinNameParts(parts: NamePart[]): string[] {
  const out: NamePart[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = { ...parts[i] };
    const prev = out[out.length - 1];
    if (prev && ELEMENT_PART.test(part.text)) {
      prev.text += part.sep + part.text;
      continue;
    }
    if (prev && part.sep === '/' && MOLE_NUMBER_BEFORE.test(prev.text) && MOLE_NUMBER_AFTER.test(part.text)) {
      prev.text += part.sep + part.text;
      continue;
    }
    if (prev && part.sep === '・' && MCI_MI_PARTS[0].test(prev.text) && MCI_MI_PARTS[1].test(part.text)) {
      prev.text += part.sep + part.text;
      continue;
    }
    // 略号どうし（POE・POP）はつなぐが、単量体（ブチレン等）は後の共重合体の名称に取り込ませるためつながない
    const isMonomer = MONOMER_LIKE.test(part.text) && !PREFIX_PART.test(part.text);
    if (prev && PREFIX_PART.test(prev.text) && !STANDALONE_ABBREVIATION.test(part.text) && !isMonomer) {
      prev.text += part.sep + part.text;
      continue;
    }
    if (POLYMER_PART.test(part.text) && !part.text.startsWith('(')) {
      // 直前の「・」区切りの単量体らしい部分を、共重合体の名称に取り込む
      for (let absorbed = 0; absorbed < MAX_MONOMERS && part.sep === '・'; absorbed++) {
        const last = out[out.length - 1];
        const monomer =
          !!last &&
          (MONOMER_LIKE.test(last.text) ||
            PREFIX_PART.test(last.text) ||
            (absorbed === 0 && MONOMER_NEXT_TO_POLYMER.test(last.text))) &&
          !STANDALONE_LIKE.test(last.text) &&
          !POLYMER_PART.test(last.text);
        if (!monomer) break;
        out.pop();
        part.text = `${last.text}・${part.text}`;
        part.sep = last.sep;
      }
    }
    out.push(part);
  }
  return out.map((p) => p.text);
}

/**
 * 前後の、isTrimmed に当たる文字を取り除く。正規表現の [...]+$ は、途中に長い連続があると
 * 始める位置ごとに読み直して遅くなるため、前後から1文字ずつ見る
 */
function trimEnds(item: string, isTrimmed: (ch: string) => boolean): string {
  let start = 0;
  let end = item.length;
  while (start < end && isTrimmed(item[start])) start++;
  while (end > start && isTrimmed(item[end - 1])) end--;
  return item.slice(start, end);
}

const CLEANED_CHARS = /[\s"'。.]/;
/** 前後の空白・句点・引用符を取り除く */
function cleanItem(item: string): string {
  return trimEnds(item, (ch) => CLEANED_CHARS.test(ch));
}

/** 成分名の前後に付いた印（※ * 等）。印の説明に関係なく名称からは取り除く */
const ITEM_MARKS = '※*★☆';
function withoutItemMarks(item: string): string {
  return trimEnds(item, (ch) => ITEM_MARKS.includes(ch));
}

/** 空白の連続は1つにまとめる（改行を含む連続は改行1つ）。区切りの判定は変わらず、正規表現の手戻りを抑える */
function collapseSpaces(s: string): string {
  return s.replace(/\s{2,}/g, (w) => (/[\n\r]/.test(w) ? '\n' : ' '));
}

const EMPTY_LABEL: ParsedLabel = { ingredients: [], activeIngredients: [], isQuasiDrug: false, undisclosedCount: 0 };

/**
 * 全成分表示の文字列を読み取る。医薬部外品の2グループ・※印の両方の書き方に対応する
 */
export function parseIngredientLabel(text: string): ParsedLabel {
  // NFKC で長くなる文字（「﷽」など）もあるので、正規化の後でも確かめる
  const normalized = text.length > MAX_PARSE_LENGTH ? '' : text.normalize('NFKC');
  if (!normalized || normalized.length > MAX_PARSE_LENGTH) return { ...EMPTY_LABEL, ingredients: [], activeIngredients: [] };
  let s = collapseSpaces(normalized);

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

  // 上の置き換えで改行が並ぶので、もう一度まとめる（QUASI_DRUG_LABEL・GROUP_HEADING の \s* が長い連続を読み直さないように）
  s = collapseSpaces(s);

  let isQuasiDrug = activeMarks.size > 0;
  s = collapseSpaces(
    s.replace(QUASI_DRUG_LABEL, () => {
      isQuasiDrug = true;
      return '\n';
    })
  );
  s = s.replace(LIST_HEADING, '');

  // 見出しで区切る。最初の見出しより前は「その他の成分」として扱う
  const ingredients: string[] = [];
  const activeIngredients: string[] = [];
  let group: 'active' | 'other' = 'other';
  let last = 0;
  for (const m of s.matchAll(GROUP_HEADING)) {
    (group === 'active' ? activeIngredients : ingredients).push(...splitIngredientList(s.slice(last, m.index)));
    group = (m[1] ?? m[2]) === '有効成分' ? 'active' : 'other';
    isQuasiDrug = true;
    last = m.index + m[0].length;
  }
  (group === 'active' ? activeIngredients : ingredients).push(...splitIngredientList(s.slice(last)));

  // ※印の書き方：印の付いた成分を有効成分にする
  const others: string[] = [];
  for (const item of ingredients) {
    const marked = [...activeMarks].some((mark) => item.startsWith(mark) || item.endsWith(mark));
    const name = cleanItem(withoutItemMarks(item));
    if (!name) continue;
    (marked ? activeIngredients : others).push(name);
  }

  return {
    ingredients: others,
    activeIngredients: activeIngredients.map((i) => cleanItem(withoutItemMarks(i))).filter(Boolean),
    isQuasiDrug,
    undisclosedCount,
  };
}

/**
 * 読み取った成分表示の、Product に入れる項目（医薬部外品の項目は該当するときだけ）。
 * 成分が LABEL_LIMITS.ingredients を超えるものは、成分表示として読めなかったものとして空にする。
 * 末尾を切ると、表示の最後に書かれる防腐剤・香料・着色剤が抜けたまま「全成分」として扱われるので
 */
export function labelProductFields(
  label: ParsedLabel
): Pick<Product, 'ingredients' | 'activeIngredientsJa' | 'isQuasiDrug' | 'undisclosedIngredientCount' | 'labelFormat'> {
  if (label.ingredients.length > LABEL_LIMITS.ingredients) return { labelFormat: LABEL_FORMAT, ingredients: [] };
  return {
    labelFormat: LABEL_FORMAT,
    ingredients: label.ingredients,
    ...(label.activeIngredients.length > 0 && {
      activeIngredientsJa: label.activeIngredients.slice(0, LABEL_LIMITS.activeIngredients),
    }),
    ...(label.isQuasiDrug && { isQuasiDrug: true }),
    ...(label.undisclosedCount > 0 && { undisclosedIngredientCount: label.undisclosedCount }),
  };
}
