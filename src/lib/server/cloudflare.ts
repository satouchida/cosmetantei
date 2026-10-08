import 'server-only';
import { BoundedCache } from '../utils/bounded-cache';

/**
 * Cloudflare バインディング（KV・Rate Limiting）へのアクセスヘルパー
 * - Workers 上では wrangler.toml のバインディングを使う
 * - next dev / テスト環境などバインディングが無い場合は、上限つきインメモリ実装にフォールバックする
 */

interface KVNamespaceLike {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface RateLimiterLike {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface AppBindings {
  APP_CACHE?: KVNamespaceLike;
  AI_RATE_LIMITER?: RateLimiterLike;
  SEARCH_RATE_LIMITER?: RateLimiterLike;
}

const isProduction = process.env.NODE_ENV === 'production';
const loggedWarnings = new Set<string>();

/** 本番環境でのみ、同じ警告を一度だけ出す（設定ミスで保護が無効になったことに気付けるように） */
function warnOnceInProduction(key: string, message: string, err?: unknown): void {
  if (!isProduction || loggedWarnings.has(key)) return;
  loggedWarnings.add(key);
  console.error(message, err ?? '');
}

async function getBindings(): Promise<AppBindings> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const { env } = await getCloudflareContext({ async: true });
    return env as unknown as AppBindings;
  } catch (err) {
    // Cloudflare コンテキスト外（next dev 単体・テスト）。本番で起きた場合は KV・レート制限がメモリ実装に縮退する
    warnOnceInProduction(
      'context',
      'getCloudflareContext failed; KV cache and rate limiting fall back to per-isolate memory:',
      err
    );
    return {};
  }
}

// ---------- KV キャッシュ ----------

const memoryKv = new BoundedCache<unknown>(1000);
// メモリ層は短期間だけ保持し、他のアイソレートが KV に書いた更新を取りこぼさないようにする
const MEMORY_LAYER_TTL_MS = 60_000;

/** KV キーの上限（512バイト）を超えないよう、可変長の入力は SHA-256 でハッシュ化する */
export async function hashedCacheKey(prefix: string, raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}:${hex}`;
}

/** KV の最小 TTL は 60 秒 */
const MIN_KV_TTL_SECONDS = 60;

export async function cacheGetJSON<T>(key: string): Promise<T | null> {
  const local = memoryKv.get(key);
  if (local !== undefined) return local as T;

  const { APP_CACHE } = await getBindings();
  if (!APP_CACHE) return null;
  try {
    const value = (await APP_CACHE.get(key, 'json')) as T | null;
    if (value !== null) memoryKv.set(key, value, MEMORY_LAYER_TTL_MS);
    return value;
  } catch (err) {
    console.error('KV get failed:', err);
    return null;
  }
}

export async function cachePutJSON(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const { APP_CACHE } = await getBindings();
  // KV が無い環境ではメモリ層が唯一の保存先なので、指定の TTL で保持する
  memoryKv.set(key, value, APP_CACHE ? Math.min(ttlSeconds * 1000, MEMORY_LAYER_TTL_MS) : ttlSeconds * 1000);
  if (!APP_CACHE) return;
  try {
    await APP_CACHE.put(key, JSON.stringify(value), {
      expirationTtl: Math.max(MIN_KV_TTL_SECONDS, Math.floor(ttlSeconds)),
    });
  } catch (err) {
    console.error('KV put failed:', err);
  }
}

// ---------- レート制限 ----------

export type RateLimitBucket = 'ai' | 'search';

/** バインディングが無い環境用のフォールバック上限（1分あたり） */
const FALLBACK_LIMITS: Record<RateLimitBucket, number> = { ai: 20, search: 60 };
const RATE_LIMIT_WINDOW_MS = 60_000;
const fallbackHistory = new BoundedCache<number[]>(5000, RATE_LIMIT_WINDOW_MS);

/**
 * IPv6 アドレスを /64 プレフィックスに丸める（同一回線内でアドレスを変えてレート制限を回避されないように）
 */
function toIpv6Prefix64(ip: string): string {
  const [head, tail] = ip.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const missing = tail !== undefined ? 8 - headGroups.length - tailGroups.length : 0;
  const groups = [...headGroups, ...Array(Math.max(missing, 0)).fill('0'), ...tailGroups];
  return `${groups
    .slice(0, 4)
    .map((g) => (parseInt(g, 16) || 0).toString(16))
    .join(':')}::/64`;
}

export function getClientIp(headers: Headers): string {
  const ip = headers.get('cf-connecting-ip') || headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (!ip) return 'anonymous';
  if (!ip.includes(':')) return ip;
  // IPv4射影アドレス（::ffff:1.2.3.4）は IPv4 として扱う
  if (ip.includes('.')) return ip.slice(ip.lastIndexOf(':') + 1);
  return toIpv6Prefix64(ip);
}

/**
 * true を返した場合はリクエストを拒否する
 */
export async function isRateLimited(bucket: RateLimitBucket, clientKey: string): Promise<boolean> {
  const bindings = await getBindings();
  const limiter = bucket === 'ai' ? bindings.AI_RATE_LIMITER : bindings.SEARCH_RATE_LIMITER;
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
