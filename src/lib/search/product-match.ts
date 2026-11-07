import { AMBIGUOUS_BRAND_SPELLINGS, BRANDS_JP } from '../data/brands-jp';
import { NAME_ALIASES } from '../data/name-aliases';
import { Product } from '../types';

/**
 * 製品名の照合（入力途中の候補表示とチャットの製品検索。docs/walkthroughs/2026-10-15-typeahead.md）
 * 日本語の入力の揺れを吸収する：ひらがな・カタカナ、全角・半角（半角カナを含む）、大文字・小文字、
 * アクセント記号（Curél）、空白・中黒・括弧
 */

export const CATEGORY_SYNONYMS: Record<string, string[]> = {
  lip: ['リップ', '口紅', 'ルージュ', 'ティント', 'リップクリーム', 'リップバーム', 'リップジェル'],
  cleanser: ['洗顔', 'クレンジング', 'ウォッシュ', '石鹸', 'せっけん', 'メイク落とし'],
  toner: ['化粧水', 'ローション', 'トナー', 'スキン'],
  cream: ['クリーム', '乳液', 'ミルク', '保湿クリーム', 'ジェルクリーム'],
  serum: ['美容液', 'セラム', 'エッセンス', 'アンプル'],
  sunscreen: ['日焼け止め', '日やけ止め', 'サンプロテクト', 'uvカット', 'uv'],
  mask: ['パック', 'マスク', 'シートマスク'],
  foundation: ['ファンデーション', 'ファンデ', 'bbクリーム', 'ccクリーム', 'クッションファンデ'],
};

const VU_ROW: Record<string, string> = { ァ: 'バ', ィ: 'ビ', ェ: 'ベ', ォ: 'ボ' };

/** 照合で無視する文字（空白・区切り・括弧）。長音「ー」は意味を変えるので残す */
const IGNORED = /[\s\-−·‐‑–—―_・･/\\,，.．、。'"`「」『』【】()（）[\]［］{}｛｝<>〈〉《》!！?？~〜～&＆:：;；]+/g;

/** 照合用のキー */
export function searchKey(text: string): string {
  if (!text) return '';
  return (
    text
      // アクセント記号を外す（é → e）。カタカナの濁点（結合文字 U+3099）は残り、NFKC で元に戻る
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      // 全角英数・半角カナ → 半角英数・全角カナ
      .normalize('NFKC')
      .toLowerCase()
      // ひらがな → カタカナ（ゔ・ゕ・ゖ を含む）
      .replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
      // ヴ の書き方の揺れ（ヴィニル・ビニル）。意味は変わらない
      .replace(/ヴ([ァィェォ])/g, (_, small: string) => VU_ROW[small])
      .replace(/ヴ/g, 'ブ')
      .replace(IGNORED, '')
  );
}

const BARCODE = /^[0-9]{8,14}$/;
const BRAND_ONLY = 50;

const CATEGORY_KEYS: Record<string, string[]> = Object.fromEntries(
  Object.entries(CATEGORY_SYNONYMS).map(([category, words]) => [category, words.map(searchKey)])
);

// ---------- ブランドの書き方・製品名の略し方 ----------

/**
 * 一覧のブランドの書き方（名前・読み・英字表記）の照合キー → そのブランドの照合キー（名前のキー）。
 * forQuery: 検索語の語に使う一覧（普通の英語の語でもある書き方 AMBIGUOUS_BRAND_SPELLINGS を除く）
 */
let brandIndex: { all: Map<string, string>; forQuery: Map<string, string> } | null = null;

function listedBrands(forQuery: boolean): Map<string, string> {
  if (!brandIndex) {
    const all = new Map<string, string>();
    for (const b of BRANDS_JP) {
      const canonical = searchKey(b.name);
      for (const spelling of [b.name, b.kana, ...(b.aliases ?? [])]) {
        const key = spelling ? searchKey(spelling) : '';
        if (key && !all.has(key)) all.set(key, canonical);
      }
    }
    const forQuery = new Map(all);
    for (const w of AMBIGUOUS_BRAND_SPELLINGS) forQuery.delete(searchKey(w));
    brandIndex = { all, forQuery };
  }
  return forQuery ? brandIndex.forQuery : brandIndex.all;
}

/** 語の並びの頭から、一覧のブランドの最も長い書き方（最大4語）。[ブランドの照合キー, 語の数] */
function leadingBrand(words: string[], forQuery = false): [string, number] | null {
  const index = listedBrands(forQuery);
  for (let n = Math.min(4, words.length); n >= 1; n--) {
    const hit = index.get(searchKey(words.slice(0, n).join(' ')));
    if (hit) return [hit, n];
  }
  return null;
}

/**
 * 製品のブランド欄の、一覧のブランドの照合キー（「メイベリン ニューヨーク」「MAYBELLINE NEW YORK」→ メイベリン）。
 * 「花王 / キュレル」は両方。ブランド欄の頭が一覧の書き方のときだけ（語の途中では合わせない）
 */
export function listedBrandKeys(brandField: string): string[] {
  const keys = new Set<string>();
  for (const part of brandField.normalize('NFKC').split(/[/,、]/)) {
    const hit = leadingBrand(part.trim().split(/\s+/).filter(Boolean));
    if (hit) keys.add(hit[0]);
  }
  return [...keys];
}

/** 検索語の語。一覧のブランドの書き方（続く語を含む）はブランドの照合キーにする（「Maybelline」→ メイベリン） */
function brandedTokens(query: string): string[] {
  const words = query.normalize('NFKC').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; ) {
    const hit = leadingBrand(words.slice(i), true);
    out.push(hit ? hit[0] : searchKey(words[i]));
    i += hit ? hit[1] : 1;
  }
  return out.filter(Boolean);
}

/** 製品のブランドが検索語にあるか（一覧の別の書き方を含む。「Maybelline」で「メイベリン ニューヨーク」の製品） */
export function queryNamesBrand(product: Product, query: string): boolean {
  const { brand, brands } = productKeys(product);
  const tokens = brandedTokens(query);
  if (brands.some((b) => tokens.includes(b)) || tokens.includes(brand)) return true;
  // 語の途中の一致は、語の途中に当たりにくい長さのブランド名だけ（「リペア」の「ペア」、「repair」の「pair」に合わせない）。
  // 漢字を含むブランド名は2文字から（「花王の化粧水」）
  const minLength = /[\u4e00-\u9fff]/.test(brand) ? 2 : /^[a-z0-9]+$/.test(brand) ? 4 : 3;
  return brand.length >= minLength && searchKey(query).includes(brand);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 略し方ごとの書き換え（written を語の頭で探す正規表現） */
const NAME_ALIAS_RULES = NAME_ALIASES.map((a) => ({
  brand: searchKey(a.brand),
  pattern: new RegExp(`(^|[\\s【「（(・])${escapeRegExp(a.written.normalize('NFKC'))}${/[a-z]$/i.test(a.written) ? '(?![a-z])' : ''}`, 'gi'),
  readAs: a.readAs.map((r) => r.normalize('NFKC')),
}));

/** 書き換えた形（製品ごとに作り直さない。rankProducts は入力のたびに呼ばれる） */
const aliasCache = new WeakMap<Product, Product[]>();

/** 製品と、ブランドの略し方（src/lib/data/name-aliases.ts）で製品名を書き換えた形。略し方の無いブランドは製品だけ */
export function withNameAliases(p: Product): Product[] {
  let variants = aliasCache.get(p);
  if (!variants) {
    variants = [p];
    const { brand, brands } = productKeys(p);
    const name = p.name.normalize('NFKC');
    const names = new Set([name]);
    for (const rule of NAME_ALIAS_RULES) {
      if (!brands.includes(rule.brand) && !brand.includes(rule.brand)) continue;
      for (const r of rule.readAs) {
        const aliased = name.replace(rule.pattern, (_, before: string) => `${before}${r}`);
        if (!names.has(aliased)) {
          names.add(aliased);
          variants.push({ ...p, name: aliased });
        }
      }
    }
    aliasCache.set(p, variants);
  }
  return variants;
}

/** 製品ごとの照合キー（入力のたびに作り直さない。製品が差し替わればオブジェクトが変わるので作り直す） */
const productKeyCache = new WeakMap<Product, { name: string; brand: string; full: string; brands: string[]; fulls: string[] }>();

function productKeys(p: Product) {
  let keys = productKeyCache.get(p);
  if (!keys) {
    const name = searchKey(p.name);
    const brand = searchKey(p.brand);
    // 一覧のブランドの書き方（名前のキー）でも「ブランド名＋製品名」を作る（英字のブランド欄を「メイベリン」で探せるように）
    const brands = listedBrandKeys(p.brand || '');
    keys = { name, brand, full: brand + name, brands, fulls: [brand + name, ...brands.map((b) => b + name)] };
    productKeyCache.set(p, keys);
  }
  return keys;
}

/** 検索語を照合用にしたもの（製品ごとに作り直さない） */
interface PreparedQuery {
  q: string;
  /** ブランドの書き方を一覧の名前にした検索語（「Maybelline マットインク」→ メイベリンマットインク） */
  branded: string;
  digits: string;
  tokens: string[];
  brandedTokens: string[];
}

function prepareQuery(query: string): PreparedQuery {
  const brandedWords = brandedTokens(query);
  return {
    q: searchKey(query),
    branded: brandedWords.join(''),
    digits: query.replace(/[\s\-]/g, ''),
    tokens: query
      .split(/[\s　]+/)
      .map(searchKey)
      .filter(Boolean),
    brandedTokens: brandedWords,
  };
}

/** rankProducts の点数（0 は合わない。BRAND_ONLY はブランド名だけの一致） */
function scoreProduct(product: Product, { q, branded, digits, tokens, brandedTokens }: PreparedQuery): number {
  const { name, brand, full, brands, fulls } = productKeys(product);
  const categories = Object.hasOwn(CATEGORY_KEYS, product.category) ? CATEGORY_KEYS[product.category] : [];
  const inFields = (t: string) => fulls.some((f) => f.includes(t)) || categories.some((c) => c.includes(t));

  // Yahoo! の商品説明の製品のバーコードは出品者1人が書いた値なので、バーコードの一致として先頭に出さない
  // （search-barcode-service の matchesOwnBarcode と同じ）
  if (
    BARCODE.test(digits) &&
    product.barcode &&
    product.ingredientSource !== 'shop_yahoo' &&
    product.barcode.replace(/^0+/, '') === digits.replace(/^0+/, '')
  )
    return 1000;
  if (name.startsWith(q)) return 400;
  if (full.startsWith(q) || fulls.some((f) => f.startsWith(branded))) return 350;
  // 1文字の入力（入力し始め）は、名前の先頭だけで照合する
  if (q.length < 2) return 0;
  if (name.includes(q)) return 250;
  if (full.includes(q) || (branded.length >= 2 && fulls.some((f) => f.includes(branded)))) return 200;
  // チャットの文の中に製品名がある（「キュレルの泡洗顔料を調べて」）。短い名前は別の語の一部になりやすいので4文字から
  if (name.length >= 4 && q.includes(name)) return 220;
  if (tokens.every(inFields) || brandedTokens.every(inFields)) return 120;
  // 英字だけの短いブランド名は別の語の一部になりやすいので3文字から
  if (brand.length >= (/^[a-z0-9]+$/.test(brand) ? 3 : 2) && q.includes(brand)) return BRAND_ONLY;
  if (brands.some((b) => brandedTokens.includes(b))) return BRAND_ONLY;
  return 0;
}

/**
 * 検索語に合う製品を、よく合う順に返す（合わない製品は除く）
 * 1. バーコードの一致
 * 2. 製品名・「ブランド名＋製品名」が検索語で始まる
 * 3. 製品名・「ブランド名＋製品名」が検索語を含む。検索語（チャットの文）が製品名を含む
 * 4. 空白で区切った語がすべて、ブランド名・製品名・カテゴリ名のどれかに含まれる
 * 5. 検索語がブランド名を含む（同じブランドの製品。ほかに合うものが無いときの候補）
 * 1文字の入力は 1・2 だけ
 * 同じ点数なら、全成分が確認済みの製品を先に
 */
export function rankProducts(products: Product[], query: string, isVerified: (p: Product) => boolean = () => false): Product[] {
  const prepared = prepareQuery(query);
  if (!prepared.q) return [];

  const scored: { product: Product; score: number }[] = [];
  for (const product of products) {
    // ブランドの略し方で書き換えた製品名でも比べ、よい方の点数にする
    const score = Math.max(...withNameAliases(product).map((v) => scoreProduct(v, prepared)));
    if (score === 0) continue;
    scored.push({ product, score: score + (isVerified(product) ? 10 : 0) });
  }
  // ブランド名だけの一致は、ほかに合う製品が無いときだけ
  const matched = scored.some((s) => s.score > BRAND_ONLY + 10) ? scored.filter((s) => s.score > BRAND_ONLY + 10) : scored;
  // sort は安定なので、同じ点数なら元の順（新しく調べた製品が先）
  return matched.sort((a, b) => b.score - a.score).map((s) => s.product);
}

/**
 * 製品が検索語そのものに合うか（rankProducts の 1〜4）。ブランド名だけの一致（同じブランドの別の製品）は合わない。
 * チャットで商品名を調べたときの答えに使う（「マキアージュ ドラマティックエッセンスリキッド」にルージュを出さない）
 */
export function matchesProductWords(product: Product, query: string): boolean {
  const prepared = prepareQuery(query);
  return !!prepared.q && scoreProduct(product, prepared) > BRAND_ONLY;
}

/**
 * 同じ JAN コードの製品を1つにする（別のサイトで調べた同じ製品が、候補に2回出ないように）。
 * 残すのは全成分を確認した最初のもの、無ければ最初のもの。前の方の位置に置く。
 * バーコードの無い製品・違うバーコードの製品はまとめない（詰め替え・リニューアルは JAN が違う。名前だけでは比べない）
 */
export function onePerBarcode(products: Product[], isVerified: (p: Product) => boolean = () => false): Product[] {
  const out: Product[] = [];
  const at = new Map<string, number>();
  for (const p of products) {
    // lookupByBarcode と同じく、数字だけにして先頭の 0 を外して比べる
    const code = (p.barcode ?? '').replace(/[^0-9]/g, '').replace(/^0+/, '');
    const i = code ? at.get(code) : undefined;
    if (i === undefined) {
      if (code) at.set(code, out.length);
      out.push(p);
    } else if (!isVerified(out[i]) && isVerified(p)) {
      out[i] = p;
    }
  }
  return out;
}
