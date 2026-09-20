/**
 * Amazon アソシエイト・アフィリエイトリンク生成ヘルパー
 * デフォルトタグ: cosmetantei-22 (環境変数で上書き可能)
 */
export const AMAZON_AFFILIATE_TAG =
  process.env.NEXT_PUBLIC_AMAZON_AFFILIATE_TAG || 'cosmetantei-22';

/**
 * 商品名・ブランド名から Amazon.co.jp アフィリエイト検索URLを生成
 */
export function buildAmazonAffiliateUrl(
  brand: string,
  productName: string,
  tag: string = AMAZON_AFFILIATE_TAG
): string {
  const query = productName.startsWith(brand) ? productName : `${brand} ${productName}`.trim();
  const encodedQuery = encodeURIComponent(query);
  return `https://www.amazon.co.jp/s?k=${encodedQuery}&tag=${encodeURIComponent(tag)}`;
}

/**
 * JANコードから Amazon.co.jp アフィリエイト検索URLを生成
 */
export function buildAmazonBarcodeUrl(
  barcode: string,
  tag: string = AMAZON_AFFILIATE_TAG
): string {
  return `https://www.amazon.co.jp/s?k=${encodeURIComponent(barcode)}&tag=${encodeURIComponent(tag)}`;
}
