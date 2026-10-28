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
};

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
      .replace(IGNORED, '')
  );
}

const BARCODE = /^[0-9]{8,14}$/;
const BRAND_ONLY = 50;

const CATEGORY_KEYS: Record<string, string[]> = Object.fromEntries(
  Object.entries(CATEGORY_SYNONYMS).map(([category, words]) => [category, words.map(searchKey)])
);

/** 製品ごとの照合キー（入力のたびに作り直さない。製品が差し替わればオブジェクトが変わるので作り直す） */
const productKeyCache = new WeakMap<Product, { name: string; brand: string; full: string }>();

function productKeys(p: Product) {
  let keys = productKeyCache.get(p);
  if (!keys) {
    const name = searchKey(p.name);
    const brand = searchKey(p.brand);
    keys = { name, brand, full: brand + name };
    productKeyCache.set(p, keys);
  }
  return keys;
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
  const q = searchKey(query);
  if (!q) return [];
  const digits = query.replace(/[\s\-]/g, '');
  const tokens = query
    .split(/[\s　]+/)
    .map(searchKey)
    .filter(Boolean);

  const scored: { product: Product; score: number }[] = [];
  for (const product of products) {
    const { name, brand, full } = productKeys(product);
    const categories = Object.hasOwn(CATEGORY_KEYS, product.category) ? CATEGORY_KEYS[product.category] : [];
    const inFields = (t: string) => full.includes(t) || categories.some((c) => c.includes(t));

    let score = 0;
    // Yahoo! の商品説明の製品のバーコードは出品者1人が書いた値なので、バーコードの一致として先頭に出さない
    // （search-barcode-service の matchesOwnBarcode と同じ）
    if (
      BARCODE.test(digits) &&
      product.barcode &&
      product.ingredientSource !== 'shop_yahoo' &&
      product.barcode.replace(/^0+/, '') === digits.replace(/^0+/, '')
    )
      score = 1000;
    else if (name.startsWith(q)) score = 400;
    else if (full.startsWith(q)) score = 350;
    // 1文字の入力（入力し始め）は、名前の先頭だけで照合する
    else if (q.length < 2) score = 0;
    else if (name.includes(q)) score = 250;
    else if (full.includes(q)) score = 200;
    // チャットの文の中に製品名がある（「キュレルの泡洗顔料を調べて」）。短い名前は別の語の一部になりやすいので4文字から
    else if (name.length >= 4 && q.includes(name)) score = 220;
    else if (tokens.every(inFields)) score = 120;
    // 英字だけの短いブランド名は別の語の一部になりやすいので3文字から
    else if (brand.length >= (/^[a-z0-9]+$/.test(brand) ? 3 : 2) && q.includes(brand)) score = BRAND_ONLY;
    if (score === 0) continue;
    scored.push({ product, score: score + (isVerified(product) ? 10 : 0) });
  }
  // ブランド名だけの一致は、ほかに合う製品が無いときだけ
  const matched = scored.some((s) => s.score > BRAND_ONLY + 10) ? scored.filter((s) => s.score > BRAND_ONLY + 10) : scored;
  // sort は安定なので、同じ点数なら元の順（新しく調べた製品が先）
  return matched.sort((a, b) => b.score - a.score).map((s) => s.product);
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
