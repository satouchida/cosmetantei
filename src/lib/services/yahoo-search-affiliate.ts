import { shopSearchQuery } from './search-link-query';

/**
 * Yahoo!ショッピングのアフィリエイト検索リンク（バリューコマースの MyLink）。代わりの商品のカードで、「Qoo10で探す」と同じく
 * 商品名での検索結果のページへリンクする（PR の表示の中に置く。docs/plans/yahoo-search-link.md）。
 *
 * 同じ商品の Yahoo! の出品へのリンク（Product.yahooLink）は、楽天の出品と JAN コードで確かめられたときだけ付く。これは
 * いつも出せる検索のリンクで、検索結果には別の商品も出る（カードの注意書き）。
 * sid・pid は wrangler.toml の YAHOO_AFFILIATE_LINK_TEMPLATE と同じ値（公開してよい値。Yahoo!ショッピングのテキストのリンク用）。
 * MyLink のコードに付く 1×0 の画像は、ページを表示しただけでバリューコマースに送信するので使わない。
 * リンクを開いたときだけ、バリューコマース・Yahoo!ショッピングに送信される（プライバシーポリシー第7条2.）。
 */
const MYLINK = 'https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=3784886&pid=892728177&vc_url=';
/** Yahoo!ショッピングの検索結果のページ（p が空）。末尾に検索語を足す */
const YAHOO_SEARCH = 'https://shopping.yahoo.co.jp/search?p=';
export const YAHOO_MYLINK_SEARCH = MYLINK + encodeURIComponent(YAHOO_SEARCH);

/** Yahoo!ショッピングの検索結果のページ（サイトの検索欄と同じ形）。検索語が作れないときは null */
export function buildYahooSearchUrl(brand: string, productName: string): string | null {
  const query = shopSearchQuery(brand, productName);
  return query && YAHOO_SEARCH + encodeURIComponent(query);
}

/**
 * 商品名・ブランド名から、Yahoo!ショッピングの検索結果へのアフィリエイトリンクを作る。検索語が作れないときは null（リンクを出さない）。
 * 検索結果のページのアドレスを vc_url の値としてもう1回エンコードする（バリューコマースが1回戻してから Yahoo! へ移る）
 */
export function buildYahooAffiliateUrl(brand: string, productName: string): string | null {
  const searchUrl = buildYahooSearchUrl(brand, productName);
  return searchUrl && MYLINK + encodeURIComponent(searchUrl);
}
