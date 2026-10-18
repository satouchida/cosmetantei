/**
 * クラウド・ホスティングの事業者の AS 番号（Cloudflare が要求に付ける request.cf.asn と比べる）。
 * 借りたサーバーの IP をたくさん並べれば IP ごとの予算をすり抜けられるので、これらの事業者からの呼び出しは、
 * 事業者ごとにもまとめて1日の上限を付ける（src/lib/server/spend-cap.ts の hosting）。
 * - 普通の利用者がいる回線（携帯・光回線）は入れない
 * - iCloud プライベートリレー・Cloudflare WARP の出口（Akamai 36183・Cloudflare 13335・Fastly 54113）は、
 *   普通の iPhone の利用者が通るので入れない
 */
export const HOSTING_ASNS: ReadonlySet<number> = new Set([
  16509, // Amazon AWS
  14618, // Amazon AWS
  396982, // Google Cloud
  8075, // Microsoft Azure
  31898, // Oracle Cloud
  14061, // DigitalOcean
  63949, // Akamai Connected Cloud (Linode)
  20473, // Vultr
  16276, // OVHcloud
  24940, // Hetzner
  213230, // Hetzner Cloud
  51167, // Contabo
  12876, // Scaleway
  60781, // Leaseweb
  9009, // M247（VPN・プロキシの出口が多い）
  45102, // Alibaba Cloud
  132203, // Tencent Cloud
  7684, // さくらインターネット
  9370, // さくらインターネット
  9371, // さくらインターネット
]);
