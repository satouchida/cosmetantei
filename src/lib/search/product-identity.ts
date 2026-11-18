import { Product } from '../types';
import { findMatchingKnownIngredient } from '../analyzer/ingredient-match';
import { listedBrandKeys } from './product-match';

/**
 * 同じ製品かどうか（表記の違う同じ製品を1つにまとめる・比較リストに登録した製品を代わりの商品に出さない）
 */

/** ブランド表記の会社名部分（「ちふれ化粧品」「〇〇株式会社」等） */
const COMPANY_SUFFIX = /(株式会社|化粧品|コスメティックス?|cosmetics?|inc|co|ltd)$/;

const compact = (t: string) => t.normalize('NFKC').toLowerCase().replace(/[\s・･.,、。()（）\[\]【】'"’-]/g, '');

/** ブランド欄の語（会社名部分を除く。「ちふれ・CHIFURE」→ ちふれ, chifure） */
function brandTokens(brand: string): string[] {
  return brand
    .normalize('NFKC')
    .toLowerCase()
    .split(/[\s・･/()（）,、]+/)
    .map((t) => compact(t).replace(COMPANY_SUFFIX, ''))
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
 * 例: 「ちふれ・CHIFURE / 美白化粧水 Ｗ」と「ちふれ化粧品 / ちふれ美白化粧水 W」は同じキーになる
 */
export function productIdentityKey(brand: string, name: string): string {
  // 容量（150ml・つめかえ用の 130ml 等）は成分が同じなので区別しない
  let key = compact(withoutNonNameWords(name)).replace(/\d+(\.\d+)?(ml|g|l)\b/g, '');
  for (const token of brandTokens(brand)) key = key.split(token).join('');
  return key || compact(name);
}

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

/** ブランドを除いた名前の子音（名前の先頭のブランドは、英字でもカタカナでも除く）。比べられなければ null */
function nameSound(brand: string, name: string): string | null {
  const tokens = brandTokens(brand);
  // ブランドは語ごとに除く（「Beauty of Joseon」の of で、soft の中を除かない。「dr.althea」は compact で比べる）
  const rest = withoutNonNameWords(name)
    .toLowerCase()
    .replace(SIZE, ' ')
    .split(/\s+/)
    .filter((word) => !tokens.includes(compact(word)))
    .join(' ');
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
  const known = (list: string[]) => new Set(list.map((n) => findMatchingKnownIngredient(n)?.id).filter((id) => id !== undefined));
  const knownA = known(a);
  const knownB = known(b);
  const all = new Set([...knownA, ...knownB]);
  if (all.size === 0) return true;
  return [...knownA].filter((id) => knownB.has(id)).length / all.size >= MIN_SHARED_KNOWN;
}

/**
 * カタカナと英字で書き分けた同じ製品か（Open Beauty Facts の「torriden dive in serum」と、公式サイトの
 * 「ダイブイン セラム」）。片方だけにカタカナがあり、ブランドを除いた名前の子音が同じで、全成分も食い違わない。
 * 同じ書き方どうしは比べない
 */
function sameNameAcrossScripts(a: ProductIdentity, b: ProductIdentity): boolean {
  if (hasKana(a.name) === hasKana(b.name)) return false;
  const sound = nameSound(a.brand, a.name);
  return sound !== null && sound === nameSound(b.brand, b.name) && similarIngredients(a.ingredients, b.ingredients);
}

/**
 * 同じ製品か：ID が同じ、JAN コードが同じ、またはブランドが同じで名前のキーが同じ（カタカナと英字の書き分けも同じ）。
 * 名前だけでは決めない（「リップクリーム」のような一般的な名前の、別のブランドの製品を同じにしない）
 */
export function isSameProduct(a: ProductIdentity, b: ProductIdentity): boolean {
  if (a.id === b.id) return true;
  const jan = normalJan(a.barcode);
  if (jan && jan === normalJan(b.barcode)) return true;
  const sameName = productIdentityKey(a.brand, a.name) === productIdentityKey(b.brand, b.name) || sameNameAcrossScripts(a, b);
  return sameName && sameBrand(a.brand, b.brand);
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
  const byKey = new Map<string, string[]>();
  for (const r of registered) {
    const key = productIdentityKey(r.brand, r.name);
    byKey.set(key, [...(byKey.get(key) ?? []), r.brand]);
  }
  // カタカナと英字の書き分け（sameNameAcrossScripts と同じ判定）を、名前の子音で引く
  const bySound = new Map<string, ProductIdentity[]>();
  const scripts = new Set<boolean>();
  for (const r of registered) {
    const sound = nameSound(r.brand, r.name);
    if (!sound) continue;
    bySound.set(sound, [...(bySound.get(sound) ?? []), r]);
    scripts.add(hasKana(r.name));
  }
  return (p) => {
    if (ids.has(p.id)) return true;
    const jan = normalJan(p.barcode);
    if (jan && jans.has(jan)) return true;
    const brands = byKey.get(productIdentityKey(p.brand, p.name));
    if (brands?.some((b) => sameBrand(p.brand, b))) return true;
    // 反対の書き方で登録した製品が無ければ、子音を作らない（成分DBの全製品と比べるため）
    const kana = hasKana(p.name);
    if (!scripts.has(!kana)) return false;
    const sound = nameSound(p.brand, p.name);
    return (
      !!sound &&
      !!bySound
        .get(sound)
        ?.some((r) => hasKana(r.name) !== kana && sameBrand(p.brand, r.brand) && similarIngredients(p.ingredients, r.ingredients))
    );
  };
}
