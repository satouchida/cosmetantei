import { withoutListingNoise } from '../search/listing-name';

/**
 * Amazon アソシエイト・アフィリエイトリンク生成ヘルパー
 * デフォルトタグ: cosmetantei22-22（ストアID。環境変数で上書き可能。NEXT_PUBLIC_ はビルド時に埋め込まれるので、既定値も正しいタグにしておく）
 */
export const AMAZON_AFFILIATE_TAG =
  process.env.NEXT_PUBLIC_AMAZON_AFFILIATE_TAG || 'cosmetantei22-22';

/**
 * 商品名・ブランド名から Amazon.co.jp アフィリエイト検索URLを生成
 * - お店の商品名の飾り（【公式】「ポイント10倍 11月20〜21日」など）は検索語に入れない（Qoo10 の検索と同じ）
 */
export function buildAmazonAffiliateUrl(
  brand: string,
  productName: string,
  tag: string = AMAZON_AFFILIATE_TAG
): string {
  // 名前は NFKC にそろうので、ブランドもそろえてから先頭を比べる（「ＤＨＣ」と「DHC」を重ねない）。
  // 名前が飾りだけなら、ブランドがあればブランドだけで探す（なければ空の検索にしないよう元の文字で）
  const brandKey = brand.normalize('NFKC').trim();
  const name = withoutListingNoise(productName) || (brandKey ? '' : productName.normalize('NFKC').trim());
  const query = brandKey && !name.startsWith(brandKey) ? `${brandKey} ${name}`.trim() : name;
  const encodedQuery = encodeURIComponent(query);
  return `https://www.amazon.co.jp/s?k=${encodedQuery}&tag=${encodeURIComponent(tag)}`;
}
