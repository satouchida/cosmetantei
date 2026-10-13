import 'server-only';

/**
 * 価格を調べるお店と、そのアフィリエイトリンク。手順: docs/plans/shop-prices.md
 * - 価格は下のお店のものだけを出す（アフィリエイトの対象にできるお店に限る）
 * - Amazon.co.jp は価格を出さない（Amazon の価格は Amazon の API で取得したものしか表示できない）。検索リンクのみ
 * - アフィリエイト ID は環境変数で設定する。未設定ならリンクはそのまま（広告リンクにしない）
 */

export type ShopId = 'rakuten' | 'yahoo' | 'cosme';

interface ShopInfo {
  /** 表示名 */
  label: string;
  /** Web 検索の語に足す名前（商品名のあとに付ける） */
  searchName: string;
  /** そのお店の商品ページか */
  isProductPage(url: URL): boolean;
}

export const SHOPS: Readonly<Record<ShopId, ShopInfo>> = {
  rakuten: {
    label: '楽天市場',
    searchName: '楽天市場',
    // 商品ページは item.rakuten.co.jp/<店>/<商品>/（楽天24 は item.rakuten.co.jp/rakuten24/…）。
    // 店の独自ページ www.rakuten.ne.jp/gold/<店>/<ページ> も読む。24.rakuten.co.jp や店のトップは一覧なので読まない
    isProductPage: (u) =>
      (u.hostname === 'item.rakuten.co.jp' && /^\/[^/]+\/[^/]+/.test(u.pathname)) ||
      (u.hostname === 'www.rakuten.ne.jp' && /^\/gold\/[^/]+\/[^/]+/.test(u.pathname)),
  },
  yahoo: {
    label: 'Yahoo!ショッピング',
    searchName: 'Yahoo!ショッピング',
    // 商品ページは store.shopping.yahoo.co.jp/<店>/<商品>.html（旧 PayPayモールの paypaymall.yahoo.co.jp/store/<店>/item/<商品>/ も）
    isProductPage: (u) =>
      (u.hostname === 'store.shopping.yahoo.co.jp' && /^\/[^/]+\/[^/]+\.html$/.test(u.pathname)) ||
      (u.hostname === 'paypaymall.yahoo.co.jp' && /^\/store\/[^/]+\/item\/[^/]+/.test(u.pathname)),
  },
  cosme: {
    label: '@cosme SHOPPING',
    searchName: '@cosme SHOPPING',
    isProductPage: (u) => u.hostname === 'www.cosme.com' && u.pathname === '/products/detail.php',
  },
};

export const SHOP_IDS = Object.keys(SHOPS) as ShopId[];

/** 商品ページの URL がどのお店か。対象のお店でなければ null */
export function shopOfUrl(raw: string): ShopId | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  // 4つのお店はすべて https（http のリンクは出さない）
  if (u.protocol !== 'https:') return null;
  return SHOP_IDS.find((id) => SHOPS[id].isProductPage(u)) ?? null;
}

/** 楽天24 の商品か（店名の表示に使う） */
export function isRakuten24(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      (u.hostname === 'item.rakuten.co.jp' && u.pathname.startsWith('/rakuten24/')) ||
      (u.hostname === 'www.rakuten.ne.jp' && u.pathname.startsWith('/gold/rakuten24/'))
    );
  } catch {
    return false;
  }
}

// ---------- 設定 ----------

/** 環境変数（.dev.vars・wrangler の設定）。未設定・プレースホルダー（YOUR_…）なら空 */
export function readShopConfig(name: string): string {
  const value = (process.env[name] || '').trim();
  return /^YOUR_/.test(value) ? '' : value;
}

/** 楽天アフィリエイト ID（例: 1a2b3c4d.5e6f7a8b.1a2b3c4d.5e6f7a8b） */
const RAKUTEN_AFFILIATE_ID_PATTERN = /^[0-9a-f]{8}(\.[0-9a-f]{8}){1,3}$/i;

/**
 * ASP のリンクの雛形（バリューコマースの MyLink、A8.net など）。{url} に商品ページの URL（エンコード済み）が入る
 * 例: https://ck.jp.ap.valuecommerce.com/servlet/referral?sid=…&pid=…&vc_url={url}
 */
const LINK_TEMPLATE_ENV: Readonly<Record<Exclude<ShopId, 'rakuten'>, string>> = {
  yahoo: 'YAHOO_AFFILIATE_LINK_TEMPLATE',
  cosme: 'COSME_AFFILIATE_LINK_TEMPLATE',
};

function fromTemplate(template: string, url: string): string | null {
  // {url} がちょうど1つある https の雛形だけを使う（設定ミスで壊れたリンクを出さない）
  if (!/^https:\/\//.test(template) || template.split('{url}').length !== 2) return null;
  const href = template.replace('{url}', encodeURIComponent(url));
  try {
    return new URL(href).protocol === 'https:' ? href : null;
  } catch {
    return null;
  }
}

/**
 * 商品ページへのリンク。お店のアフィリエイト ID が設定されていればアフィリエイトリンクにする。
 * url は shopOfUrl で対象のお店と確かめた商品ページであること
 */
export function shopLink(shop: ShopId, url: string): { href: string; sponsored: boolean } {
  if (shop === 'rakuten') {
    const id = readShopConfig('RAKUTEN_AFFILIATE_ID');
    if (RAKUTEN_AFFILIATE_ID_PATTERN.test(id)) {
      const target = encodeURIComponent(url);
      return { href: `https://hb.afl.rakuten.co.jp/hgc/${id}/?pc=${target}&m=${target}`, sponsored: true };
    }
    return { href: url, sponsored: false };
  }
  const template = readShopConfig(LINK_TEMPLATE_ENV[shop]);
  const href = template ? fromTemplate(template, url) : null;
  return href ? { href, sponsored: true } : { href: url, sponsored: false };
}
