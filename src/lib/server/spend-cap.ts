import 'server-only';
import { getBindings } from './cloudflare';
import { MemoryDayCountStore, SpendBucket, SpendCounter, SpendLimits } from './spend-cap-core';

/**
 * 有料の呼び出しの上限（全体で厳密に数える）。Gemini・Workers AI・Web 検索の前に呼ぶ
 * - SPEND_CAP（Durable Object）の "global" インスタンスに数えさせる。全世界のリクエストが同じ件数を見る
 * - 上限は [vars] の SPEND_CAP_WEB_SEARCH・SPEND_CAP_GEMINI・SPEND_CAP_WORKERS_AI（「1分あたり/1日あたり」）。
 *   未設定・形が違うときは DEFAULT_LIMITS
 * - Durable Object に届かない・エラーのときは断る（上限を守れない状態で有料の呼び出しをしない）
 * - バインディングが無い環境（next dev・テスト）は、アイソレートごとのメモリ版。本番でバインディングが無いのは
 *   設定ミスなので断る（メモリ版はアイソレートの数だけ上限が増え、厳密な上限にならない）。
 *   本番ビルドをバインディング無しで動かすとき（next start）は SPEND_CAP_ALLOW_MEMORY=true
 */

export const DEFAULT_LIMITS: Record<SpendBucket, SpendLimits> = {
  web_search: { perMinute: 30, perDay: 1000 },
  gemini: { perMinute: 60, perDay: 3000 },
  workers_ai: { perMinute: 120, perDay: 10000 },
};

const ENV_NAMES: Record<SpendBucket, string> = {
  web_search: 'SPEND_CAP_WEB_SEARCH',
  gemini: 'SPEND_CAP_GEMINI',
  workers_ai: 'SPEND_CAP_WORKERS_AI',
};

const DO_TIMEOUT_MS = 2_000;

/** 「30/1000」の形の設定を読む */
export function spendLimits(bucket: SpendBucket): SpendLimits {
  const raw = (process.env[ENV_NAMES[bucket]] || '').trim();
  const m = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
  return m ? { perMinute: Number(m[1]), perDay: Number(m[2]) } : DEFAULT_LIMITS[bucket];
}

let memoryCounter = new SpendCounter(new MemoryDayCountStore());

/** テスト用：メモリ版の件数を消す（テストは1つのプロセスで多数の呼び出しをするため） */
export function resetSpendCap(): void {
  memoryCounter = new SpendCounter(new MemoryDayCountStore());
}

/** 上限内なら1件分を使って true。上限に達している・数えられないときは false（呼び出さない） */
export async function consumeSpend(bucket: SpendBucket): Promise<boolean> {
  const limits = spendLimits(bucket);
  const { SPEND_CAP } = await getBindings();
  if (!SPEND_CAP) {
    if (process.env.NODE_ENV === 'production' && process.env.SPEND_CAP_ALLOW_MEMORY !== 'true') {
      console.error(`SPEND_CAP Durable Object binding is missing in production; refusing the ${bucket} call.`);
      return false;
    }
    return (await memoryCounter.consume(bucket, limits, Date.now())).allowed;
  }
  try {
    const stub = SPEND_CAP.get(SPEND_CAP.idFromName('global'));
    const res = await stub.fetch('https://spend-cap/consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket, limits }),
      signal: AbortSignal.timeout(DO_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`status ${res.status}`);
    }
    const { allowed } = (await res.json()) as { allowed?: unknown };
    return allowed === true;
  } catch (err) {
    console.error(`Spend cap check failed for ${bucket}; refusing the call:`, err instanceof Error ? err.message : err);
    return false;
  }
}
