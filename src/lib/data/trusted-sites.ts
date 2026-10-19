import { Product } from '../types';

/**
 * 全員で共有してよい Web の製品情報の出典（docs/plans/trusted-sites.md）
 * - Web のページから読んだ製品（ID が web_ で始まる）は、ここに載ったサイトのページのときだけ、
 *   共有のキャッシュ（KV の検索結果・メモリ・確認済み製品の一覧・バーコードの結果）に入れ、代わりの商品にも使う
 * - 載っていないサイトの製品は、調べた本人にだけ返す（「ほかのサイトの情報」と表示）
 * - TRUSTED_SITES_MODE: off（今までどおり）/ shadow（今までどおり動き、出典のホスト名と判定だけをログに出す）/
 *   enforce（上のとおり共有を絞る）。既定は off
 * - 判定はホスト名だけ。https で、ドメインそのものか、そのサブドメイン（look-alike の kao.co.jp.evil.example は通さない）
 */

/**
 * ブランドの会社の公式サイト（ドメイン）。会社ごと。src/lib/data/brands-jp.ts のブランドの会社のうち、
 * 公式サイトのドメインを確かめたものだけ。お店（ドラッグストアの通販など）は shadow のログを見て、
 * 全成分を載せているか確かめてから足す
 */
export const TRUSTED_DOMAINS: readonly string[] = [
  // 資生堂（エリクシール・アネッサ・dプログラム・HAKU・マキアージュほか）
  'shiseido.co.jp',
  'ipsa.co.jp',
  'cledepeau-beaute.com',
  // 花王・カネボウ（キュレル・ビオレ・ソフィーナ・エストほか）
  'kao.co.jp',
  'kao.com',
  'kanebo-cosmetics.co.jp',
  'nivea.co.jp',
  // コーセー（雪肌精・コスメデコルテ・ヴィセほか）
  'kose.co.jp',
  'decorte.com',
  // ポーラ・オルビスグループ
  'pola.co.jp',
  'orbis.co.jp',
  'decencia.co.jp',
  // ロート製薬（肌ラボ・メラノCC・スキンアクアほか）
  'rohto.co.jp',
  // マンダム・第一三共ヘルスケア（ミノン・トランシーノ）・小林製薬・ライオン・富士フイルム（アスタリフト）・クラシエ（肌美精）
  'mandom.co.jp',
  'daiichisankyo-hc.co.jp',
  'kobayashi.co.jp',
  'lion.co.jp',
  'fujifilm.com',
  'kracie.co.jp',
  // 手頃なスキンケア・メイク
  'meishoku.co.jp',
  'bcl-company.co.jp',
  'lululun.com',
  'yuskin.co.jp',
  'chifure.co.jp',
  'cezanne.co.jp',
  'canmake.com',
  'isehan.co.jp',
  'muji.com',
  'cow-soap.co.jp',
  // 通販・専門のブランド
  'dhc.co.jp',
  'fancl.co.jp',
  'attenir.co.jp',
  'ci-labo.com',
  'haba.co.jp',
  'etvos.com',
  'shiro-shiro.jp',
  'ayura.co.jp',
  'noevir.co.jp',
  'menard.co.jp',
  'cbon.co.jp',
  'saishunkan.co.jp',
  'albion.co.jp',
  'naris.co.jp',
  // 海外ブランドの日本の公式サイト
  'rmkrmk.com',
  'shuuemura.jp',
  'lancome.jp',
  'esteelauder.jp',
  'clinique.jp',
  'yslb.jp',
  'narscosmetics.jp',
  'maccosmetics.jp',
  'bobbibrown.jp',
  'kiehls.jp',
  'larocheposay.jp',
  'unilever.co.jp',
];

/**
 * 載っていても信頼しないホスト（出品者が書く商品ページ・個人の投稿・情報の提供を断っているサイト）。
 * 上の一覧のサブドメインに当たっても、こちらが優先
 */
export const NEVER_TRUSTED_DOMAINS: readonly string[] = [
  'amazon.co.jp',
  'rakuten.co.jp',
  'shopping.yahoo.co.jp',
  'chiebukuro.yahoo.co.jp',
  'mercari.com',
  'cosmetic-info.jp',
  'ameblo.jp',
  'note.com',
];

export type TrustedSitesMode = 'off' | 'shadow' | 'enforce';

export function trustedSitesMode(): TrustedSitesMode {
  const mode = (process.env.TRUSTED_SITES_MODE || '').trim().toLowerCase();
  return mode === 'shadow' || mode === 'enforce' ? mode : 'off';
}

const matchesDomain = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

/** 出典のホスト名（https のときだけ。小文字、末尾の「.」なし）。URL でなければ null */
export function sourceHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    // 決まったポート以外は、同じホストの別のサービスかもしれないので信頼しない
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return null;
    return parsed.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

/** 共有してよいサイトの URL か */
export function isTrustedSource(url: string | undefined): boolean {
  const host = sourceHost(url);
  if (!host) return false;
  if (NEVER_TRUSTED_DOMAINS.some((d) => matchesDomain(host, d))) return false;
  return TRUSTED_DOMAINS.some((d) => matchesDomain(host, d));
}

type SourceFields = Pick<Product, 'id'> & Partial<Pick<Product, 'sourceUrl' | 'ingredientSource' | 'sharedSource'>>;

/**
 * Web のページから読んだ製品か（web-research.ts の toProduct が ID の頭に web_ を付ける）。
 * 出典の URL・web_page の印がある製品も含める（ID の付け方が変わっても、判定から漏らさない）
 */
export function isWebPageProduct(p: SourceFields): boolean {
  return p.id.startsWith('web_') || p.ingredientSource === 'web_page' || !!p.sourceUrl;
}

/**
 * 全員で共有してよい製品か。enforce のときだけ、Web の製品を信頼するサイトのものに絞る。
 * sharedSource: false（サーバーが「共有しない」と決めた製品。出典の URL が後から信頼するサイトに変わっても）は共有しない
 */
export function mayShareWebProduct(p: SourceFields): boolean {
  if (p.sharedSource === false) return false;
  return !isWebPageProduct(p) || trustedSitesMode() !== 'enforce' || isTrustedSource(p.sourceUrl);
}

/**
 * shadow・enforce のとき、Web の製品の出典の判定をログに出す（ホスト名だけ。検索語・商品名・成分は出さない）。
 * task: どの調べもので見つけたか（research・alternatives・barcode）
 */
export function logSourceTrust(products: SourceFields[], task: string): void {
  if (trustedSitesMode() === 'off') return;
  for (const p of products) {
    if (!isWebPageProduct(p)) continue;
    const host = sourceHost(p.sourceUrl) ?? 'unknown';
    console.log(`[trusted-sites] ${JSON.stringify({ trusted: isTrustedSource(p.sourceUrl), host, task })}`);
  }
}
