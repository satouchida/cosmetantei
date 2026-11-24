import { KNOWN_INGREDIENTS } from '../data/ingredients-db';
import { isSyntheticOrganicCiNumber, tarDyeOf, tarDyeOfCi } from '../data/tar-dyes';
import { BoundedCache } from '../utils/bounded-cache';
import { abbreviateIngredientName, normalizeIngredientName } from '../utils/ingredient-name';
import { ordinaryIngredients, quasiDrugActives } from '../quasi-drug';
import { KnownIngredient, Product } from '../types';

/**
 * 既知DBの名称・別名を正規化したもの。照合のたびに作らない（作り直すと、保存済みの製品の全成分を照合する
 * 代わりの製品探しで CPU 時間が Workers の上限を超える。docs/plans/ingredient-match-cpu.md）
 */
export interface KnownNames {
  /** 正規化した成分名・英語名・別名 → その名前を持つ、辞書の順で最初の成分 */
  byName: Map<string, KnownIngredient>;
  /** 辞書の順の成分と、その別名を正規化したもの（部分一致用）・簡略形（簡略名の照合用） */
  entries: { item: KnownIngredient; aliases: string[]; abbreviated: Set<string> }[];
}

/** 成分の一覧から照合用の名前を作る（同じ名前を持つ成分が複数あれば、一覧で先の成分） */
export function buildKnownNames(items: readonly KnownIngredient[]): KnownNames {
  const byName = new Map<string, KnownIngredient>();
  const entries = items.map((item) => {
    const names = [item.nameJa, item.nameEn, ...item.aliases].map(normalizeIngredientName);
    for (const name of names) if (name && !byName.has(name)) byName.set(name, item);
    return {
      item,
      aliases: item.aliases.map(normalizeIngredientName),
      abbreviated: new Set(names.map(abbreviateIngredientName)),
    };
  });
  return { byName, entries };
}

let knownNames: KnownNames | undefined;
function knownNameIndex(): KnownNames {
  knownNames ??= buildKnownNames(KNOWN_INGREDIENTS);
  return knownNames;
}

/**
 * エタノールそのもの（無水エタノール・変性アルコール・alcohol denat. 等）か。
 * セテアリルアルコール等の高級アルコール、ベンジルアルコール、トリエタノールアミンは別の成分
 */
function isEthanolName(norm: string): boolean {
  // エタノールアミン・エタノールアミド（TEA・界面活性剤）は別成分
  if (/エタノールアミ|ethanolamine|ethanolamide/.test(norm)) return false;
  if (norm.includes('エタノール')) return true;
  // 先頭一致のみ（セチルアルコール・ベンジルアルコール等の「〜アルコール」を拾わない）
  return (
    /^(sd|変性|無水|含水|醸造|発酵|植物性|エチル)?アルコール/.test(norm) ||
    /^(denatured|sd)?(ethyl)?(alcohol|ethanol)/.test(norm)
  );
}

/** text の中の needle のどれかが、直前が before に一致しない位置にあるか */
function hasOccurrenceNotAfter(text: string, needle: string, before: RegExp): boolean {
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) {
    if (!before.test(text.slice(0, i))) return true;
  }
  return false;
}

/**
 * 部分一致させない成分。名前を含む別成分が多い
 * （ジプロピレングリコール≠PG、エチルヘキシルグリセリン・ポリグリセリン≠グリセリン）
 */
const EXACT_MATCH_ONLY = new Set(['propylene_glycol', 'glycerin']);
/** 部分一致させない成分でも、この修飾語（「植物性」「(PG)」等）を除くと別名に一致すれば同じ成分とみなす */
const QUALIFIER_PATTERN = /植物性|植物由来|天然|濃|vegetable|natural|pg|\d+(\.\d+)?%/g;
/**
 * 酸の名前の後ろに付いてよいもの（塩）。アクティブ成分の酸は、これ以外の名前の一部としては照合しない
 * （「サリチル酸ベンジル」「サリチル酸ヘキシル」などのエステル、「チオグリコール酸〜」「3-O-エチルアスコルビン酸」は別の成分）
 */
const ACID_SALT_SUFFIX = /^(na|2na|3na|k|2k|ca|mg|tea|アンモニウム|ナトリウム|カリウム|カルシウム|マグネシウム)?$/;

/** タール色素の項目の ID。個別の報告がある赤色219号・黄色204号は、その項目に */
function dyeIngredientId(dye: { color: string; number: number }): string {
  return dye.color === '赤' && dye.number === 219 ? 'brilliant_lake_red_r' : dye.color === '黄' && dye.number === 204 ? 'quinoline_yellow_ss' : 'tar_dye';
}

/** 別名が、正規化した名前の一部として一致するか（短い略語・酸のエステル・水酸化物などの誤一致を除く） */
function aliasIsPartOf(item: KnownIngredient, normAlias: string, norm: string): boolean {
  // 3文字未満の略語（pg, bg, bha, aha等）は完全一致のみ
  if (normAlias.length < 3) return false;

  if (norm === normAlias) {
    return true;
  }

  // アクティブ成分の酸（サリチル酸・グリコール酸・アスコルビン酸）は、その酸と塩だけ
  if (item.category === 'potent_active' && /(酸|acid)$/.test(normAlias)) {
    return norm.startsWith(normAlias) && ACID_SALT_SUFFIX.test(norm.slice(normAlias.length));
  }

  // 精油・エキス系
  if (item.category === 'essential_oil' && norm.includes(normAlias)) {
    return true;
  }

  // 香料
  if (item.id === 'fragrance' && (norm.includes('香料') || norm.includes('fragrance') || norm.includes('parfum'))) {
    return true;
  }

  // 鉱物油：パラフィンスルホン酸Na などの洗浄成分は油ではない。イソパラフィンは名前で決めず AI が判定する（analyzer/mineral-oil.ts）
  if (item.id === 'mineral_oil' && /イソパラフィン|isoparaffin|スルホン酸|硫酸|sulfon|sulfate/.test(norm)) return false;

  // 有効成分（グリチルリチン酸2K, アラントイン, ナイアシンアミド）
  if (norm.includes(normAlias) && normAlias.length >= 4) {
    // 水酸化亜鉛・過酸化亜鉛・水酸化チタンは紫外線散乱剤の酸化亜鉛・酸化チタンではない
    //（「水酸化Al・酸化チタン」のように、別の所に本物の酸化チタンがあれば一致）
    if ((item.id === 'zinc_oxide' || item.id === 'titanium_dioxide') && !hasOccurrenceNotAfter(norm, normAlias, /[水過]$/)) return false;
    return true;
  }
  return false;
}

/** 正規化した名前が、成分名・英語名・別名のどれかと完全に一致する、辞書の順で最初の成分 */
export function knownIngredientByName(norm: string): KnownIngredient | undefined {
  return norm ? knownNameIndex().byName.get(norm) : undefined;
}

/** 正規化した名前が、この成分（別名は正規化済み）を名前の一部として含むか（部分一致の照合） */
function containsKnownName(item: KnownIngredient, aliases: string[], norm: string): boolean {
  // 「無水エタノール」「変性アルコール」などはエタノールにマッチ（高級アルコール等は除く）
  if (item.id === 'ethanol') return isEthanolName(norm);
  if (EXACT_MATCH_ONLY.has(item.id)) {
    const stripped = norm.replace(QUALIFIER_PATTERN, '');
    return !!stripped && aliases.includes(stripped);
  }
  return aliases.some((alias) => aliasIsPartOf(item, alias, norm));
}

/**
 * 照合の結果（一致しなかったことも null で）を、元の名前ごとに覚える。結果は名前と辞書だけで決まり、
 * 辞書は動いている間は変わらない。同じ成分（水・BG・グリセリン等）は多くの製品に何度も出てくる
 */
const matchCache = new BoundedCache<KnownIngredient | null>(5000);
/** これより長い名前は覚えない（お店の説明文などから来る長い文字列でメモリを使わない。長い名前はまず繰り返されない） */
const MATCH_CACHE_MAX_NAME_LENGTH = 200;

/**
 * 既知の刺激成分辞書と照合する
 * 誤爆防止（フェノキシエタノールがエタノールにマッチする等のバグを防ぐ）
 */
export function findMatchingKnownIngredient(rawName: string): KnownIngredient | undefined {
  if (rawName.length > MATCH_CACHE_MAX_NAME_LENGTH) return matchKnownIngredient(rawName);
  const cached = matchCache.get(rawName);
  if (cached !== undefined) return cached ?? undefined;
  const found = matchKnownIngredient(rawName);
  matchCache.set(rawName, found ?? null);
  return found;
}

function matchKnownIngredient(rawName: string): KnownIngredient | undefined {
  const norm = normalizeIngredientName(rawName);
  if (!norm) return undefined;
  const { entries } = knownNameIndex();

  // 1. 完全一致（成分名・英語名・別名のどれか。辞書の順で最初の成分）
  const exact = knownIngredientByName(norm);
  if (exact) return exact;

  // 1b. 簡略名と成分名の違い（POE/ポリオキシエチレン、Na/ナトリウム、2K/ジカリウム 等）を除けば完全一致
  const abbreviated = abbreviateIngredientName(norm);
  const byAbbreviation = entries.find(({ abbreviated: names }) => names.has(abbreviated));
  if (byAbbreviation) return byAbbreviation.item;

  // 色素は名前の形で（src/lib/data/tar-dyes.ts）。個別の報告がある赤色219号・黄色204号は、その項目に
  // CI 番号は、日本化粧品工業会の対応表にある番号ならそのタール色素として
  const dye = tarDyeOf(norm) ?? tarDyeOfCi(norm);
  if (dye) {
    const id = dyeIngredientId(dye);
    return KNOWN_INGREDIENTS.find((i) => i.id === id);
  }
  if (isSyntheticOrganicCiNumber(norm)) return KNOWN_INGREDIENTS.find((i) => i.id === 'synthetic_dye_ci');

  // 加水分解コムギデンプンはタンパク質ではない（加水分解コムギの事例はタンパク質の成分）
  if (/加水分解(コムギ|小麦)(でんぷん|デンプン)|hydrolyzedwheatstarch/.test(norm)) return undefined;

  // 2. 特殊ケースの除外ルール
  // 「フェノキシエタノール」は「エタノール」ではない
  const isPhenoxy = norm.includes('フェノキシエタノール') || norm.includes('phenoxyethanol');
  if (isPhenoxy) {
    return KNOWN_INGREDIENTS.find((i) => i.id === 'phenoxyethanol');
  }

  // 「セラミド機能成分」「ヘキサデシロキシPG...」はPGではない
  if (norm.includes('セラミド機能成分') || norm.includes('ヘキサデシロキシpg')) {
    return KNOWN_INGREDIENTS.find((i) => i.id === 'ceramides');
  }

  // 3. 部分一致（短すぎる略語は除外）。辞書の順で最初に一致した成分
  return entries.find(({ item, aliases }) => containsKnownName(item, aliases, norm))?.item;
}

/**
 * 成分リストの代わりに入っているプレースホルダー文言（「成分情報は〜より補完」等）か
 */
export function isPlaceholderIngredient(raw: string): boolean {
  return /成分情報は|取得できませんでした/.test(raw);
}

/**
 * 分析する成分。医薬部外品は有効成分も含める。医薬部外品の印が無い製品の有効成分の一覧は、ほかの成分として数える
 * （有効成分の印を付けない。src/lib/quasi-drug.ts）。
 * 有効成分とその他の成分の両方に書かれた成分（業界の自主基準で両方に書く）や重複は1回だけ数える
 */
export function labelIngredients(product: Product): { raw: string; isActive: boolean }[] {
  const seen = new Set<string>();
  const list: { raw: string; isActive: boolean }[] = [];
  const groups: [string[], boolean][] = [
    [quasiDrugActives(product), true],
    [ordinaryIngredients(product), false],
  ];
  for (const [items, isActive] of groups) {
    for (const raw of items) {
      const norm = normalizeIngredientName(raw);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      list.push({ raw, isActive });
    }
  }
  return list;
}
