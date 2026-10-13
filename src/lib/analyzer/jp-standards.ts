import { Product } from '../types';
import {
  COSMETIC_STANDARD,
  COSMETIC_STANDARD_REFERENCE,
  StandardEntry,
  StandardLimit,
  StandardTable,
} from '../data/cosmetic-standards-jp';
import { abbreviateIngredientName, normalizeIngredientName } from '../utils/ingredient-name';

/**
 * 化粧品基準（cosmetic-standards-jp.ts）と成分表示の照合。
 * 化粧品基準は化粧品の基準なので、医薬部外品には使わない（医薬部外品は品目ごとの承認による）
 */

/** 化粧品基準の表の区分（告示の「粘膜に使用されることがない化粧品のうち洗い流すもの」など） */
export type StandardUseType = 'rinseOff' | 'leaveOn' | 'mucosa';

const USE_TYPE_JA: Record<StandardUseType, string> = {
  rinseOff: '洗い流す化粧品',
  leaveOn: '洗い流さない化粧品',
  mucosa: '粘膜に使用されることがある化粧品',
};

/**
 * 製品の種類から表の区分を決める。決められない種類は undefined。
 * リップ製品は undefined：口唇用の化粧品が「粘膜に使用されることがある化粧品」に当たるかは、告示にも
 * 化粧品基準の Q&A（令和3年3月25日事務連絡）にも定義が無いため（Q&A の定義は入浴用化粧品だけ）
 */
/** 洗い流さない洗浄料（拭き取り・シート・クレンジングウォーター等）。「洗い流すもの」とは決めない */
const WIPE_OFF = /拭き取り|ふきとり|シート|ウォーター|ミセラー|ワイプ|micellar|wipe|cleansing ?water/i;

export function productUseType(product: Pick<Product, 'category'> & { name?: string }): StandardUseType | undefined {
  switch (product.category) {
    case 'cleanser':
      return product.name && WIPE_OFF.test(product.name) ? undefined : 'rinseOff';
    case 'toner':
    case 'serum':
    case 'cream':
    case 'sunscreen':
      return 'leaveOn';
    default:
      return undefined;
  }
}

/** 物質群の名前から除くもの（オキシ塩化ビスマスは別表第1の対象外） */
const EXCEPT: Partial<Record<string, RegExp>> = {
  オキシ塩化ビスマス以外のビスマス化合物: /オキシ塩化ビスマス|ビスマスオキシクロリド|bismuthoxy(de)?chloride|bismuthoxidechloride/,
};

let entryNames: { entry: StandardEntry; names: Set<string> }[] | undefined;

/**
 * 成分名に当たる化粧品基準の項目。norm は normalizeIngredientName した名前、
 * abbreviated は簡略名（ナトリウム→Na 等）にそろえた名前
 */
export function findStandardEntry(norm: string, abbreviated: string = norm): StandardEntry | undefined {
  if (!norm) return undefined;
  entryNames ??= COSMETIC_STANDARD.map((entry) => ({
    entry,
    // 表示はどちらの書き方もある（「ピリチオン亜鉛」「ピリチオンZn」）ので、簡略形も照合する
    names: new Set(
      entry.names.flatMap((n) => {
        const norm = normalizeIngredientName(n);
        return norm ? [norm, abbreviateIngredientName(norm)] : [];
      })
    ),
  }));
  for (const { entry, names } of entryNames) {
    if (names.has(norm) || names.has(abbreviated)) return entry;
  }
  for (const { entry } of entryNames) {
    if (!entry.namePattern || !entry.namePattern.test(norm)) continue;
    if (EXCEPT[entry.nameJa]?.test(norm)) continue;
    return entry;
  }
  return undefined;
}

function limitJa(limit: StandardLimit): string {
  if (limit === 'any') return '上限なし';
  if (limit === 'banned') return '配合不可';
  return `100g中${limit}gまで`;
}

function purposeJa(table: StandardTable): string {
  if (table.startsWith('別表第3')) return '防腐剤として配合するときは';
  if (table.startsWith('別表第4')) return '紫外線吸収剤として配合するときは';
  return '';
}

export interface StandardNote {
  table: StandardTable;
  /** 成分の解説に添える文 */
  textJa: string;
  /** この製品の種類には配合できない（別表第1、または表の区分で配合不可） */
  notAllowedHere: boolean;
  /** 告示の PDF */
  referenceUrl: string;
}

/** 化粧品基準の項目を、成分の解説に添える文にする。useType はこの製品の区分（わからなければ undefined） */
export function standardNote(entry: StandardEntry, useType: StandardUseType | undefined): StandardNote {
  const head = `日本の化粧品基準（${entry.table}「${entry.nameJa}」）`;
  if (entry.table === '別表第1') {
    return {
      table: entry.table,
      textJa: `${head}で、化粧品への配合が禁止されている成分です。`,
      notAllowedHere: true,
      referenceUrl: COSMETIC_STANDARD_REFERENCE.url,
    };
  }

  const parts: string[] = [];
  const purpose = purposeJa(entry.table);
  const note = entry.noteJa ? `（${entry.noteJa}）` : '';
  if (entry.all !== undefined) {
    parts.push(`${purpose ? `${purpose}、` : ''}すべての化粧品で${limitJa(entry.all)}${note}。`);
  }
  const byType = (['rinseOff', 'leaveOn', 'mucosa'] as const).filter((t) => entry[t] !== undefined);
  if (byType.length > 0) {
    const list = byType.map((t) => `${USE_TYPE_JA[t]}は${limitJa(entry[t]!)}`).join('、');
    parts.push(`${purpose ? `${purpose}、` : ''}${list}${note}。`);
  }
  for (const c of entry.conditionsJa ?? []) parts.push(`${c}。`);

  const here = useType ? entry[useType] : undefined;
  const notAllowedHere = here === 'banned';
  if (notAllowedHere && useType) {
    const purposeClause = purpose ? purpose.replace(/ときは$/, '場合、') : '';
    parts.push(`${purposeClause}この製品の種類（${USE_TYPE_JA[useType]}）には配合できません。`);
  }
  if (entry.all !== undefined || byType.some((t) => typeof entry[t] === 'number')) {
    parts.push('配合量は成分表示に書かれないため、上限の範囲内かは表示からはわかりません。');
  }
  return { table: entry.table, textJa: `${head}：${parts.join('')}`, notAllowedHere, referenceUrl: COSMETIC_STANDARD_REFERENCE.url };
}

/** 製品の成分表示のうち、この種類の化粧品には配合できない成分の注意（医薬部外品は対象外） */
export function standardLabelNotes(
  product: Pick<Product, 'isQuasiDrug' | 'category' | 'name'>,
  found: { rawName: string; entry: StandardEntry; note: StandardNote }[]
): string[] {
  if (product.isQuasiDrug) return [];
  const notes: string[] = [];
  const bannedNames = found.filter((f) => f.entry.table === '別表第1').map((f) => f.rawName);
  if (bannedNames.length > 0) {
    notes.push(
      `日本の化粧品基準で化粧品への配合が禁止されている成分が表示されています：${bannedNames.join('、')}。海外の製品は、販売されている国の基準で作られています。`
    );
  }
  const useType = productUseType(product);
  const notHere = found.filter((f) => f.entry.table !== '別表第1' && f.note.notAllowedHere).map((f) => f.rawName);
  if (useType && notHere.length > 0) {
    notes.push(
      `日本の化粧品基準では、${USE_TYPE_JA[useType]}に配合できない成分が表示されています：${notHere.join('、')}（防腐剤・紫外線吸収剤は、その目的で配合する場合）。`
    );
  }
  return notes;
}
