/**
 * すべてのページ・API に付けるセキュリティのヘッダー。
 * - CSP（docs/plans/content-security-policy.md の Step 1）。いま効いているのは CONTENT_SECURITY_POLICY_ENFORCED で、
 *   ほかのサイトへの埋め込み（クリックジャッキング）・プラグイン・フォームの送り先・base の書き換えを止める。
 *   CONTENT_SECURITY_POLICY は読み込んでよい先をすべて決めた方針で、まだ Report-Only（止めずに、違反をブラウザのコンソールに出すだけ）。
 *   すべての画面で違反が出ないのを確かめてから Content-Security-Policy に移し、上の方針は外す。
 *   script-src の 'unsafe-inline' は、Next.js がページに書き込むインラインのスクリプトのため（ページを静的なままにする。計画の Step 2 で外せるか試す）
 * - カメラはバーコードの読み取りでこのサイトだけが使う。マイク・位置情報は使わない
 */
const isDev = process.env.NODE_ENV === 'development';

/** 製品の写真を読み込んでよいサーバー。サーバーが写真の URL を受け入れる先と同じ（shop-apis.ts の SHOP_IMAGE_HOSTS と search-barcode-service.ts。test 160 で照合） */
const IMAGE_HOSTS = ['https://*.rakuten.co.jp', 'https://*.yimg.jp', 'https://*.openbeautyfacts.org'];
/** Cloudflare Turnstile（スクリプトと確認用の iframe） */
const TURNSTILE = 'https://challenges.cloudflare.com';

const CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  // 開発中だけ 'unsafe-eval'（React の開発ツールが使う。本番では要らない）
  'script-src': ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : []), TURNSTILE],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:', ...IMAGE_HOSTS],
  'font-src': ["'self'"],
  // ブラウザが呼ぶのはこのサイトの /api/... だけ
  'connect-src': ["'self'"],
  'frame-src': [TURNSTILE],
  'media-src': ["'self'", 'blob:', 'mediastream:'],
  'worker-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
};
const CONTENT_SECURITY_POLICY = Object.entries(CSP_DIRECTIVES)
  .map(([name, sources]) => `${name} ${sources.join(' ')}`)
  .join('; ');
// upgrade-insecure-requests は Report-Only では効かず、ブラウザが警告を出す。Content-Security-Policy に移すときに
// CONTENT_SECURITY_POLICY の後ろに付ける（開発サーバーは http なので、開発中は付けない）
// const UPGRADE_INSECURE_REQUESTS = isDev ? '' : '; upgrade-insecure-requests';
const CONTENT_SECURITY_POLICY_ENFORCED = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY_ENFORCED },
  { key: 'Content-Security-Policy-Report-Only', value: CONTENT_SECURITY_POLICY },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 使っているフレームワークを応答で知らせない
  poweredByHeader: false,
  // www は公開するアドレス（https://cosmetantei.app）へ恒久的に転送する（パスとクエリはそのまま）
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.cosmetantei.app' }],
        destination: 'https://cosmetantei.app/:path*',
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      // workers.dev のアドレスは検索に出さない（公開するのは https://cosmetantei.app。canonical もそちら）
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'cosmetantei.satoruchid.workers.dev' }],
        headers: [{ key: 'X-Robots-Tag', value: 'noindex' }],
      },
    ];
  },
};

export default nextConfig;
