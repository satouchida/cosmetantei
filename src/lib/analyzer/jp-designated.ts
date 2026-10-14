import {
  DESIGNATED_INGREDIENTS,
  DESIGNATED_LIST_REFERENCE,
  DESIGNATED_NOTICE_REFERENCE,
  DesignatedEntry,
} from '../data/labeling-designated-jp';
import { ReferenceLink } from '../types';
import { abbreviateIngredientName, normalizeIngredientName } from '../utils/ingredient-name';

/**
 * 表示指定成分（labeling-designated-jp.ts）と成分表示の照合。
 * 医薬部外品の表示の規則だが、化粧品の成分も「医薬部外品では表示が義務付けられている成分」として知らせる
 */

const KANJI_DIGITS: Record<string, string> = { 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9' };

/**
 * 照合用の形。告示は位置番号を漢数字と中点で書き（「二・四―」）、表示は「2,4-」と書くので、
 * 漢数字をアラビア数字に、カンマ・プライム・角括弧・ダッシュ（告示の「―」）を除いてそろえる。簡略名（ナトリウム→Na 等）にもそろえる
 */
export function designatedKey(name: string): string {
  const norm = normalizeIngredientName(name)
    .replace(/[,、'’′″\[\]―‐‑–—]/g, '')
    .replace(/[一二三四五六七八九]/g, (d) => KANJI_DIGITS[d]);
  // 「ポリエチレングリコール400」の数は平均分子量。INCI の PEG-n（酸化エチレンの数）と同じ形にしない
  // （PEG-400 は分子量の大きい別の重合体）
  return abbreviateIngredientName(norm.replace(/ポリエチレングリコール(?=\d)/g, 'macrogol'));
}

/** 物質群の名前の形で照合する項目（照合のたびに140項目を見ない） */
const PATTERN_ENTRIES = DESIGNATED_INGREDIENTS.filter((entry) => entry.namePattern);

let index: { names: Map<string, DesignatedEntry>; quasiDrugNames: Map<string, DesignatedEntry> } | undefined;

function buildIndex() {
  const names = new Map<string, DesignatedEntry>();
  const quasiDrugNames = new Map<string, DesignatedEntry>();
  for (const entry of DESIGNATED_INGREDIENTS) {
    for (const n of entry.names) if (!names.has(designatedKey(n))) names.set(designatedKey(n), entry);
    for (const n of entry.quasiDrugNames ?? []) quasiDrugNames.set(designatedKey(n), entry);
  }
  return { names, quasiDrugNames };
}

/** 成分名に当たる表示指定成分。isQuasiDrug は医薬部外品の表示か（医薬部外品だけの別名を使う） */
export function findDesignatedEntry(raw: string, isQuasiDrug = false): DesignatedEntry | undefined {
  const key = designatedKey(raw);
  if (!key) return undefined;
  index ??= buildIndex();
  const byName = index.names.get(key) ?? (isQuasiDrug ? index.quasiDrugNames.get(key) : undefined);
  if (byName) return byName;
  return PATTERN_ENTRIES.find((entry) => entry.namePattern!.test(key));
}

/** 成分カードの1行 */
export function designatedNote(entry: DesignatedEntry): { nameJa: string; textJa: string; references: ReferenceLink[] } {
  return {
    nameJa: entry.nameJa,
    textJa: `表示指定成分（告示第332号の${entry.no}「${entry.nameJa}」）：医薬部外品では、アレルギーなどの皮膚障害を起こすおそれのある製品を、医師からの情報をもとに使う人が避けられるよう、名前の表示が義務付けられている成分です。化粧品にも1980年から2001年3月まで同じ目的の指定（いわゆる旧表示指定成分）があり、全成分表示に替わって廃止されました。載っていることは、誰にでも肌トラブルを起こすという意味ではありません。肌に合わなかったことがある成分なら、避ける目安になります。`,
    // 番号と別名は神奈川県の資料（改正後の告示）、制度の説明は厚生省の通知
    references: [DESIGNATED_LIST_REFERENCE, DESIGNATED_NOTICE_REFERENCE],
  };
}
