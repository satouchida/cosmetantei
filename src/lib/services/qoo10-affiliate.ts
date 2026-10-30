import { withoutListingNoise } from '../search/listing-name';

/**
 * Qoo10 のアフィリエイト検索リンク（バリューコマースの MyLink）。Qoo10 には商品を探す API が無いので、
 * Amazon と同じく商品名での検索結果のページへリンクする（代わりの商品のカード。PR の表示の中に置く）。
 *
 * QOO10_MYLINK_SEARCH は、管理画面で作った検索ページの MyLink（keyword が空）の形。末尾に検索語を足す。
 * pid は広告の種類ごとに違う。892736419 はテキストのリンク用（892736512 は Qoo10 のロゴのバナー用なので使わない）。
 * sid・pid は公開してよい値。
 * MyLink のコードに付く 1×0 の画像（gifbanner）は、ページを表示しただけでバリューコマースに送信するので使わない。
 * リンクを開いたときだけ、バリューコマース・Qoo10 に送信される（プライバシーポリシー第7条2.・同意の画面）。
 */
export const QOO10_MYLINK_SEARCH =
  'https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=3784886&pid=892736419&vc_url=https%3A%2F%2Fwww.qoo10.jp%2Fgmkt.inc%2FSearch%2FDefault.aspx%3Fkeyword%3D';

/** 容量・入数・セット・単独の数字（お店の商品名の末尾に付く。Qoo10 の検索はすべての語を含む商品だけを出すので外す） */
const PACKAGING = /(?:\d+\s*(?:個|本|点)?\s*|[個本])セット|(?:(?<![a-z])[x×]\s*)?\d+(?:\.\d+)?\s*(?:ml|g|kg|l|枚|個|本|点|箱|袋|パック)(?![a-z])|(?<![a-z])[x×]\s*\d+(?!\S)|(?<!\S)\d+(?!\S)/gi;
const MAX_WORDS = 4;

const MAX_NAME_LENGTH = 300;

/** ブランド名の表記。「ちふれ・CHIFURE」のように別の表記を並べたものは最初の表記、「ラ・ロッシュ・ポゼ」のように名前の中の「・」は空白にする */
function brandWords(brand: string): string {
  const parts = brand.normalize('NFKC').split(/[・･/／]/).map((s) => s.trim()).filter(Boolean);
  const latin = (s: string) => /^[\x20-\x7e]+$/.test(s);
  return parts.length > 1 && parts.some(latin) && parts.some((s) => !latin(s)) ? parts[0] : parts.join(' ');
}

/**
 * 検索語（ブランド名＋商品名）。お店の商品名の【公式】・送料無料・容量などを外し、先頭の4語にする。
 * 対になっていないサロゲートは外す（encodeURIComponent が例外を投げて、カードが表示できなくなるので）
 */
function searchQuery(brand: string, productName: string): string {
  const name = withoutListingNoise(productName.slice(0, MAX_NAME_LENGTH)).replace(PACKAGING, ' ');
  const first = brandWords(brand);
  const query = !first || name.toLowerCase().includes(first.toLowerCase()) ? name : `${first} ${name}`;
  return query.replace(/\p{Cs}/gu, '').split(/\s+/).filter(Boolean).slice(0, MAX_WORDS).join(' ');
}

/** Qoo10 の検索結果のページ（サイトの検索欄と同じ形） */
export function buildQoo10SearchUrl(brand: string, productName: string): string {
  return `https://www.qoo10.jp/gmkt.inc/Search/Default.aspx?keyword=${encodeURIComponent(searchQuery(brand, productName))}`;
}

/**
 * 商品名・ブランド名から、Qoo10 の検索結果へのアフィリエイトリンクを作る。
 * vc_url の中の値なので、検索語は2回エンコードする（バリューコマースが1回戻してから Qoo10 へ移る）
 */
export function buildQoo10AffiliateUrl(brand: string, productName: string): string {
  return QOO10_MYLINK_SEARCH + encodeURIComponent(encodeURIComponent(searchQuery(brand, productName)));
}
