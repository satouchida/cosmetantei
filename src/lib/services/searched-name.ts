import { Product } from '../types';
import { listedBrandName } from './brand-suggest';
import { toProductSearchQuery } from './page-search';
import { withoutListingNoise } from '../search/listing-name';
import { isShopListingProduct } from '../product-source';
import { matchesProductWords, queryNamesBrand, searchKey, withNameAliases } from '../search/product-match';

/**
 * 製品が、チャットで調べた商品名そのものか（答えにするか・有料の Web リサーチを省くか）。
 * toProductSearchQuery（サーバーだけ）を使うので、クライアントでも読む product-match.ts には置かない
 */

/**
 * 製品が、チャットで調べた商品名に合うか。文から取り出した商品名でも比べる。「キュレルの化粧水」の「の」は語の区切りとみなす
 * （製品名に「の」がある製品は、そのままの検索語で合う）。お店の商品名は飾り（【公式】・送料無料など）を外して比べる。
 * 製品のブランド名が検索語にあれば、製品名に無いことの多い語（容量・色番号など数字のある語、別のブランド名・会社名）は
 * 無くてもよい（「資生堂 マキアージュ …リキッド オークル10」）
 */
export function namesSearchedProduct(p: Product, text: string): boolean {
  // ブランドの略し方（メイベリンの「SPステイ」＝「スーパーステイ」）で書き換えた製品名でも比べる
  return withNameAliases(p).some((v) => namesSearchedName(v, text));
}

function namesSearchedName(p: Product, text: string): boolean {
  const target = isShopListingProduct(p) ? { ...p, name: withoutListingNoise(p.name) } : p;
  const productQuery = toProductSearchQuery(text);
  const queries = [text, ...(productQuery ? [productQuery, productQuery.replace(/の/g, ' ')] : [])];
  if (queries.some((q) => matchesProductWords(target, q))) return true;
  const brand = searchKey(target.brand);
  // 製品のブランドが検索語にあるか（一覧の英字表記などの書き方を含む。「Maybelline …」で「メイベリン ニューヨーク」）
  if (!productQuery || !queryNamesBrand(target, productQuery)) return false;
  const words = productQuery.replace(/の/g, ' ').split(/\s+/).filter(Boolean);
  const optional = (w: string) => {
    const key = searchKey(w);
    return /\d/.test(key) || (!brand.includes(key) && listedBrandName(w) !== null);
  };
  const required = words.filter((w) => !optional(w));
  return required.length > 0 && required.length < words.length && matchesProductWords(target, required.join(' '));
}

/** 製品名（ブランド名つきも含む）が検索語を含むか。ブランド名だけの一致は数えない */
export function namesProduct(p: Product, query: string): boolean {
  return withNameAliases(p).some((v) => namesProductName(v, query));
}

function namesProductName(p: Product, query: string): boolean {
  // 候補の照合（rankProducts）と同じキーで比べる。ひらがなで聞かれても、確認済みの製品があれば有料の Web リサーチをしない
  const q = searchKey(query);
  if (!q) return false;
  // 英字で終わる検索語（「ローション II」）は後ろに英字が続かない位置、数字で終わる検索語（「50」）は後ろに数字が
  // 続かない位置で合うときだけ（「II」で「III」、「50」で「500」に合わせない）。
  // 製品名の語の切れ目（空白）は \u0001 で残し、検索語の文字の間にはあってもよいとする：切れ目の後の語は続きとみなさない
  // （「Hydrating Cleanser」で「Hydrating Cleanser Normal to Dry Skin」に合う。「ローション II 150ml」も合う）
  const tail = /[a-z]$/.test(q) ? '(?![a-z])' : /[0-9]$/.test(q) ? '(?![0-9])' : '';
  const escaped = Array.from(q, (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\u0001?');
  const pattern = new RegExp(`${escaped}${tail}`);
  const spaced = (text: string) => text.split(/\s+/).map(searchKey).filter(Boolean).join('\u0001');
  return pattern.test(spaced(p.name)) || pattern.test(spaced(`${p.brand} ${p.name}`));
}
