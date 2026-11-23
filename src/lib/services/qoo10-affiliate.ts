import { shopSearchQuery } from './search-link-query';

/**
 * Qoo10 のアフィリエイト検索リンク（バリューコマースの MyLink）。Qoo10 には商品を探す API が無いので、
 * Amazon と同じく商品名での検索結果のページへリンクする（代わりの商品のカード。PR の表示の中に置く）。
 *
 * アフィリエイトリンクは、Qoo10 の検索結果のページ（buildQoo10SearchUrl）を MyLink の vc_url に入れて包んだもの。
 * QOO10_MYLINK_SEARCH は、管理画面で作った検索ページの MyLink（keyword が空）の形。
 * pid は広告の種類ごとに違う。892736419 はテキストのリンク用（892736512 は Qoo10 のロゴのバナー用なので使わない）。
 * sid・pid は公開してよい値。
 * MyLink のコードに付く 1×0 の画像（gifbanner）は、ページを表示しただけでバリューコマースに送信するので使わない。
 * リンクを開いたときだけ、バリューコマース・Qoo10 に送信される（プライバシーポリシー第7条2.・同意の画面）。
 */
const MYLINK = 'https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=3784886&pid=892736419&vc_url=';
/** Qoo10 の検索結果のページ（keyword が空）。末尾に検索語を足す */
const QOO10_SEARCH = 'https://www.qoo10.jp/gmkt.inc/Search/Default.aspx?keyword=';
export const QOO10_MYLINK_SEARCH = MYLINK + encodeURIComponent(QOO10_SEARCH);

/** Qoo10 の検索結果のページ（サイトの検索欄と同じ形）。検索語が作れないときは null */
export function buildQoo10SearchUrl(brand: string, productName: string): string | null {
  const query = shopSearchQuery(brand, productName);
  return query && QOO10_SEARCH + encodeURIComponent(query);
}

/**
 * 商品名・ブランド名から、Qoo10 の検索結果へのアフィリエイトリンクを作る。検索語が作れないときは null（リンクを出さない）。
 * 検索結果のページのアドレスを vc_url の値としてもう1回エンコードする（バリューコマースが1回戻してから Qoo10 へ移る）
 */
export function buildQoo10AffiliateUrl(brand: string, productName: string): string | null {
  const searchUrl = buildQoo10SearchUrl(brand, productName);
  return searchUrl && MYLINK + encodeURIComponent(searchUrl);
}
