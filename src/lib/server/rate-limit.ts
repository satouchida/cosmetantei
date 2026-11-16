import 'server-only';
import { BoundedCache } from '../utils/bounded-cache';
import { AppBindings, getBindings, RateLimiterLike, warnOnceInProduction } from './cloudflare';

export type RateLimitBucket = 'ai' | 'search' | 'price' | 'session' | 'shop' | 'shop_session';

/** バインディングが無い環境用のフォールバック上限（1分あたり） */
const FALLBACK_LIMITS: Record<RateLimitBucket, number> = { ai: 20, search: 60, price: 10, session: 10, shop: 20, shop_session: 6 };

const RATE_LIMITER_BINDING: Record<RateLimitBucket, keyof AppBindings> = {
  ai: 'AI_RATE_LIMITER',
  search: 'SEARCH_RATE_LIMITER',
  price: 'PRICE_RATE_LIMITER',
  session: 'SESSION_RATE_LIMITER',
  shop: 'SHOP_RATE_LIMITER',
  shop_session: 'SHOP_SESSION_RATE_LIMITER',
};
const RATE_LIMIT_WINDOW_MS = 60_000;
const fallbackHistory = new BoundedCache<number[]>(5000, RATE_LIMIT_WINDOW_MS);

/**
 * IPv6 アドレスを /48 プレフィックスに丸める（安いサーバーや回線は /48・/56 をまとめて持つので、
 * /64 で分けると、アドレスを変えるだけで回数制限・利用者ごとの予算を何万倍にもできる）
 */
function toIpv6Prefix48(ip: string): string {
  const [head, tail] = ip.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const missing = tail !== undefined ? 8 - headGroups.length - tailGroups.length : 0;
  const groups = [...headGroups, ...Array(Math.max(missing, 0)).fill('0'), ...tailGroups];
  return `${groups
    .slice(0, 3)
    .map((g) => (parseInt(g, 16) || 0).toString(16))
    .join(':')}::/48`;
}

/**
 * 利用者の IP（回数制限・利用者ごとの予算のキー）。本番は Cloudflare が付ける cf-connecting-ip だけを使う
 * （x-forwarded-for は利用者が自由に書けるので、Cloudflare の外で動かす開発環境だけで使う）
 */
export function getClientIp(headers: Headers): string {
  const forwarded = process.env.NODE_ENV === 'production' ? undefined : headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = headers.get('cf-connecting-ip') || forwarded;
  if (!ip) return 'anonymous';
  if (!ip.includes(':')) return ip;
  // IPv4射影アドレス（::ffff:1.2.3.4）は IPv4 として扱う
  if (ip.includes('.')) return ip.slice(ip.lastIndexOf(':') + 1);
  return toIpv6Prefix48(ip);
}

/** IPv4 アドレス（getClientIp の値）の /24（隣り合う 256 個）。IPv4 でなければ null */
export function ipv4Network24(ip: string): string | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (!m || m.slice(1).some((part) => Number(part) > 255)) return null;
  return `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}.0/24`;
}

/**
 * true を返した場合はリクエストを拒否する
 */
export async function isRateLimited(bucket: RateLimitBucket, clientKey: string): Promise<boolean> {
  const bindings = await getBindings();
  const limiter = bindings[RATE_LIMITER_BINDING[bucket]] as RateLimiterLike | undefined;
  const key = `${bucket}:${clientKey}`;

  if (limiter) {
    try {
      const { success } = await limiter.limit({ key });
      return !success;
    } catch (err) {
      console.error('Rate limiter binding failed, using in-memory fallback:', err);
    }
  } else {
    warnOnceInProduction(
      `limiter:${bucket}`,
      `Rate limit binding for "${bucket}" is missing; using per-isolate in-memory limit.`
    );
  }

  const now = Date.now();
  const recent = (fallbackHistory.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= FALLBACK_LIMITS[bucket]) {
    fallbackHistory.set(key, recent);
    return true;
  }
  recent.push(now);
  fallbackHistory.set(key, recent);
  return false;
}

export const RATE_LIMIT_MESSAGE_JA =
  '⚠️ 短時間の連続アクセスを検知しました。AIリクエストの過剰消費を防ぐため、1分ほど時間をおいてから再度お試しください。';
