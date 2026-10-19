/**
 * すべてのページ・API に付けるセキュリティのヘッダー。
 * - CSP は、ほかのサイトへの埋め込み（クリックジャッキング）・プラグイン・フォームの送り先・base の書き換えだけを止める。
 *   script-src は指定しない（Next.js がページに書き込むインラインのスクリプトを止めてしまうため）
 * - カメラはバーコードの読み取りでこのサイトだけが使う。マイク・位置情報は使わない
 */
const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
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
