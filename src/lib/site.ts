/** 公開する URL（canonical・OGP・sitemap・robots の基準。workers.dev のアドレスは検索に出さない） */
export const SITE_URL = 'https://cosmetantei.app';

/** Amazon アソシエイト・プログラム運営規約（第5条）で決まっている文言。変えない（「適格販売」は Amazon の用語） */
const AMAZON_ASSOCIATE_STATEMENT = 'Amazonのアソシエイトとして、コスメ探偵は適格販売により収入を得ています。';

/**
 * サイトに出すアフィリエイトの表示（サイドバーの下・規約のページの下・利用規約第11条）。
 * Amazon の文言はそのまま先に置き、楽天アフィリエイトとバリューコマース（Yahoo!ショッピングへのリンク）は別の文にする。
 * wrangler.toml でほかの ASP のリンク（@cosme・Yahoo! の別の ASP）を使うときは、こことプライバシーポリシーに足す（test 109）
 */
export const AFFILIATE_DISCLOSURE = `${AMAZON_ASSOCIATE_STATEMENT}また、楽天アフィリエイトおよびバリューコマース（Yahoo!ショッピング）のアフィリエイトプログラムを利用しており、紹介した商品の購入により報酬を得ることがあります。`;

/** 利用規約・プライバシーポリシーの制定日（変えない） */
export const LEGAL_ENACTED = '2026-10-20';

/**
 * 利用規約・プライバシーポリシーの版（最後に変えた日）。ページの日付と、同意の確認（src/lib/consent.ts）の両方に使う。
 * 規約を変えたらこの日付を変える：変えたページの「最終改定日」が変わり、同意した人にももう一度確認する
 * （2026-10-22：利用規約の第3条第5項・第4条第1項・第9条・第9条の2）
 * （2026-10-23：利用規約の第2条第4号・第9条の2第1項・第10条第2項、プライバシーポリシーの第2条第6項）
 */
export const LEGAL_VERSION = '2026-10-23';

/** '2026-10-20' → '2026年10月20日' */
export function formatLegalDate(version: string): string {
  const [year, month, day] = version.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}
