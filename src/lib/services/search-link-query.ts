import { listingSearchName } from '../search/listing-name';
import { labelBrandName } from './brand-suggest';

/**
 * お店の検索結果のページへのリンク（「Qoo10で探す」「Yahoo!ショッピングで探す」）の検索語。どちらのお店も同じ語で探す
 * （docs/plans/yahoo-search-link.md「Step 1」。qoo10-affiliate.ts から移した）
 */

/** 容量・入数・セット・単独の数字（お店の商品名の末尾に付く。Qoo10・Yahoo! の検索はすべての語を含む商品だけを出すので外す） */
const PACKAGING = /(?:\d+\s*(?:個|本|点)?\s*|[個本])セット|(?:(?<![a-z])[x×]\s*)?\d+(?:\.\d+)?\s*(?:ml|g|kg|l|枚|個|本|点|箱|袋|パック)(?![a-z])|(?<![a-z])[x×]\s*\d+(?!\S)|(?<!\S)\d+(?!\S)/gi;
const MAX_WORDS = 4;
const MAX_NAME_LENGTH = 300;
/** 名前の分からない製品に入れている仮の名前（src/lib/services/search-barcode-service.ts）。検索語にしない */
const PLACEHOLDER_BRANDS = new Set(['ブランド未登録', 'ブランド未記載']);
const PLACEHOLDER_NAME = /^製品 \(JAN:/;

/** ブランド名の表記。「ちふれ・CHIFURE」のように別の表記を並べたものは最初の表記、「ラ・ロッシュ・ポゼ」のように名前の中の「・」は空白にする */
function brandWords(brand: string): string {
  if (PLACEHOLDER_BRANDS.has(brand.trim())) return '';
  const parts = brand.normalize('NFKC').split(/[・･/／]/).map((s) => s.trim()).filter(Boolean);
  const latin = (s: string) => /^[\x20-\x7e]+$/.test(s);
  return parts.length > 1 && parts.some(latin) && parts.some((s) => !latin(s)) ? parts[0] : parts.join(' ');
}

/**
 * 検索語（ブランド名＋商品名）。お店の商品名の【公式】・送料無料・容量・検索用の語（listingSearchName）などを外し、先頭の4語にする。
 * 対になっていないサロゲートは外す（encodeURIComponent が例外を投げて、カードが表示できなくなるので）。
 * 商品名が仮の名前・飾りだけのときは null（ブランド名だけ・空の検索は別の商品やランキングを開くので、リンクを出さない）
 */
export function shopSearchQuery(brand: string, productName: string): string | null {
  if (PLACEHOLDER_NAME.test(productName.trim())) return null;
  const clean = (s: string) => s.replace(/\p{Cs}/gu, '').replace(/\s+/g, ' ').trim();
  const name = clean(listingSearchName(productName.slice(0, MAX_NAME_LENGTH)).replace(PACKAGING, ' '));
  // brand 欄が会社名で、飾りを外した商品名にブランドがあれば、ブランドを足さない（名前の中に、そのブランドのどれかの
  // 書き方がある。「第一三共ヘルスケア株式会社 ミノン …」「キュレル Curel …」にしない）
  if (name && labelBrandName(brand, name)) return name.split(' ').slice(0, MAX_WORDS).join(' ');
  const first = clean(brandWords(brand));
  if (!name || name.toLowerCase() === first.toLowerCase()) return null;
  const query = !first || name.toLowerCase().includes(first.toLowerCase()) ? name : `${first} ${name}`;
  return query.split(' ').slice(0, MAX_WORDS).join(' ');
}
