/**
 * すべてのページ・API に付けるセキュリティのヘッダー。
 * - CSP（docs/plans/content-security-policy.md の Step 1）。読み込んでよい先・送ってよい先をすべて決め、それ以外を止める。
 *   2026-11-12 に Report-Only で公開し、すべての画面（カメラを含む）で違反が出ないのを確かめてから止める方針に移した。
 *   読み込む先を増やすときは、ここと test 160 とプライバシーポリシー（外部送信）を一緒に変える。
 *   script-src の 'unsafe-inline' は、Next.js がページに書き込むインラインのスクリプトのため（ページを静的なままにする。ビルド時のハッシュ（計画の Step 2）では外せないことを 2026-11-12 に確かめた）
 * - カメラはバーコードの読み取りでこのサイトだけが使う。マイク・位置情報は使わない
 */
const isDev = process.env.NODE_ENV === 'development';

/** 製品の写真を読み込んでよいサーバー。サーバーが写真の URL を受け入れる先と同じ（shop-apis.ts の SHOP_IMAGE_HOSTS と search-barcode-service.ts。test 160 で照合） */
const IMAGE_HOSTS = ['https://*.rakuten.co.jp', 'https://*.yimg.jp', 'https://*.openbeautyfacts.org'];
/** Cloudflare Turnstile（スクリプトと確認用の iframe） */
const TURNSTILE = 'https://challenges.cloudflare.com';
/** Cloudflare Web Analytics のスクリプト（Cloudflare がページに入れる。計測の送り先はこのサイトの /cdn-cgi/rum。プライバシーポリシー第7条2.） */
const CLOUDFLARE_WEB_ANALYTICS = 'https://static.cloudflareinsights.com';

const CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  // 開発中だけ 'unsafe-eval'（React の開発ツールが使う。本番では要らない）
  'script-src': ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : []), TURNSTILE, CLOUDFLARE_WEB_ANALYTICS],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:', ...IMAGE_HOSTS],
  'font-src': ["'self'"],
  // ブラウザが呼ぶのはこのサイトの /api/... と Cloudflare Web Analytics の /cdn-cgi/rum だけ。
  // 将来 Cloudflare の仕様変更や手動埋め込み等で https://cloudflareinsights.com/cdn-cgi/rum へ直接送られる場合は 'https://cloudflareinsights.com' を追加する
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
const CONTENT_SECURITY_POLICY = [
  ...Object.entries(CSP_DIRECTIVES).map(([name, sources]) => `${name} ${sources.join(' ')}`),
  // 開発サーバーは http なので、開発中は付けない
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
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
