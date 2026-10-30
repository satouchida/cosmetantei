/** 公開する URL（canonical・OGP・sitemap・robots の基準。workers.dev のアドレスは検索に出さない） */
export const SITE_URL = 'https://cosmetantei.app';

/**
 * 連絡先のメールアドレス（不具合の報告・お問い合わせ）。収集ボットに拾われないよう、ページの HTML にもスクリプトにも
 * 1つの文字列としては書かない：2つに分けて持ち、使うときにつなぐ（ブラウザでは描画の後。src/components/legal/ContactEmail.tsx）
 */
const CONTACT_EMAIL_PARTS = ['contactme', 'cosmetantei.app'] as const;

/** 連絡先のメールアドレス（サーバーの User-Agent と、ブラウザで組み立てるリンクに使う） */
export function contactEmail(): string {
  return CONTACT_EMAIL_PARTS.join('@');
}

/** HTML に書く形（JavaScript が無い・組み立てる前の表示）。＠を書かない */
export const CONTACT_EMAIL_TEXT = `${CONTACT_EMAIL_PARTS[0]}（アットマーク）${CONTACT_EMAIL_PARTS[1]}`;

/**
 * 画面の「不具合を報告」のリンク（メール）。本文はひな形だけで、リストやチャットの文・成分表示は入れない
 * （肌の状態に関わる入力を、メールに写さない。プライバシーポリシー第2条）
 */
export function bugReportMailto(): string {
  const subject = encodeURIComponent('【不具合報告】コスメ探偵');
  const body = encodeURIComponent(
    '起きたこと：\n\nその前にした操作：\n\n端末とブラウザ（例：iPhone の Safari）：\n\n※肌の症状や病歴、氏名などの個人情報は書かないでください。\n'
  );
  return `mailto:${contactEmail()}?subject=${subject}&body=${body}`;
}

/** Amazon アソシエイト・プログラム運営規約（第5条）で決まっている文言。変えない（「適格販売」は Amazon の用語） */
const AMAZON_ASSOCIATE_STATEMENT = 'Amazonのアソシエイトとして、コスメ探偵は適格販売により収入を得ています。';

/**
 * サイトに出すアフィリエイトの表示（サイドバーの下・規約のページの下・利用規約第11条）。
 * Amazon の文言はそのまま先に置き、楽天アフィリエイトとバリューコマース（Yahoo!ショッピングへのリンク）は別の文にする。
 * wrangler.toml でほかの ASP のリンク（@cosme・Yahoo! の別の ASP）を使うときは、こことプライバシーポリシーに足す（test 109）
 */
export const AFFILIATE_DISCLOSURE = `${AMAZON_ASSOCIATE_STATEMENT}また、楽天アフィリエイトおよびバリューコマース（Yahoo!ショッピング・Qoo10）のアフィリエイトプログラムを利用しており、紹介した商品の購入により報酬を得ることがあります。`;

/** 利用規約・プライバシーポリシーの制定日（変えない） */
export const LEGAL_ENACTED = '2026-10-20';

/**
 * 利用規約・プライバシーポリシーの版（最後に変えた日）。ページの日付と、同意の確認（src/lib/consent.ts）の両方に使う。
 * 規約を変えたらこの日付を変える：変えたページの「最終改定日」が変わり、同意した人にももう一度確認する
 * （2026-10-22：利用規約の第3条第5項・第4条第1項・第9条・第9条の2）
 * （2026-10-23：利用規約の第2条第4号・第9条の2第1項・第10条第2項、プライバシーポリシーの第2条第6項）
 * （2026-10-26：利用規約の第5条・第5条の2・第5条の3・第6条第2項・第8条第1項第4号・第12条第2項・お問い合わせ窓口、
 *  プライバシーポリシーの第1条・第2条第1号・第3号・第5号・第7号・第5条・第6条・第9条・第10条・第11条。docs/plans/launch-readiness.md）
 * （2026-10-30：Qoo10 へのリンク（バリューコマースの MyLink。src/lib/services/qoo10-affiliate.ts）。利用規約の第2条第4号・
 *  第10条第2項、プライバシーポリシーの第5条・第7条2.、確認画面（ConsentDialog）、AFFILIATE_DISCLOSURE）
 */
export const LEGAL_VERSION = '2026-10-30';

/** '2026-10-20' → '2026年10月20日' */
export function formatLegalDate(version: string): string {
  const [year, month, day] = version.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}
