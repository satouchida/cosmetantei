import 'server-only';
import { BoundedCache } from '../utils/bounded-cache';
import { isUpstreamLimit, markRefused, recordUsage } from './usage';
import { reserveSpend } from './spend-cap';
import { WEB_SEARCH_COST_MICROS, workersAiCostMicros } from './prices';

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
  /** 価格の検索（1回で Web 検索と Gemini のページ読み取りを何回も使うので、ほかの AI の操作より少なくする） */
  PRICE_RATE_LIMITER?: RateLimiterLike;
  /** Turnstile の確認とセッションの発行（src/lib/server/session.ts） */
  SESSION_RATE_LIMITER?: RateLimiterLike;
  /** お店の商品検索（無料だが全員で1分 50 回まで。1人で使い切らせない）。IP ごとと、セッションごと */
  SHOP_RATE_LIMITER?: RateLimiterLike;
  SHOP_SESSION_RATE_LIMITER?: RateLimiterLike;
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
 * 要求元のネットワークの AS 番号（Cloudflare が付ける request.cf.asn）。Cloudflare 外（next dev・テスト）では undefined
 */
export async function getRequestAsn(): Promise<number | undefined> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const { cf } = await getCloudflareContext({ async: true });
    const asn = (cf as { asn?: unknown } | undefined)?.asn;
    return Number.isSafeInteger(asn) && (asn as number) > 0 ? (asn as number) : undefined;
  } catch {
    return undefined;
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

/** Workers AI（Clef）の呼び出しを待つ上限 */
const WORKERS_AI_TIMEOUT_MS = 5_000;

/**
 * Workers AI のモデルを実行する。バインディングが無い環境（next dev・テスト）・エラー・タイムアウト時は null
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
  // 見積もり：入力の JSON の文字数をトークン数とみなす（Clef は入力だけ課金。1回 0.001 ドル未満）
  if (!(await reserveSpend('workers_ai', workersAiCostMicros(model, JSON.stringify(input).length)))) {
    console.warn(`Workers AI ${model} skipped: spend cap reached`);
    await recordUsage({ kind: 'workers_ai', task: options.task, model, outcome: 'capped' });
    return null;
  }
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // 応答が無いまま待ち続けない（呼び出し側のゲート・フィルターにも短い上限があるが、ブランドの判定には無いため）
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${WORKERS_AI_TIMEOUT_MS} ms`)), WORKERS_AI_TIMEOUT_MS);
    });
    const result = await Promise.race([AI.run(model, input, gatewayId ? { gateway: { id: gatewayId } } : undefined), timeout]);
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
    // ゲートウェイの上限で断られた失敗は、失敗として覚えない（判定は手元の規則に戻るので、画面には伝えない）
    if (isUpstreamLimit(err)) markRefused();
    console.error(`Workers AI ${model} failed:`, err instanceof Error ? err.message : err);
    await recordUsage({ kind: 'workers_ai', task: options.task, model, outcome: 'error', ms: Date.now() - started });
    return null;
  } finally {
    clearTimeout(timer);
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

  if (!(await reserveSpend('web_search', WEB_SEARCH_COST_MICROS[provider]))) {
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
        if (isUpstreamLimit(result.status)) markRefused('unavailable', 'web_search');
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
    if (isUpstreamLimit(err)) markRefused('unavailable', 'web_search');
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

/** テスト用：KV のメモリの写しを消す（同じキーを、別の内容で読み直すテストのため） */
export function clearMemoryCacheForTests(): void {
  memoryKv.clear();
}
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

/**
 * KV から JSON を読む（同じアイソレートのメモリに 60 秒の写しを持つ）。
 * fresh: メモリの写しを使わず KV を読む（ほかのアイソレートが書いたばかりの値を探すとき）
 */
export async function cacheGetJSON<T>(key: string, { fresh = false }: { fresh?: boolean } = {}): Promise<T | null> {
  const local = fresh ? undefined : memoryKv.get(key);
  if (local !== undefined) return local as T;

  const { APP_CACHE } = await getBindings();
  // KV が無い環境（開発・テスト）では、メモリ層が唯一の保存先（fresh でも読む。cachePutJSON と同じ）
  if (!APP_CACHE) return fresh ? ((memoryKv.get(key) as T | undefined) ?? null) : null;
  try {
    const value = (await APP_CACHE.get(key, 'json')) as T | null;
    if (value !== null) memoryKv.set(key, value, MEMORY_LAYER_TTL_MS);
    return value;
  } catch (err) {
    console.error('KV get failed:', err);
    return null;
  }
}

/**
 * KV から JSON を読む（いつも KV を読む）。読めなかったら例外にする（呼び出し側で「読めないなら使わない」と決めるとき。
 * 自動の保存の有料の回数：src/lib/services/seeding.ts）。KV が無い環境ではメモリ層を読む
 */
export async function cacheGetJSONStrict<T>(key: string): Promise<T | null> {
  const { APP_CACHE } = await getBindings();
  if (!APP_CACHE) return (memoryKv.get(key) as T | undefined) ?? null;
  return (await APP_CACHE.get(key, 'json')) as T | null;
}

/** KV が使えるか（無ければ、メモリ層はこのアイソレートの中だけ） */
export async function hasSharedCache(): Promise<boolean> {
  return !!(await getBindings()).APP_CACHE;
}

/** cachePutJSON と同じ保存。KV に書けなかったら例外にする（書けないなら使わない、と決めるとき） */
export async function cachePutJSONStrict(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const { APP_CACHE } = await getBindings();
  memoryKv.set(key, value, APP_CACHE ? Math.min(ttlSeconds * 1000, MEMORY_LAYER_TTL_MS) : ttlSeconds * 1000);
  if (!APP_CACHE) return;
  await APP_CACHE.put(key, JSON.stringify(value), { expirationTtl: Math.max(MIN_KV_TTL_SECONDS, Math.floor(ttlSeconds)) });
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

export type RateLimitBucket = 'ai' | 'search' | 'price' | 'session' | 'shop' | 'shop_session';

/** バインディングが無い環境用のフォールバック上限（1分あたり） */
const FALLBACK_LIMITS: Record<RateLimitBucket, number> = { ai: 20, search: 60, price: 5, session: 10, shop: 20, shop_session: 6 };

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
