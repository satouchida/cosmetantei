import { BRANDS_JP, BrandEntry } from '../data/brands-jp';
import { rankProducts, searchKey } from '../search/product-match';
import { Product } from '../types';

/**
 * 入力途中の候補：ブランドを先に見つけ、そのブランドの製品に絞り込む
 * docs/walkthroughs/2026-10-15-brand-typeahead.md
 * - ブランドは src/lib/data/brands-jp.ts（読み・英字表記つき）と、調べた製品のブランド名
 * - 製品は調べて保存した製品だけ。お店の API のキーが届いたら、ブランドの製品一覧をここで足す
 * - リクエストごとに buildBrandIndex を1回作り、suggestBrands・resolveBrand・brandProducts に渡す
 */

export interface BrandSuggestion {
  name: string;
  kana?: string;
}

export interface IndexedBrand {
  entry: BrandEntry;
  /** 名前・読み・別の書き方の照合キー（長い順） */
  keys: string[];
}

const isAscii = (key: string) => /^[a-z0-9]+$/.test(key);
const startsWithKanji = (text: string) => /^[一-鿿々]/.test(text);

function indexBrand(entry: BrandEntry): IndexedBrand {
  const keys = [...new Set([entry.name, entry.kana ?? '', ...(entry.aliases ?? [])].map(searchKey).filter(Boolean))].sort(
    (a, b) => b.length - a.length
  );
  return { entry, keys };
}

export const SEED_INDEX: IndexedBrand[] = BRANDS_JP.map(indexBrand);

// ---------- 製品の brand 欄 ----------

interface BrandField {
  /** brand 欄全体のキー */
  key: string;
  /** 空白・カンマ等で区切った語のキー */
  words: string[];
  /** 2文字のカタカナのキーを探す語のキー（ひらがな・かっこ・ハイフンでも区切る。KANA_WORD_BREAK） */
  kanaWords: string[];
  /** 3文字以上のカタカナのキーを探す、語をつなげたキーと語の頭の位置（kanaRun） */
  kanaRun: KanaRun;
}

interface KanaRun {
  joined: string;
  starts: Set<number>;
}

/**
 * ひらがなは1文字ずつ別の語にする。searchKey はひらがなをカタカナにするので、ひらがなの後ろ（「おすすめのキュレル」）を
 * 語の頭として残し、ひらがなで書いたブランド（「ちふれ」、キーは「チフレ」）も消さない
 */
const HIRAGANA_OR_OTHER = /[ぁ-ゖ]|[^ぁ-ゖ]+/g;

function kanaRun(text: string): KanaRun {
  const words = text
    .split(WORD_BREAK)
    .flatMap((w) => w.match(HIRAGANA_OR_OTHER) ?? [])
    .map(searchKey)
    .filter(Boolean);
  const starts = new Set<number>();
  let at = 0;
  for (const w of words) {
    starts.add(at);
    at += w.length;
  }
  return { joined: words.join(''), starts };
}

/**
 * 2文字のカタカナのキーを探す語の区切り。searchKey はひらがなをカタカナにし、かっこ・ハイフンを消すので、先に切っておく
 * （「ダヴの石鹸」「ダヴ（ユニリーバ）」「ペア-アクネ」で、ブランドの後ろにカタカナが続いたことにしない）
 */
const KANA_WORD_BREAK = /[\s,，、/／・()[\]【】「」『』<>〈〉《》\-‐−–—_.。:|!?\u3041-\u3096]+/;
/** KANA_WORD_BREAK からひらがなを除いたもの（kanaRun。ひらがなは1文字ずつ語にする） */
const WORD_BREAK = /[\s,，、/／・()[\]【】「」『』<>〈〉《》\-‐−–—_.。:|!?]+/;

/** brand 欄・お店の商品名を照らす形にする */
function toField(text: string): BrandField {
  const nfkc = text.normalize('NFKC');
  return {
    key: searchKey(text),
    // 【】も語の区切り（「【to/one】ベース …」の to/one を、後ろの「ベース」と1語にしない）
    words: text.split(/[\s\u3000,，、/／・【】]+/).map(searchKey).filter(Boolean),
    kanaWords: nfkc.split(KANA_WORD_BREAK).map(searchKey).filter(Boolean),
    kanaRun: kanaRun(nfkc),
  };
}

/** 製品ごとに1回だけ作る（製品が差し替わればオブジェクトが変わるので作り直す） */
const brandFieldCache = new WeakMap<Product, BrandField>();

function brandField(p: Product): BrandField {
  let field = brandFieldCache.get(p);
  if (!field) {
    field = toField(p.brand ?? '');
    brandFieldCache.set(p, field);
  }
  return field;
}

/** カタカナ（長音の「ー」を含む）。ひらがなは kanaWords を作るときに区切りにしている */
const KATAKANA = /[ァ-ヺー]/;
const isKatakanaKey = (k: string) => /^[ァ-ヺー]+$/.test(k);
const isShortKatakana = (k: string) => k.length === 2 && isKatakanaKey(k);

/**
 * 3文字以上のカタカナのキーが、語の頭か、前がカタカナでない位置にあるか（「エスト」が「ホワイトクエスト」に当たらない）。
 * 後ろにカタカナが続くのはよい（「キュレルモイストリペア」）。語をまたいでもよい（「ラ ロッシュ ポゼ」）
 */
function runHasKatakanaKey({ joined, starts }: KanaRun, k: string): boolean {
  for (let i = joined.indexOf(k); i >= 0; i = joined.indexOf(k, i + 1)) {
    if (starts.has(i) || !KATAKANA.test(joined[i - 1] ?? '')) return true;
  }
  return false;
}

/**
 * 語の中に、前後がカタカナでない形でこのキーがあるか（2文字のカタカナのブランドが、ほかのカタカナの語の一部に当たらないように：
 * 「ダヴ」（キーは「ダブ」）が「ダブル洗顔」、「ペア」が「リペア」、「シロ」が「シロップ」に当たらない）
 */
function wordHasKatakanaKey(word: string, k: string): boolean {
  for (let i = word.indexOf(k); i >= 0; i = word.indexOf(k, i + 1)) {
    if (!KATAKANA.test(word[i - 1] ?? '') && !KATAKANA.test(word[i + k.length] ?? '')) return true;
  }
  return false;
}

/**
 * brand 欄にこのキーがあるか。
 * 英字のキーは語の単位で（続く語をつなげてもよい）：「est」が「Estée Lauder」、「pair」が「Repair」に当たらないように。
 * 日本語は空白なしで書くので、2文字以上なら含まれていればよい。ただしカタカナだけのキーは、ほかのカタカナの語の途中では当てない：
 * 2文字は語の中で前後がカタカナでないとき、3文字以上は前がカタカナでないとき（runHasKatakanaKey）
 */
function fieldHasKey(field: BrandField, k: string): boolean {
  if (field.key === k) return true;
  if (isShortKatakana(k)) return field.kanaWords.some((w) => wordHasKatakanaKey(w, k));
  if (isKatakanaKey(k)) return k.length >= 2 && runHasKatakanaKey(field.kanaRun, k);
  if (!isAscii(k)) return k.length >= 2 && field.key.includes(k);
  if (k.length < 3) return false;
  for (let i = 0; i < field.words.length; i++) {
    let joined = '';
    for (let j = i; j < field.words.length && joined.length < k.length; j++) {
      joined += field.words[j];
      if (joined === k) return true;
    }
  }
  return false;
}

/** 文字列ごとに1回だけ作る（brands.find(textHasBrand) のように、同じ商品名をブランドの数だけ照らすので） */
const textFieldCache = new Map<string, BrandField>();

function textField(text: string): BrandField {
  let field = textFieldCache.get(text);
  if (!field) {
    field = toField(text);
    if (textFieldCache.size > 2000) textFieldCache.clear();
    textFieldCache.set(text, field);
  }
  return field;
}

/** 文字列（お店の商品のブランド名・商品名）がこのブランドのものか。照らし方は brand 欄と同じ */
export function textHasBrand(text: string, brand: IndexedBrand): boolean {
  const field = textField(text);
  return !!field.key && brand.keys.some((k) => fieldHasKey(field, k));
}

function productIsOfBrand(product: Product, brand: IndexedBrand): boolean {
  const field = brandField(product);
  return !!field.key && brand.keys.some((k) => fieldHasKey(field, k));
}

/** brand 欄が一覧のどれかのブランドか（brand 欄の文字列ごとに覚える。一覧は変わらないので古くならない） */
const seedCoverage = new Map<string, boolean>();

function coveredBySeed(p: Product): boolean {
  const key = brandField(p).key;
  let hit = seedCoverage.get(key);
  if (hit === undefined) {
    hit = SEED_INDEX.some((b) => productIsOfBrand(p, b));
    if (seedCoverage.size > 5000) seedCoverage.clear();
    seedCoverage.set(key, hit);
  }
  return hit;
}

/**
 * 一覧のブランドと、調べた製品のブランドのうち一覧に無いもの。
 * brand 欄が「A, B」のような並びなら最初のものを名前にする
 */
export function buildBrandIndex(products: Product[]): IndexedBrand[] {
  const seen = new Set<string>();
  const found: IndexedBrand[] = [];
  for (const p of products) {
    const name = (p.brand ?? '').split(/[,，、]/)[0].trim();
    const key = searchKey(name);
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    if (coveredBySeed(p)) continue;
    found.push({ entry: { name }, keys: [key] });
  }
  return [...SEED_INDEX, ...found];
}

// ---------- 検索語 ----------

/**
 * 検索語の先頭にあるブランドと、残りの語。
 * - 「エスティ ローダー 化粧水」：空白で区切ったブランド名（候補をタップしたときもこの形）
 * - 「しせいどう 化粧水」「キュレル化粧水」：最初の語の先頭。日本語は空白なしで続けて書くので切ってよい。ただし
 *   4文字未満のキーは、続きが漢字のときだけ切る（「スリーピングマスク」を THREE と「ピングマスク」にしない）
 * - 英字のブランドは英字の途中で切らない（「estee」を「est」と「ee」にしない）
 */
export function resolveBrand(query: string, brands: IndexedBrand[]): { brand: IndexedBrand; rest: string } | null {
  const words = query
    .trim()
    .split(/[\s　]+/)
    .map(searchKey)
    .filter(Boolean);
  if (words.length === 0) return null;

  // 1. 先頭の何語かをつなげると、ブランドのキーそのもの（長いものから）
  for (let i = words.length; i >= 2; i--) {
    const lead = words.slice(0, i).join('');
    const brand = brands.find((b) => b.keys.includes(lead));
    if (brand) return { brand, rest: words.slice(i).join(' ') };
  }

  // 2. 最初の語がブランドのキーで始まる
  const first = words[0];
  let best: { brand: IndexedBrand; key: string } | null = null;
  for (const brand of brands) {
    for (const key of brand.keys) {
      // 1文字のキーは、ほかの語の書き始めと区別できないので使わない
      if (key.length < 2 || !first.startsWith(key)) continue;
      if (first.length > key.length) {
        const after = first.slice(key.length);
        if (isAscii(key) ? key.length < 3 || /^[a-z0-9]/.test(after) : key.length < 4 && !startsWithKanji(after)) continue;
      }
      if (!best || key.length > best.key.length) best = { brand, key };
    }
  }
  if (!best) return null;
  const rest = [first.slice(best.key.length), ...words.slice(1)].filter(Boolean).join(' ');
  return { brand: best.brand, rest };
}

/** 検索語で始まるブランド（名前・読み・別の書き方のどれか）。名前がそのものなら先に、次に一覧のブランド */
export function suggestBrands(query: string, brands: IndexedBrand[], limit = 5): BrandSuggestion[] {
  const q = searchKey(query);
  if (!q) return [];
  const exact = brands.filter((b) => b.keys.some((k) => k === q));
  const prefix = brands.filter((b) => !exact.includes(b) && b.keys.some((k) => k.startsWith(q)));
  return [...exact, ...prefix].slice(0, limit).map(toSuggestion);
}

function toSuggestion(b: IndexedBrand): BrandSuggestion {
  return { name: b.entry.name, ...(b.entry.kana && { kana: b.entry.kana }) };
}

/**
 * 検索語がブランドで始まるとき、そのブランドの保存済みの製品を、残りの語で絞り込んで返す。ブランドで始まらなければ null
 */
export function brandProducts(
  query: string,
  products: Product[],
  brands: IndexedBrand[],
  isVerified: (p: Product) => boolean = () => false
): { brand: BrandSuggestion; products: Product[] } | null {
  const resolved = resolveBrand(query, brands);
  if (!resolved) return null;
  const ofBrand = products.filter((p) => productIsOfBrand(p, resolved.brand));
  // 残りの語が無ければブランドの製品すべて（確認済みを先に）。あれば、製品名・カテゴリで絞り込む
  const ranked = resolved.rest
    ? rankProducts(ofBrand, resolved.rest, isVerified)
    : [...ofBrand].sort((a, b) => Number(isVerified(b)) - Number(isVerified(a)));
  return { brand: toSuggestion(resolved.brand), products: ranked };
}

/** 名前（候補のチップに出した名前）からブランドを探す */
export function findBrand(name: string, brands: IndexedBrand[]): IndexedBrand | null {
  const key = searchKey(name);
  return (key && brands.find((b) => searchKey(b.entry.name) === key)) || null;
}

// ---------- 表示 ----------

/** 一覧のブランドの、名前・読み・別の書き方のキー → ブランド */
let seedByKey: Map<string, BrandEntry> | null = null;

/**
 * brand 欄の書き方の揺れ（「Curel」「キュレル / curel」「花王 / キュレル」）を、一覧のブランド名にそろえる（表示だけ）。
 * 「/」「,」「、」で区切ったどの部分も、一覧のブランドの名前・読み・別の書き方と同じときだけ。
 * 語の一部では照らさない（「Kate Somerville」をケイトにしない）。会社名とブランド名が並んでいればブランド名。
 * 「CosRx (コスアールエックス)」のような、名前と括弧の中の読みは、どちらかが一覧のブランドならそのブランド。
 * 「ちふれ・CHIFURE」のように同じブランドの書き方を「・」で並べたものも、そのブランド。
 * 一覧に無い部分がある・会社でないブランドが2つ以上ある → null（brand 欄のまま表示する）
 */
export function listedBrandName(brandField: string): string | null {
  const found = new Set<BrandEntry>();
  for (const part of brandField.split(/[/／,，、]/)) {
    if (!searchKey(part)) continue;
    const entry = seedEntry(part) ?? readingPairEntry(part) ?? sameBrandSpellingsEntry(part);
    if (!entry) return null;
    found.add(entry);
  }
  const brands = [...found].filter((e) => !e.maker);
  const shown = brands.length > 0 ? brands : [...found];
  return shown.length === 1 ? shown[0].name : null;
}

/** 一覧のブランドの名前・読み・別の書き方と同じなら、そのブランド */
function seedEntry(text: string): BrandEntry | null {
  if (!seedByKey) {
    seedByKey = new Map();
    for (const b of SEED_INDEX) for (const k of b.keys) if (!seedByKey.has(k)) seedByKey.set(k, b.entry);
  }
  return seedByKey.get(searchKey(text)) ?? null;
}

/** 「CosRx (コスアールエックス)」のような、ブランド名と括弧の中の読み */
const NAME_AND_READING = /^(.+?)\s*[(（]([^()（）]+)[)）]\s*$/;

/** 「名前 (読み)」のどちらかが一覧のブランドで、もう一方が別のブランドでなければ、そのブランド */
function readingPairEntry(part: string): BrandEntry | null {
  const m = part.trim().match(NAME_AND_READING);
  if (!m) return null;
  const listed = [m[1], m[2]].map(seedEntry).filter((e): e is BrandEntry => e !== null);
  return listed.length > 0 && listed.every((e) => e === listed[0]) ? listed[0] : null;
}

/**
 * 「ちふれ・CHIFURE」のように、同じブランドの書き方を「・」で並べたもの（どれも同じブランドのときだけ。
 * 「ラ・ロッシュ・ポゼ」は「・」のまま一覧の書き方なので、ここまで来ない）
 */
function sameBrandSpellingsEntry(part: string): BrandEntry | null {
  const spellings = part.split(/[・･]/).filter((s) => searchKey(s));
  if (spellings.length < 2) return null;
  const entries = spellings.map(seedEntry);
  return entries.every((e) => e !== null && e === entries[0]) ? entries[0] : null;
}

/**
 * 会社名らしい brand 欄（「第一三共ヘルスケア株式会社」「〇〇製薬」「(株)〇〇」「Kao Corporation」）。
 * NFKC にしてから見る（「㈱」「（株）」は「(株)」になる）
 */
const COMPANY_FIELD =
  /^(株式会社|有限会社|\((株|有)\))|(株式会社|有限会社|\((株|有)\)|製薬|ヘルスケア|ホールディングス)$|\b(inc|corp|corporation|co\.?,?\s*ltd|ltd)\.?$/i;

/** brand 欄が会社名か（一覧の会社・「〇〇株式会社」「〇〇製薬」「〇〇ヘルスケア」） */
export function isCompanyBrandField(brandField: string): boolean {
  const listed = listedBrandName(brandField);
  return listed ? BRANDS_JP.some((e) => e.name === listed && e.maker) : COMPANY_FIELD.test(brandField.normalize('NFKC').trim());
}

const labelBrandCache = new Map<string, string | null>();

/**
 * brand 欄が会社名（一覧の会社・「〇〇株式会社」「〇〇製薬」）で、商品名に一覧の会社でないブランドがちょうど1つあれば、
 * そのブランド（「花王」の「キュレル ハンドクリーム」→ キュレル、「ロート製薬」の「メンソレータム …」→ メンソレータム）。
 * 会社名でない brand 欄は変えない（「Kate Somerville」の商品名に KATE があってもケイトにしない）。無ければ null
 */
export function labelBrandName(brandField: string, name: string): string | null {
  const cacheKey = `${brandField}\n${name}`;
  const cached = labelBrandCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const inName = isCompanyBrandField(brandField) ? SEED_INDEX.filter((b) => !b.entry.maker && textHasBrand(name, b)) : [];
  const found = inName.length === 1 ? inName[0].entry.name : null;
  if (labelBrandCache.size > 2000) labelBrandCache.clear();
  labelBrandCache.set(cacheKey, found);
  return found;
}
