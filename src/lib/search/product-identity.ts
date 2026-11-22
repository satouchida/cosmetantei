import { Product } from '../types';
import { findMatchingKnownIngredient } from '../analyzer/ingredient-match';
import { listedBrandKeys, listedBrandSpellings } from './product-match';
import { labelBrandName } from '../services/brand-suggest';

/**
 * 同じ製品かどうか（表記の違う同じ製品を1つにまとめる・比較リストに登録した製品を代わりの商品に出さない）
 */

/** ブランド表記の会社名部分（「ちふれ化粧品」「〇〇株式会社」等） */
const COMPANY_SUFFIX = /(株式会社|化粧品|コスメティックス?|cosmetics?|inc|co|ltd)$/;
/**
 * 前に付く会社の種類（「株式会社ちふれ化粧品」）。「(株)〇〇」「㈱〇〇」は括弧で語が分かれ、1文字の「株」は語として数えない
 * （1文字の「株」「有」を前から外すと、「有田」のようなブランドが変わる）
 */
const COMPANY_PREFIX = /^(株式会社|有限会社|合同会社)(?=.)/;

/** 比べるときに除く記号（「極潤ヒアルロン液 / 170ml」の「/」も。容量を除いたあとに残って、同じ製品が別になる） */
const compact = (t: string) => t.normalize('NFKC').toLowerCase().replace(/[\s・･.,、。()（）\[\]【】'"’/-]/g, '');

/** ブランド欄の語（会社名部分を除く。「ちふれ・CHIFURE」→ ちふれ, chifure） */
function brandTokens(brand: string): string[] {
  return brand
    .normalize('NFKC')
    .toLowerCase()
    .split(/[\s・･/()（）,、]+/)
    .map((t) => compact(t).replace(COMPANY_PREFIX, '').replace(COMPANY_SUFFIX, ''))
    .filter((t) => t.length >= 2);
}

/**
 * 版の違いを示すだけの語（「NEW ダイブイン セラム」の NEW、「リニューアル」）。単独の語のときだけ。
 * 成分が少し変わっても、利用者には同じ製品なので1つにまとめる
 */
const EDITION_WORD = /(?<=^|[\s・()（）[\]【】])(new|renewal|リニューアル)(?=$|[\s・()（）[\]【】])/gi;
/**
 * 届け出た名前の前に付く見出し（「ハトムギ化粧水（販売名：ナチュリエ スキンコンディショナー R）」）。
 * 公式サイトは付け、お店は付けないことが多い。製品の名前の一部ではない（NFKC で「：」は「:」になる）
 */
const SALES_NAME_LABEL = /販売名\s*:?/g;
const withoutNonNameWords = (name: string) => name.normalize('NFKC').replace(EDITION_WORD, ' ').replace(SALES_NAME_LABEL, ' ');

/**
 * ページごとに表記が違う同じ製品を同一視するためのキー
 * 例: 「ちふれ・CHIFURE / 美白化粧水 Ｗ」と「ちふれ化粧品 / ちふれ美白化粧水 W」は同じキーになる。
 * 「Curel / キュレル 潤浸保湿 モイストリペアシートマスク」と「キュレル / 潤浸保湿 モイストリペアシートマスク」も同じ
 */
export function productIdentityKey(brandField: string, name: string): string {
  // brand 欄が会社名なら、商品名の中のブランドで比べる（「花王」の「キュレル ハンドクリーム」と「キュレル」の「ハンドクリーム」）
  const brand = identityBrand(brandField, name);
  // 容量（150ml・つめかえ用の 130ml 等）は成分が同じなので区別しない
  let key = compact(withoutNonNameWords(name)).replace(/\d+(\.\d+)?(ml|g|l)\b/g, '');
  // 名前の先頭の、ブランド欄とは別の書き方のブランド（ブランド欄が「Curel」で名前が「キュレル 潤浸保湿…」）。
  // 一覧のブランドの書き方だけ、先頭だけ（短い書き方で語の途中を消さない）
  const leading = listedBrandSpellings(brand)
    .map(compact)
    .filter((s) => s.length >= 2)
    .sort((a, b) => b.length - a.length)
    .find((s) => key.startsWith(s));
  if (leading) key = key.slice(leading.length);
  for (const token of brandTokens(brand)) key = key.split(token).join('');
  return key || compact(name);
}

/** 比べるブランド：brand 欄が会社名で、商品名に一覧のブランドがあればそのブランド（labelBrandName）、なければ brand 欄 */
const identityBrand = (brand: string, name: string): string => labelBrandName(brand, name) ?? brand;

/** JAN コードの比較用の形（数字だけ・先頭の 0 を除く） */
export const normalJan = (code: string | undefined): string => (code ? code.replace(/\D/g, '').replace(/^0+/, '') : '');

/** ブランドが同じか（語が1つ共通、または一覧の同じブランドの別の書き方。「Maybelline」と「メイベリン ニューヨーク」） */
function sameBrand(a: string, b: string): boolean {
  const tokens = new Set(brandTokens(a));
  if (brandTokens(b).some((t) => tokens.has(t))) return true;
  const listed = new Set(listedBrandKeys(a));
  return listedBrandKeys(b).some((k) => listed.has(k));
}

/** 同じ製品かを比べるのに使う項目 */
export type ProductIdentity = Pick<Product, 'id' | 'brand' | 'name'> & Partial<Pick<Product, 'barcode' | 'ingredients'>>;

/** カタカナ1文字の子音（母音・ヤ行・ワ行・長音・促音・小さい字は ''）。英字の側も同じ規則で子音だけにする */
const KANA_SOUND = new Map<string, string>(
  (
    [
      ['', 'アイウエオァィゥェォヤユヨャュョワヮヲーッ'],
      ['k', 'カキクケコ'],
      ['g', 'ガギグゲゴ'],
      ['s', 'サシスセソザジズゼゾヂヅ'],
      ['t', 'タチテト'],
      ['ts', 'ツ'],
      ['d', 'ダデド'],
      ['n', 'ナニヌネノン'],
      ['h', 'ハヒヘホ'],
      ['f', 'フ'],
      ['b', 'バビブベボヴ'],
      ['p', 'パピプペポ'],
      ['m', 'マミムメモ'],
      ['r', 'ラリルレロ'],
    ] as const
  ).flatMap(([sound, kana]) => [...kana].map((k) => [k, sound] as [string, string]))
);
/** 英字の、カタカナで書くときの子音に近い形（v→ブ、l→ル、j・z→ジ・ズ、w は書かない） */
const LATIN_SOUND: Record<string, string> = { v: 'b', l: 'r', q: 'k', x: 'ks', j: 's', z: 's', w: '' };
/** ch・sh・th・ph（チ・シ・ス・フ） */
const LATIN_PAIR_SOUND: Record<string, string> = { c: 't', s: 's', t: 's', p: 'f' };
const LATIN_VOWEL = /[aeiouy]/;
const SOUND_SEPARATOR = /[\s・･.,、。()（）[\]【】'"’&+/-]/;
/** カタカナ・ひらがな（中黒「・」は英字の名前にも使うので含めない。半角カナは NFKC で全角にしてから見る） */
const KANA = /[ぁ-ゖァ-ヺー]/;
const hasKana = (name: string) => KANA.test(name.normalize('NFKC'));
/** 容量（150ml・50g 等）。成分が同じなので比べない（productIdentityKey と同じ） */
const SIZE = /\d+(\.\d+)?\s*(ml|g|l)\b/g;
/** これより短い音は比べない。母音を比べないので、短い名前は別の製品とぶつかりやすい（「セラム」だけ等） */
const MIN_NAME_SOUND = 5;

/**
 * 名前の子音だけの形。「ダイブイン セラム」と「dive in serum」はどちらも dbnsrm。
 * 英字は、次が母音でない r を読まない（「トナー」= toner）。漢字など比べられない文字があれば null
 */
function soundSkeleton(text: string): string | null {
  // ひらがなはカタカナにする
  const t = text.normalize('NFKC').toLowerCase().replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  let out = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    const next = t[i + 1] ?? '';
    let sound: string;
    if (KANA_SOUND.has(c)) sound = KANA_SOUND.get(c)!;
    else if (/[0-9]/.test(c)) sound = c;
    else if (SOUND_SEPARATOR.test(c)) sound = '';
    else if (!/[a-z]/.test(c)) return null;
    else if (LATIN_VOWEL.test(c)) sound = '';
    else if (next === 'h' && c in LATIN_PAIR_SOUND) {
      sound = LATIN_PAIR_SOUND[c];
      i++;
    } else if (c === 'c') sound = /[eiy]/.test(next) ? 's' : 'k';
    else if (c === 'r') sound = LATIN_VOWEL.test(next) ? 'r' : '';
    // 語の途中の ti + 母音（-tion）はシ（lotion = ローション）
    else if (c === 't' && next === 'i' && /[aeou]/.test(t[i + 2] ?? '') && /[a-z]/.test(t[i - 1] ?? '')) sound = 's';
    // p・b の前の m はン（shampoo = シャンプー）
    else if (c === 'm' && /[pb]/.test(next)) sound = 'n';
    else sound = LATIN_SOUND[c] ?? c;
    // 続く同じ子音は1つ（torriden = トリデン）
    for (const s of sound) if (!out.endsWith(s)) out += s;
  }
  return out;
}

/**
 * 英字の語でないローマ数字（「ローション I」「Lotion II」「ⅲ」は NFKC で iii）。母音だけなので、数字にしないと子音で消えて
 * 「I」と「II」が同じになる
 */
const ROMAN_NUMERAL = /(?<![a-z])(iii|ii|iv|i)(?![a-z])/g;
const ROMAN_VALUE: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4 };

/** ブランドを除いた名前の子音（名前の先頭のブランドは、英字でもカタカナでも除く）。比べられなければ null */
function nameSound(brand: string, name: string): string | null {
  const tokens = brandTokens(brand);
  // ブランドは語ごとに除く（「Beauty of Joseon」の of で、soft の中を除かない。「dr.althea」は compact で比べる）
  const rest = withoutNonNameWords(name)
    .toLowerCase()
    .replace(SIZE, ' ')
    .split(/\s+/)
    .filter((word) => !tokens.includes(compact(word)))
    .join(' ')
    .replace(ROMAN_NUMERAL, (numeral) => ` ${ROMAN_VALUE[numeral]} `);
  let sound = soundSkeleton(rest);
  if (!sound) return null;
  for (const token of tokens) {
    const brandSound = soundSkeleton(token);
    if (brandSound && brandSound.length >= 3 && sound.startsWith(brandSound)) {
      sound = sound.slice(brandSound.length);
      break;
    }
  }
  return sound.length >= MIN_NAME_SOUND ? sound : null;
}

/** 成分DBで分かる成分のうち、両方にある割合がこれ以上なら同じ全成分とみなす（英語と日本語の全成分を比べるため） */
const MIN_SHARED_KNOWN = 0.8;

/**
 * 両方に全成分があれば、数がほぼ同じで、成分DBで分かる成分もほぼ同じか（母音だけ違う別の製品、moist と「ミスト」
 * 「hydra」と「ハイドロ」を同じにしない）。片方でも全成分が無ければ、名前だけで決める
 */
function similarIngredients(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a?.length || !b?.length) return true;
  const larger = Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > Math.max(2, Math.round(larger * 0.15))) return false;
  const shared = sharedKnown(a, b);
  return shared.all === 0 || shared.ratio >= MIN_SHARED_KNOWN;
}

/** 成分DBで分かる成分の id（「BG」と「ブチレングリコール」は同じ id） */
const knownIds = (list: string[]) => new Set(list.map((n) => findMatchingKnownIngredient(n)?.id).filter((id) => id !== undefined));

/** 成分DBで分かる成分の、両方を合わせた数と、そのうち両方にある割合 */
function sharedKnown(a: string[], b: string[]): { all: number; ratio: number } {
  const knownA = knownIds(a);
  const knownB = knownIds(b);
  const all = new Set([...knownA, ...knownB]).size;
  return { all, ratio: all === 0 ? 0 : [...knownA].filter((id) => knownB.has(id)).length / all };
}

/** 表記の揺れを許すときの全成分の条件：両方にあり、数の差が1以下、分かる成分が5つ以上で、その9割以上が両方にある */
const MIN_KNOWN_FOR_NEAR_NAME = 5;
const MIN_SHARED_FOR_NEAR_NAME = 0.9;

function sameIngredientList(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a?.length || !b?.length || Math.abs(a.length - b.length) > 1) return false;
  const shared = sharedKnown(a, b);
  return shared.all >= MIN_KNOWN_FOR_NEAR_NAME && shared.ratio >= MIN_SHARED_FOR_NEAR_NAME;
}

/** ゛゜（濁点・半濁点）。外すと「アドバンスド」と「アドバンスト」、「パワー」と「ハワー」が同じになる */
const VOICING_MARKS = new RegExp(`[${String.fromCharCode(0x3099, 0x309a)}]`, 'g');
const withoutVoicing = (key: string) => key.normalize('NFD').replace(VOICING_MARKS, '').normalize('NFC');

/**
 * 子音の、清音と濁音（t・d、k・g、h・b・p・f）と s・t の違いを除いた形。英語の読みとカタカナの読みがずれる
 * （「mucin」と「ムチン」、「advanced」と「アドバンスト」）。数字は残す（「96」と「92」は別の製品）
 */
const SOUND_FOLD: Record<string, string> = { d: 't', s: 't', g: 'k', b: 'h', p: 'h', f: 'h' };
const foldSound = (sound: string) => [...sound].map((c) => SOUND_FOLD[c] ?? c).join('').replace(/([a-z])\1+/g, '$1');

/**
 * 英字のブランド名と、その後に書いたカタカナの読みか（「THE FUTURE」と「ザフューチャー」、「TIRTIR」と「ティルティル」）。
 * 語全体の子音が同じ（清濁・s と t は区別しない。r は英語では読まないことが多く、カタカナではルになるので比べない）
 */
export function readsAlike(latin: string, kana: string): boolean {
  const sound = (text: string) => {
    const skeleton = soundSkeleton(text);
    return skeleton === null ? null : foldSound(skeleton.replace(/r/g, ''));
  };
  const latinSound = sound(latin);
  return !!latinSound && latinSound === sound(kana);
}

/** 濁点を除いて比べる名前のキーの長さの下限（「バーム」と「パーム」、「ハウダー」と「パウダー」を同じにしない） */
const isLongEnoughForNearName = (key: string) => key.length >= MIN_NAME_SOUND;

/**
 * 表記の揺れだけが違う名前か。同じ書き方どうしは、名前のキーが濁点・半濁点を除いて同じ（文字が増える「I」と「II」は別）。
 * カタカナと英字は、名前の子音が清濁・s と t を除いて同じ。全成分がほぼ同じとき（sameIngredientList）だけに使う
 */
function nearSameName(a: ProductIdentity, b: ProductIdentity): boolean {
  if (hasKana(a.name) === hasKana(b.name)) {
    const keyA = withoutVoicing(productIdentityKey(a.brand, a.name));
    return isLongEnoughForNearName(keyA) && keyA === withoutVoicing(productIdentityKey(b.brand, b.name));
  }
  const soundA = nameSound(identityBrand(a.brand, a.name), a.name);
  const soundB = nameSound(identityBrand(b.brand, b.name), b.name);
  return !!soundA && !!soundB && foldSound(soundA) === foldSound(soundB);
}

/**
 * カタカナと英字で書き分けた同じ製品か（Open Beauty Facts の「torriden dive in serum」と、公式サイトの
 * 「ダイブイン セラム」）。片方だけにカタカナがあり、ブランドを除いた名前の子音が同じで、全成分も食い違わない。
 * 同じ書き方どうしは比べない
 */
function sameNameAcrossScripts(a: ProductIdentity, b: ProductIdentity): boolean {
  if (hasKana(a.name) === hasKana(b.name)) return false;
  const sound = nameSound(identityBrand(a.brand, a.name), a.name);
  return (
    sound !== null &&
    sound === nameSound(identityBrand(b.brand, b.name), b.name) &&
    similarIngredients(a.ingredients, b.ingredients)
  );
}

/**
 * 同じ製品か：ID が同じ、JAN コードが同じ、またはブランドが同じで名前のキーが同じ（カタカナと英字の書き分けも同じ）。
 * 全成分がほぼ同じなら、表記の揺れ（「アドバンスト」と「アドバンスド」、「mucin」と「ムチン」）も同じ名前とみなす。
 * 名前だけでは決めない（「リップクリーム」のような一般的な名前の、別のブランドの製品を同じにしない）
 */
export function isSameProduct(a: ProductIdentity, b: ProductIdentity): boolean {
  if (a.id === b.id) return true;
  const jan = normalJan(a.barcode);
  if (jan && jan === normalJan(b.barcode)) return true;
  // 安い比べ方から（ブランド → 名前のキー → 書き分け → 全成分 → 表記の揺れ）
  if (!sameBrand(identityBrand(a.brand, a.name), identityBrand(b.brand, b.name))) return false;
  return (
    productIdentityKey(a.brand, a.name) === productIdentityKey(b.brand, b.name) ||
    sameNameAcrossScripts(a, b) ||
    (sameIngredientList(a.ingredients, b.ingredients) && nearSameName(a, b))
  );
}

/**
 * 同じ製品（isSameProduct：同じ JAN コード、ブランドと名前の表記ゆれ）は1つにする。並びは最初に出た位置のまま、
 * 全成分を確かめた製品があればそちらを残す（onePerBarcode と同じ。「極潤ヒアルロン液 / 170ml」と「極潤ヒアルロン液」）。
 * max: 残す数の上限（入力のたびに呼ぶ検索の候補で、ブランドの全製品どうしを比べないため。上限より後の製品は、
 * 残した製品と同じなら置き換えにだけ使う）
 */
export function onePerProduct<T extends ProductIdentity>(
  products: readonly T[],
  isVerified: (p: T) => boolean = () => false,
  max = Infinity
): T[] {
  const out: T[] = [];
  for (const p of products) {
    const i = out.findIndex((kept) => isSameProduct(kept, p));
    if (i < 0) {
      if (out.length < max) out.push(p);
    } else if (!isVerified(out[i]) && isVerified(p)) {
      out[i] = p;
      // 置き換えた製品は JAN コード・全成分が違うので、後ろに残した製品と同じになることがある。それは除く
      for (let j = out.length - 1; j > i; j--) if (isSameProduct(p, out[j])) out.splice(j, 1);
    }
  }
  return out;
}

/** 登録した製品（肌荒れした・使えるコスメ）のどれかと同じ製品か */
export function isRegisteredProduct(product: ProductIdentity, registered: readonly ProductIdentity[]): boolean {
  return registered.some((r) => isSameProduct(product, r));
}

/**
 * isRegisteredProduct と同じ判定を、登録した製品のキーを1回だけ作って何度も行う（成分DBの全製品と比べるとき）
 */
export function registeredMatcher(registered: readonly ProductIdentity[]): (product: ProductIdentity) => boolean {
  if (registered.length === 0) return () => false;
  const ids = new Set(registered.map((r) => r.id));
  const jans = new Set(registered.map((r) => normalJan(r.barcode)).filter(Boolean));
  type Entry = { brand: string; kana: boolean; ingredients?: string[] };
  const add = (map: Map<string, Entry[]>, key: string, entry: Entry) => map.set(key, [...(map.get(key) ?? []), entry]);
  // 名前のキーと、その濁点・半濁点を除いた形（表記の揺れは、全成分がほぼ同じときだけ使う）
  const byKey = new Map<string, Entry[]>();
  const byKeyWithoutVoicing = new Map<string, Entry[]>();
  // カタカナと英字の書き分け（sameNameAcrossScripts・nearSameName と同じ判定）を、名前の子音で引く
  const bySound = new Map<string, Entry[]>();
  const byFoldedSound = new Map<string, Entry[]>();
  const scripts = new Set<boolean>();
  for (const r of registered) {
    const brand = identityBrand(r.brand, r.name);
    const entry: Entry = { brand, kana: hasKana(r.name), ingredients: r.ingredients };
    const key = productIdentityKey(r.brand, r.name);
    add(byKey, key, entry);
    if (isLongEnoughForNearName(withoutVoicing(key))) add(byKeyWithoutVoicing, withoutVoicing(key), entry);
    const sound = nameSound(brand, r.name);
    if (!sound) continue;
    add(bySound, sound, entry);
    add(byFoldedSound, foldSound(sound), entry);
    scripts.add(entry.kana);
  }
  return (p) => {
    if (ids.has(p.id)) return true;
    const jan = normalJan(p.barcode);
    if (jan && jans.has(jan)) return true;
    const brand = identityBrand(p.brand, p.name);
    const key = productIdentityKey(p.brand, p.name);
    if (byKey.get(key)?.some((r) => sameBrand(brand, r.brand))) return true;
    const kana = hasKana(p.name);
    const nearSameList = (r: Entry) => sameBrand(brand, r.brand) && sameIngredientList(p.ingredients, r.ingredients);
    const hasList = !!p.ingredients?.length;
    if (hasList && byKeyWithoutVoicing.get(withoutVoicing(key))?.some((r) => r.kana === kana && nearSameList(r))) return true;
    // 反対の書き方で登録した製品が無ければ、子音を作らない（成分DBの全製品と比べるため）
    if (!scripts.has(!kana)) return false;
    const sound = nameSound(brand, p.name);
    if (!sound) return false;
    const otherScript = (r: Entry) => r.kana !== kana;
    if (bySound.get(sound)?.some((r) => otherScript(r) && sameBrand(brand, r.brand) && similarIngredients(p.ingredients, r.ingredients))) {
      return true;
    }
    return hasList && !!byFoldedSound.get(foldSound(sound))?.some((r) => otherScript(r) && nearSameList(r));
  };
}
