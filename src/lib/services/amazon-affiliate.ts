import { listingSearchName } from '../search/listing-name';
import { labelBrandName } from './brand-suggest';

/**
 * Amazon アソシエイト・アフィリエイトリンク生成ヘルパー
 * デフォルトタグ: cosmetantei22-22（ストアID。環境変数で上書き可能。NEXT_PUBLIC_ はビルド時に埋め込まれるので、既定値も正しいタグにしておく）
 */
export const AMAZON_AFFILIATE_TAG =
  process.env.NEXT_PUBLIC_AMAZON_AFFILIATE_TAG || 'cosmetantei22-22';

/**
 * 商品名・ブランド名から Amazon.co.jp アフィリエイト検索URLを生成
 * - お店の商品名の飾り（【公式】「ポイント10倍 11月20〜21日」など）・容量・検索用の語（「崩れにくい 30代 40代 …」）は
 *   検索語に入れない（listingSearchName。Qoo10 の検索と同じ）
 * - 商品名は先頭の MAX_NAME_WORDS 語まで（検索用の語の無い、語を並べただけのお店の商品名でも見つかるように。
 *   保存した製品の名前は 5〜6 語のこともあり、「II」や色番号が落ちないよう Qoo10 の4語より多くする）
 * - brand 欄が会社名で、商品名にブランドがあれば、会社名は入れない（「第一三共ヘルスケア ミノン …」にしない）
 */
const MAX_NAME_WORDS = 6;

export function buildAmazonAffiliateUrl(
  brand: string,
  productName: string,
  tag: string = AMAZON_AFFILIATE_TAG
): string {
  // 名前は NFKC にそろうので、ブランドもそろえてから先頭を比べる（「ＤＨＣ」と「DHC」を重ねない）。
  // 名前が飾りだけなら、ブランドがあればブランドだけで探す（なければ空の検索にしないよう元の文字で）
  const brandKey = brand.normalize('NFKC').trim();
  const name = (listingSearchName(productName) || (brandKey ? '' : productName.normalize('NFKC').trim()))
    .split(' ')
    .slice(0, MAX_NAME_WORDS)
    .join(' ');
  // brand 欄が会社名で、飾りを外した名前にブランドがあれば、会社名もブランドも足さない（名前の中にそのブランドの書き方がある）
  const nameHasBrand = name.startsWith(brandKey) || (!!name && !!labelBrandName(brand, name));
  const query = brandKey && !nameHasBrand ? `${brandKey} ${name}`.trim() : name;
  const encodedQuery = encodeURIComponent(query);
  return `https://www.amazon.co.jp/s?k=${encodedQuery}&tag=${encodeURIComponent(tag)}`;
}
