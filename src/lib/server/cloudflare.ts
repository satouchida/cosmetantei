import 'server-only';

/**
 * Cloudflare バインディング（KV・Rate Limiting）へのアクセスヘルパー
 * - Workers 上では wrangler.toml のバインディングを使う
 * - next dev / テスト環境などバインディングが無い場合は、上限つきインメモリ実装にフォールバックする
 */

interface KVNamespaceLike {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface RateLimiterLike {
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

export interface AppBindings {
  AI?: WorkersAiLike;
  APP_CACHE?: KVNamespaceLike;
  AI_RATE_LIMITER?: RateLimiterLike;
  SEARCH_RATE_LIMITER?: RateLimiterLike;
  /** 価格の検索（楽天・Yahoo! の API を何回か呼ぶ。API の回数の決まりがあるので、ほかの操作より少なくする） */
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
