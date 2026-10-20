/** 公開する URL（canonical・OGP・sitemap・robots の基準。workers.dev のアドレスは検索に出さない） */
export const SITE_URL = 'https://cosmetantei.app';

/** Amazon アソシエイト・プログラム運営規約で、サイトに表示することになっている文言（サイドバーの下・規約のページ） */
export const AMAZON_ASSOCIATE_STATEMENT = 'Amazonのアソシエイトとして、コスメ探偵は適格販売により収入を得ています。';

/**
 * 利用規約・プライバシーポリシーの版（制定日・改定日）。ページの日付と、同意の確認（src/lib/consent.ts）の両方に使う。
 * 規約を変えたらこの日付を変える：ページの日付が変わり、同意した人にももう一度確認する
 */
export const LEGAL_VERSION = '2026-10-20';

/** '2026-10-20' → '2026年10月20日' */
export function formatLegalDate(version: string): string {
  const [year, month, day] = version.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}
