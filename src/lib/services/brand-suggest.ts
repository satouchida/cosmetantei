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
}

/** 製品ごとに1回だけ作る（製品が差し替わればオブジェクトが変わるので作り直す） */
const brandFieldCache = new WeakMap<Product, BrandField>();

function brandField(p: Product): BrandField {
  let field = brandFieldCache.get(p);
  if (!field) {
    const brand = p.brand ?? '';
    field = { key: searchKey(brand), words: brand.split(/[\s　,，、/／・]+/).map(searchKey).filter(Boolean) };
    brandFieldCache.set(p, field);
  }
  return field;
}

/**
 * brand 欄にこのキーがあるか。
 * 英字のキーは語の単位で（続く語をつなげてもよい）：「est」が「Estée Lauder」、「pair」が「Repair」に当たらないように。
 * 日本語は空白なしで書くので、2文字以上なら含まれていればよい
 */
function fieldHasKey(field: BrandField, k: string): boolean {
  if (field.key === k) return true;
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

/** 文字列（お店の商品のブランド名・商品名）がこのブランドのものか。照らし方は brand 欄と同じ */
export function textHasBrand(text: string, brand: IndexedBrand): boolean {
  const field: BrandField = { key: searchKey(text), words: text.split(/[\s\u3000,，、/／・]+/).map(searchKey).filter(Boolean) };
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
