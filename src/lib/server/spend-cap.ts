import 'server-only';
import { getBindings } from './cloudflare';
import { MemorySpendStore, SpendBucket, SpendCounter, SpendLimits, SpendPeriod } from './spend-cap-core';

/**
 * 有料の呼び出しの上限（全体で厳密に数える）。Gemini・Workers AI・Web 検索の前に reserveSpend、後に settleSpend
 * - SPEND_CAP（Durable Object）の "global" インスタンスに数えさせる。全世界のリクエストが同じ金額・件数を見る
 * - 予算は [vars] の SPEND_BUDGET_USD（「1日あたり/1か月あたり」の USD、UTC）。全種類の合計金額で数える。
 *   呼び出しの前に見積もり金額（src/lib/server/prices.ts の単価）を確保し、予算を超えるなら呼ばない。
 *   後で実際の金額（Gemini は usageMetadata のトークン数）に直す
 * - 急増を止める1分あたりの件数は SPEND_PER_MINUTE_WEB_SEARCH・_GEMINI・_WORKERS_AI
 * - 未設定・形が違うときは DEFAULT_BUDGET_USD・DEFAULT_PER_MINUTE
 * - Durable Object に届かない・エラーのときは断る（上限を守れない状態で有料の呼び出しをしない）
 * - バインディングが無い環境（next dev・テスト）は、アイソレートごとのメモリ版。本番でバインディングが無いのは
 *   設定ミスなので断る（メモリ版はアイソレートの数だけ上限が増え、厳密な上限にならない）。
 *   本番ビルドをバインディング無しで動かすとき（next start）は SPEND_CAP_ALLOW_MEMORY=true
 */

export const DEFAULT_BUDGET_USD = { perDay: 30, perMonth: 100 };

export const DEFAULT_PER_MINUTE: Record<SpendBucket, number> = {
  web_search: 30,
  gemini: 60,
  workers_ai: 120,
};

const PER_MINUTE_ENV: Record<SpendBucket, string> = {
  web_search: 'SPEND_PER_MINUTE_WEB_SEARCH',
  gemini: 'SPEND_PER_MINUTE_GEMINI',
  workers_ai: 'SPEND_PER_MINUTE_WORKERS_AI',
};

const DO_TIMEOUT_MS = 2_000;

const usdToMicros = (usd: number): number => Math.round(usd * 1_000_000);

/** 「30/100」（USD）と「60」の形の設定を読む */
export function spendLimits(bucket: SpendBucket): SpendLimits {
  const budget = (process.env.SPEND_BUDGET_USD || '').trim().match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  const perDay = budget ? Number(budget[1]) : DEFAULT_BUDGET_USD.perDay;
  const perMonth = budget ? Number(budget[2]) : DEFAULT_BUDGET_USD.perMonth;
  const rate = (process.env[PER_MINUTE_ENV[bucket]] || '').trim();
  return {
    perMinute: /^\d+$/.test(rate) ? Number(rate) : DEFAULT_PER_MINUTE[bucket],
    dayMicros: usdToMicros(perDay),
    monthMicros: usdToMicros(perMonth),
  };
}

/** 確保した金額（settleSpend に渡す） */
export interface SpendTicket {
  costMicros: number;
  period: SpendPeriod;
}

let memoryCounter = new SpendCounter(new MemorySpendStore());

/** テスト用：メモリ版の金額・件数を消す（テストは1つのプロセスで多数の呼び出しをするため） */
export function resetSpendCap(): void {
  memoryCounter = new SpendCounter(new MemorySpendStore());
}

type CapTarget = { kind: 'memory' } | { kind: 'object'; fetch: (path: string, body: unknown) => Promise<unknown> } | null;

async function capTarget(what: string): Promise<CapTarget> {
  const { SPEND_CAP } = await getBindings();
  if (!SPEND_CAP) {
    if (process.env.NODE_ENV === 'production' && process.env.SPEND_CAP_ALLOW_MEMORY !== 'true') {
      console.error(`SPEND_CAP Durable Object binding is missing in production; refusing the ${what}.`);
      return null;
    }
    return { kind: 'memory' };
  }
  const stub = SPEND_CAP.get(SPEND_CAP.idFromName('global'));
  return {
    kind: 'object',
    async fetch(path, body) {
      const res = await stub.fetch(`https://spend-cap${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(DO_TIMEOUT_MS),
      });
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`status ${res.status}`);
      }
      return res.json();
    },
  };
}

/**
 * 見積もり金額を確保する。予算・1分の件数の上限内なら SpendTicket、上限に達している・数えられないときは null（呼び出さない）
 */
export async function reserveSpend(bucket: SpendBucket, costMicros: number): Promise<SpendTicket | null> {
  const limits = spendLimits(bucket);
  if (!Number.isFinite(costMicros)) {
    console.error(`Spend estimate for ${bucket} is not a number; refusing the call.`);
    return null;
  }
  const cost = Math.max(0, Math.ceil(costMicros));
  try {
    const target = await capTarget(`${bucket} call`);
    if (!target) return null;
    const decision =
      target.kind === 'memory'
        ? await memoryCounter.consume(bucket, limits, cost, Date.now())
        : ((await target.fetch('/consume', { bucket, limits, costMicros: cost })) as { allowed?: unknown; period?: SpendPeriod });
    return decision.allowed === true && decision.period ? { costMicros: cost, period: decision.period } : null;
  } catch (err) {
    console.error(`Spend cap check failed for ${bucket}; refusing the call:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * 確保した金額を実際の金額に直す。失敗してもログだけ（確保した見積もりがそのまま残る）。
 * 実際の金額が見積もりより大きいとき、その差の分だけ予算を超えることがある（次の呼び出しから断る）
 */
export async function settleSpend(ticket: SpendTicket, actualMicros: number): Promise<void> {
  if (!Number.isFinite(actualMicros)) return;
  const deltaMicros = Math.max(0, Math.ceil(actualMicros)) - ticket.costMicros;
  if (deltaMicros === 0) return;
  // 見積もりは高めにしてある。超えたら前提（URL のページのトークン数など）を見直す
  if (deltaMicros > 0) console.warn(`Spend estimate was low by ${deltaMicros} micro-USD; check the estimate assumptions.`);
  try {
    const target = await capTarget('settlement');
    if (!target) return;
    if (target.kind === 'memory') await memoryCounter.settle(deltaMicros, ticket.period, Date.now());
    else await target.fetch('/settle', { deltaMicros, period: ticket.period });
  } catch (err) {
    console.error('Spend settlement failed:', err instanceof Error ? err.message : err);
  }
}
