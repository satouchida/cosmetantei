import 'server-only';
import { BoundedCache } from '../utils/bounded-cache';
import { recordUsage } from './usage';
import { consumeSpend } from './spend-cap';

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

interface WorkersAiLike {
  run(model: string, input: Record<string, unknown>, options?: { gateway?: { id: string } }): Promise<unknown>;
  /** Cloudflare Web Search（wrangler 4.149 以降） */
  websearch?(input: { query: string; provider?: string; limit?: number; gatewayId?: string }): Promise<unknown>;
}

/** Durable Object の名前空間（有料の呼び出しの上限。src/lib/server/spend-cap.ts） */
export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(url: string, init?: RequestInit): Promise<Response> };
}

/** Workers Analytics Engine のデータセット（利用量の記録。src/lib/server/usage.ts） */
export interface AnalyticsEngineLike {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

interface AppBindings {
  AI?: WorkersAiLike;
  APP_CACHE?: KVNamespaceLike;
  AI_RATE_LIMITER?: RateLimiterLike;
  SEARCH_RATE_LIMITER?: RateLimiterLike;
  /** 有料の呼び出しの上限を全体で数える Durable Object（worker.ts の SpendCapObject） */
  SPEND_CAP?: DurableObjectNamespaceLike;
  USAGE?: AnalyticsEngineLike;
}

const isProduction = process.env.NODE_ENV === 'production';
const loggedWarnings = new Set<string>();

/** 本番環境でのみ、同じ警告を一度だけ出す（設定ミスで保護が無効になったことに気付けるように） */
export function warnOnceInProduction(key: string, message: string, err?: unknown): void {
  if (!isProduction || loggedWarnings.has(key)) return;
  loggedWarnings.add(key);
  console.error(message, err ?? '');
}

export async function getBindings(): Promise<AppBindings> {
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

/**
 * レスポンスを返した後も処理を続ける（Workers の ctx.waitUntil）。Cloudflare 外ではそのまま実行させておく
 */
export async function runAfterResponse(task: Promise<unknown>): Promise<void> {
  const guarded = task.catch((err) => console.error('Background task failed:', err));
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const { ctx } = await getCloudflareContext({ async: true });
    ctx.waitUntil(guarded);
  } catch (err) {
    // next dev・テスト：Promise はそのまま完了まで実行される。
    // 本番で起きた場合は waitUntil で延長できず、レスポンス後に処理が打ち切られる可能性がある
    warnOnceInProduction('wait-until', 'ctx.waitUntil unavailable; background tasks may be cut off after the response:', err);
  }
}

// ---------- Workers AI ----------

/**
 * Workers AI のモデルを実行する。バインディングが無い環境（next dev・テスト）やエラー時は null
 */
export async function runWorkersAI(
  model: string,
  input: Record<string, unknown>,
  options: { containsUserText?: boolean; task: string }
): Promise<unknown | null> {
  const { AI } = await getBindings();
  if (!AI) {
    warnOnceInProduction('ai-binding', 'Workers AI binding "AI" is missing; Workers AI checks are skipped.');
    return null;
  }
  // AI_GATEWAY_ID があれば AI Gateway を経由し、Gemini と同じダッシュボードで利用量・コストを確認できるようにする。
  // ただし利用者の入力文を含むリクエストは、本文をログに残してよいゲートウェイ（開発用）でのみ経由する
  // （バインディング経由ではリクエストごとに本文ログを止められないため）
  const allowGateway = !options.containsUserText || process.env.AI_GATEWAY_LOG_PAYLOAD === 'true';
  const gatewayId = allowGateway ? (process.env.AI_GATEWAY_ID || '').trim() : '';
  if (!(await consumeSpend('workers_ai'))) {
    console.warn(`Workers AI ${model} skipped: spend cap reached`);
    await recordUsage({ kind: 'workers_ai', task: options.task, model, outcome: 'capped' });
    return null;
  }
  const started = Date.now();
  try {
    const result = await AI.run(model, input, gatewayId ? { gateway: { id: gatewayId } } : undefined);
    const usage = (result as { usage?: { input_tokens?: number; output_tokens?: number } })?.usage;
    await recordUsage({
      kind: 'workers_ai',
      task: options.task,
      model,
      outcome: 'ok',
      promptTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
      ms: Date.now() - started,
    });
    return result;
  } catch (err) {
    console.error(`Workers AI ${model} failed:`, err);
    await recordUsage({ kind: 'workers_ai', task: options.task, model, outcome: 'error', ms: Date.now() - started });
    return null;
  }
}

// ---------- Web 検索 ----------

export type WebSearchProvider = 'exa' | 'linkup';

export interface WebSearchItem {
  url: string;
  title: string;
  description: string;
}

const WEB_SEARCH_TIMEOUT_MS = 8_000;

/**
 * Cloudflare Web Search で1回検索する。バインディングが無い・エラー・タイムアウト時は null
 * - 結果は読むページの候補として一時的に使うだけで、どこにもキャッシュしない（Exa・Linkup の規約）
 * - 検索語はアプリが商品名などから組み立てたもの。利用者のチャット文は渡さない
 */
export async function runWebSearch(
  query: string,
  provider: WebSearchProvider,
  limit: number
): Promise<WebSearchItem[] | null> {
  const { AI } = await getBindings();
  if (!AI?.websearch) {
    warnOnceInProduction('websearch-binding', 'Workers AI websearch is unavailable; web research is skipped.');
    return null;
  }
  // Web 検索は常に AI Gateway 経由（クレジット課金）。ゲートウェイ未設定なら呼ばない
  const gatewayId = (process.env.AI_GATEWAY_ID || '').trim();
  if (!gatewayId) {
    warnOnceInProduction('websearch-gateway', 'AI_GATEWAY_ID is not set; web research is skipped.');
    return null;
  }

  if (!(await consumeSpend('web_search'))) {
    console.warn('Web search skipped: spend cap reached');
    await recordUsage({ kind: 'web_search', task: 'web_search', model: provider, outcome: 'capped' });
    return null;
  }

  const started = Date.now();
  let ok = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('web search timed out')), WEB_SEARCH_TIMEOUT_MS);
    });
    let result: unknown = await Promise.race([AI.websearch({ query, provider, limit, gatewayId }), timeout]);
    // バインディングは Response を返す（Phase 0 で確認）。プレーンなオブジェクトにも対応する
    if (result instanceof Response) {
      if (!result.ok) {
        console.error(`Web search (${provider}) failed: ${result.status}`);
        return null;
      }
      result = await result.json();
    }
    ok = true;
    const items = (result as { items?: unknown })?.items;
    if (!Array.isArray(items)) return [];
    return items
      .filter((i): i is { url: string; title?: unknown; description?: unknown } =>
        typeof (i as { url?: unknown })?.url === 'string' && /^https?:\/\//.test((i as { url: string }).url)
      )
      .map((i) => ({
        url: i.url,
        title: typeof i.title === 'string' ? i.title : '',
        description: typeof i.description === 'string' ? i.description : '',
      }));
  } catch (err) {
    console.error(`Web search (${provider}) failed:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
    // 検索語は記録しない（利用者の入力から作った商品名を含むため）
    await recordUsage({ kind: 'web_search', task: 'web_search', model: provider, outcome: ok ? 'ok' : 'error', ms: Date.now() - started });
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
