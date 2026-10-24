import 'server-only';
import { getBindings } from './cloudflare';
import { adjustRequestSpend, BudgetClientKind, currentClients, markRefused, takeRequestSpend } from './usage';
import { ClientLimit, MemorySpendStore, SpendBucket, SpendCounter, SpendLimits, SpendPeriod } from './spend-cap-core';

/**
 * 有料の呼び出しの上限（全体で厳密に数える）。Gemini・Workers AI・Web 検索の前に reserveSpend、後に settleSpend
 * - SPEND_CAP（Durable Object）の "global" インスタンスに数えさせる。全世界のリクエストが同じ金額・件数を見る
 * - 予算は [vars] の SPEND_BUDGET_USD（「1日あたり/1か月あたり」の USD、UTC）。全種類の合計金額で数える。
 *   呼び出しの前に見積もり金額（src/lib/server/prices.ts の単価）を確保し、予算を超えるなら呼ばない。
 *   後で実際の金額（Gemini は usageMetadata のトークン数）に直す
 * - 急増を止める1分あたりの件数は SPEND_PER_MINUTE_WEB_SEARCH・_GEMINI・_WORKERS_AI
 * - 利用者ごとにも、1日あたりの合計金額に上限を付ける。ログインの無いアプリなので、1人や少数の利用者が
 *   全員の予算を使い切り、ほかの利用者が AI を使えなくなるのを防ぐ。どれか1つでも超えれば断る
 *   - IP（IPv6 は /48）と、Turnstile で確かめたブラウザのセッション: SPEND_PER_CLIENT_USD（既定 $0.50）
 *   - 発行から SPEND_NEW_SESSION_MINUTES（既定 30 分。src/lib/server/session.ts）までのセッション:
 *     SPEND_PER_NEW_SESSION_USD（既定 $0.30。SPEND_PER_CLIENT_USD より大きくはしない）。
 *     Turnstile を解く業者で新しいセッションを次々に作っても、1つあたりで使える額を小さくする
 *     （同じセッションの合計なので、時間がたてば $0.50 まで使える。製品を Web で調べる1回は使える額にしておく）
 *   - IPv4 の /24（隣り合う 256 個のアドレス）: SPEND_PER_NETWORK_USD（既定 $2）
 *   - クラウドの事業者（src/lib/server/hosting-networks.ts。借りたサーバーの IP を並べた呼び出し）:
 *     事業者ごとに SPEND_PER_HOSTING_NETWORK_USD（既定 $1）
 *   - 今日の全体の合計が予算の SPEND_TIGHTEN_AFTER_SHARE（既定 0.5）に達したら、どの上限も
 *     SPEND_TIGHTENED_PERCENT（既定 30）% に下げる（多くの IP を使われても、残りを多くの利用者で分ける）
 *   （利用者は API ルートの apiRoute が付ける。ルートの外の呼び出しには使わない）
 * - 急がない仕事（background。成分の評価・翻訳）は、その1分の件数が上限 × SPEND_BACKGROUND_SHARE（既定 0.5）に
 *   達していたら断る。数えるのは同じ件数なので、全体の上限は変わらず、残りは利用者が待っている呼び出しが使える
 * - 未設定・形が違うときは DEFAULT_BUDGET_USD・DEFAULT_PER_MINUTE
 * - Durable Object に届かない・エラーのときは断る（上限を守れない状態で有料の呼び出しをしない）
 * - バインディングが無い環境（next dev・テスト）は、アイソレートごとのメモリ版。本番でバインディングが無いのは
 *   設定ミスなので断る（メモリ版はアイソレートの数だけ上限が増え、厳密な上限にならない）。
 *   本番ビルドをバインディング無しで動かすとき（next start）は SPEND_CAP_ALLOW_MEMORY=true
 */

export const DEFAULT_BUDGET_USD = { perDay: 10, perMonth: 100 };

/** 利用者（IP。IPv6 は /48）ごとの1日あたりの上限（USD）。SPEND_PER_CLIENT_USD が無い・形が違うとき */
export const DEFAULT_PER_CLIENT_USD = 0.5;

/** 利用者の種類ごとの1日あたりの上限（USD）。設定が無い・形が違うとき */
export const DEFAULT_CLIENT_BUDGET_USD: Record<BudgetClientKind, number> = {
  ip: DEFAULT_PER_CLIENT_USD,
  session: DEFAULT_PER_CLIENT_USD,
  new_session: 0.3,
  network: 2,
  hosting: 1,
};

const CLIENT_BUDGET_ENV: Record<BudgetClientKind, string> = {
  ip: 'SPEND_PER_CLIENT_USD',
  session: 'SPEND_PER_CLIENT_USD',
  new_session: 'SPEND_PER_NEW_SESSION_USD',
  network: 'SPEND_PER_NETWORK_USD',
  hosting: 'SPEND_PER_HOSTING_NETWORK_USD',
};

/** 利用者ごとの上限を下げ始める、全体の1日の予算の割合と、下げた後の割合（%） */
export const DEFAULT_TIGHTEN = { afterShare: 0.5, percent: 30 };

export const DEFAULT_PER_MINUTE: Record<SpendBucket, number> = {
  web_search: 30,
  gemini: 60,
  workers_ai: 120,
  // 楽天・Yahoo! の API は、アプリ ID ごとに1秒に1回まで。全体で1分あたり 50 回にして余裕をもたせる
  rakuten_api: 50,
  yahoo_api: 50,
  // Open Beauty Facts の検索 API は1分に10回まで（OBF の利用の決まり）。全員で数え、超えたら保存済みの製品だけで答える
  open_beauty_facts: 10,
};

const PER_MINUTE_ENV: Record<SpendBucket, string> = {
  web_search: 'SPEND_PER_MINUTE_WEB_SEARCH',
  gemini: 'SPEND_PER_MINUTE_GEMINI',
  workers_ai: 'SPEND_PER_MINUTE_WORKERS_AI',
  rakuten_api: 'SPEND_PER_MINUTE_RAKUTEN_API',
  yahoo_api: 'SPEND_PER_MINUTE_YAHOO_API',
  open_beauty_facts: 'SPEND_PER_MINUTE_OPEN_BEAUTY_FACTS',
};

/** 急がない仕事が使える、1分あたりの上限の割合（SPEND_BACKGROUND_SHARE が無い・形が違うとき） */
export const DEFAULT_BACKGROUND_SHARE = 0.5;

/** 0〜1 の割合の設定。無い・形が違えば fallback */
function readShare(name: string, fallback: number): number {
  const raw = (process.env[name] || '').trim();
  return /^(0(\.\d+)?|1(\.0+)?)$/.test(raw) ? Number(raw) : fallback;
}

/** 急がない仕事が使える割合（0〜1） */
export function backgroundShare(): number {
  return readShare('SPEND_BACKGROUND_SHARE', DEFAULT_BACKGROUND_SHARE);
}

/** 利用者の種類ごとの1日あたりの上限（マイクロドル） */
export function clientBudgetMicros(kind: BudgetClientKind): number {
  const raw = (process.env[CLIENT_BUDGET_ENV[kind]] || '').trim();
  const micros = usdToMicros(/^\d+(\.\d+)?$/.test(raw) ? Number(raw) : DEFAULT_CLIENT_BUDGET_USD[kind]);
  // 新しいセッションの上限は、古いセッションの上限を超えない（SPEND_PER_CLIENT_USD を下げたときも）
  return kind === 'new_session' ? Math.min(micros, clientBudgetMicros('session')) : micros;
}

const DO_TIMEOUT_MS = 2_000;

const usdToMicros = (usd: number): number => Math.round(usd * 1_000_000);

/** 「30/100」（USD）と「60」の形の設定を読む */
export function spendLimits(bucket: SpendBucket): SpendLimits {
  const budget = (process.env.SPEND_BUDGET_USD || '').trim().match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  const perDay = budget ? Number(budget[1]) : DEFAULT_BUDGET_USD.perDay;
  const perMonth = budget ? Number(budget[2]) : DEFAULT_BUDGET_USD.perMonth;
  const rate = (process.env[PER_MINUTE_ENV[bucket]] || '').trim();
  const percent = (process.env.SPEND_TIGHTENED_PERCENT || '').trim();
  return {
    perMinute: /^\d+$/.test(rate) ? Number(rate) : DEFAULT_PER_MINUTE[bucket],
    dayMicros: usdToMicros(perDay),
    monthMicros: usdToMicros(perMonth),
    tightenAfterMicros: usdToMicros(perDay * readShare('SPEND_TIGHTEN_AFTER_SHARE', DEFAULT_TIGHTEN.afterShare)),
    tightenedPercent: /^(\d{1,2}|100)$/.test(percent) ? Number(percent) : DEFAULT_TIGHTEN.percent,
  };
}

/** 確保した金額（settleSpend に渡す） */
export interface SpendTicket {
  costMicros: number;
  period: SpendPeriod;
  /** 利用者ごとの予算のキー（利用者ごとの合計も直す） */
  clients: string[];
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
export async function reserveSpend(
  bucket: SpendBucket,
  costMicros: number,
  { background = false }: { background?: boolean } = {}
): Promise<SpendTicket | null> {
  const full = spendLimits(bucket);
  // 急がない仕事は、1分の件数（全員の呼び出しを数えた同じ件数）を小さい上限と比べる。
  // 割合が 0 なら急がない仕事はしない。0 より大きければ、切り捨てても1分に1回は使える
  const share = backgroundShare();
  const backgroundPerMinute = share > 0 && full.perMinute > 0 ? Math.max(1, Math.floor(full.perMinute * share)) : 0;
  const limits = background ? { ...full, perMinute: backgroundPerMinute } : full;
  if (!Number.isFinite(costMicros)) {
    console.error(`Spend estimate for ${bucket} is not a number; refusing the call.`);
    return null;
  }
  const cost = Math.max(0, Math.ceil(costMicros));
  // 1回の要求の見積もりの合計・時間の上限（無料のお店の API は数えない）
  if (cost > 0 && !takeRequestSpend(cost)) {
    markRefused();
    console.warn(`${bucket} call skipped: per-request spend or time limit reached`);
    return null;
  }
  try {
    const target = await capTarget(`${bucket} call`);
    if (!target) {
      markRefused();
      adjustRequestSpend(-cost);
      return null;
    }
    const clients: ClientLimit[] = currentClients().map((c) => ({ key: c.key, dayMicros: clientBudgetMicros(c.kind) }));
    const decision =
      target.kind === 'memory'
        ? await memoryCounter.consume(bucket, limits, cost, Date.now(), clients)
        : ((await target.fetch('/consume', { bucket, limits, costMicros: cost, clients })) as {
            allowed?: unknown;
            period?: SpendPeriod;
            reason?: unknown;
          });
    // 断られた呼び出しの失敗を、全員の分の「失敗した検索」として覚えさせない。この要求の見積もりの合計からも外す
    if (decision.allowed !== true) {
      markRefused();
      adjustRequestSpend(-cost);
    }
    return decision.allowed === true && decision.period
      ? { costMicros: cost, period: decision.period, clients: clients.map((c) => c.key) }
      : null;
  } catch (err) {
    markRefused();
    adjustRequestSpend(-cost);
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
  // この要求の合計も実際の金額にする（1回の要求の上限を、見積もりではなく使った金額で数える）
  adjustRequestSpend(deltaMicros);
  if (deltaMicros === 0) return;
  // 見積もりは高めにしてある。超えたら前提（URL のページのトークン数など）を見直す
  if (deltaMicros > 0) console.warn(`Spend estimate was low by ${deltaMicros} micro-USD; check the estimate assumptions.`);
  try {
    const target = await capTarget('settlement');
    if (!target) return;
    if (target.kind === 'memory') await memoryCounter.settle(deltaMicros, ticket.period, Date.now(), ticket.clients);
    else await target.fetch('/settle', { deltaMicros, period: ticket.period, clients: ticket.clients });
  } catch (err) {
    console.error('Spend settlement failed:', err instanceof Error ? err.message : err);
  }
}
