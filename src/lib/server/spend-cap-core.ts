/**
 * 有料の呼び出しの上限（全体で厳密に数える）の計算部分。Cloudflare に依存しない
 * - Durable Object（src/worker/spend-cap-object.ts）が、全世界で1つのインスタンスでこれを使う
 * - Durable Object が無い環境（next dev・テスト）では、アイソレートごとのメモリ版が使う
 * - 金額はマイクロドル（1 USD = 1,000,000）の整数で数える
 * docs/walkthroughs/2026-10-14-cost-tracking.md の「Strict cap」と「Budget」
 */

export const SPEND_BUCKETS = ['web_search', 'gemini', 'workers_ai'] as const;
export type SpendBucket = (typeof SPEND_BUCKETS)[number];

export interface SpendLimits {
  /** この種類の呼び出しの、直近60秒の件数 */
  perMinute: number;
  /** 全種類の合計金額の、UTC の1日あたりの上限（マイクロドル） */
  dayMicros: number;
  /** 全種類の合計金額の、UTC の1か月あたりの上限（マイクロドル） */
  monthMicros: number;
}

/** 呼び出しを数えた日と月（後で実際の金額に直すときに、同じ日・月の合計だけを直す） */
export interface SpendPeriod {
  day: string;
  month: string;
}

export interface SpendDecision {
  allowed: boolean;
  /** 断った理由 */
  reason?: 'minute' | 'day' | 'month';
  /** この呼び出しを含めた、この種類の直近60秒の件数（断ったときは含めない） */
  minuteCount: number;
  /** この呼び出しを含めた、今日（UTC）の合計金額（断ったときは含めない） */
  dayMicros: number;
  /** この呼び出しを含めた、今月（UTC）の合計金額（断ったときは含めない） */
  monthMicros: number;
  period: SpendPeriod;
}

/** 保存する合計金額 */
export interface SpentTotals {
  day: string;
  dayMicros: number;
  month: string;
  monthMicros: number;
}

/** 合計金額の保存先（Durable Object のストレージ、またはメモリ） */
export interface SpendStore {
  get(key: string): Promise<SpentTotals | undefined>;
  put(key: string, value: SpentTotals): Promise<void>;
}

const MINUTE_MS = 60_000;
const TOTALS_KEY = 'spent';

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function utcMonth(now: number): string {
  return new Date(now).toISOString().slice(0, 7);
}

export function isSpendBucket(v: unknown): v is SpendBucket {
  return typeof v === 'string' && (SPEND_BUCKETS as readonly string[]).includes(v);
}

const isCount = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

export function isSpendLimits(v: unknown): v is SpendLimits {
  const l = v as SpendLimits;
  return !!l && isCount(l.perMinute) && isCount(l.dayMicros) && isCount(l.monthMicros);
}

export function isSpendPeriod(v: unknown): v is SpendPeriod {
  const p = v as SpendPeriod;
  return !!p && typeof p.day === 'string' && typeof p.month === 'string';
}

/**
 * 呼び出しの前に見積もり金額を確保し、上限内なら使う（失敗した呼び出しも数える）。
 * 呼び出しの後で settle により実際の金額に直す。
 * 同じインスタンスへの依頼は自分で1つずつ処理する（読んで足して書く間に、ほかの依頼を割り込ませない）
 */
export class SpendCounter {
  /** 種類ごとの直近60秒の呼び出し時刻。再起動で消えてよい（1分の上限は短い急増を止めるためのもの） */
  private recent = new Map<SpendBucket, number[]>();

  /** 前の依頼の終わり（次の依頼はこの後に始める） */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private store: SpendStore) {}

  consume(bucket: SpendBucket, limits: SpendLimits, costMicros: number, now: number): Promise<SpendDecision> {
    return this.queue(() => this.consumeOne(bucket, limits, costMicros, now));
  }

  /** 確保した金額を実際の金額に直す（deltaMicros = 実際 − 見積もり）。日・月が変わっていればその合計は直さない */
  settle(deltaMicros: number, period: SpendPeriod, now: number): Promise<SpentTotals> {
    return this.queue(() => this.settleOne(deltaMicros, period, now));
  }

  private queue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async totals(now: number): Promise<SpentTotals> {
    const day = utcDay(now);
    const month = utcMonth(now);
    const saved = await this.store.get(TOTALS_KEY);
    return {
      day,
      dayMicros: saved?.day === day ? saved.dayMicros : 0,
      month,
      monthMicros: saved?.month === month ? saved.monthMicros : 0,
    };
  }

  private async consumeOne(bucket: SpendBucket, limits: SpendLimits, costMicros: number, now: number): Promise<SpendDecision> {
    const recent = (this.recent.get(bucket) ?? []).filter((t) => now - t < MINUTE_MS);
    this.recent.set(bucket, recent);
    const t = await this.totals(now);
    const period = { day: t.day, month: t.month };
    const reason =
      recent.length >= limits.perMinute
        ? 'minute'
        : t.dayMicros + costMicros > limits.dayMicros
        ? 'day'
        : t.monthMicros + costMicros > limits.monthMicros
        ? 'month'
        : undefined;
    if (reason) {
      return { allowed: false, reason, minuteCount: recent.length, dayMicros: t.dayMicros, monthMicros: t.monthMicros, period };
    }
    recent.push(now);
    const next = { ...t, dayMicros: t.dayMicros + costMicros, monthMicros: t.monthMicros + costMicros };
    await this.store.put(TOTALS_KEY, next);
    return { allowed: true, minuteCount: recent.length, dayMicros: next.dayMicros, monthMicros: next.monthMicros, period };
  }

  private async settleOne(deltaMicros: number, period: SpendPeriod, now: number): Promise<SpentTotals> {
    const t = await this.totals(now);
    // 確保が取り消された分で合計が負にならないようにする
    const next = {
      ...t,
      dayMicros: t.day === period.day ? Math.max(0, t.dayMicros + deltaMicros) : t.dayMicros,
      monthMicros: t.month === period.month ? Math.max(0, t.monthMicros + deltaMicros) : t.monthMicros,
    };
    await this.store.put(TOTALS_KEY, next);
    return next;
  }
}

/** メモリの保存先（Durable Object が無い環境用） */
export class MemorySpendStore implements SpendStore {
  private data = new Map<string, SpentTotals>();
  async get(key: string) {
    return this.data.get(key);
  }
  async put(key: string, value: SpentTotals) {
    this.data.set(key, value);
  }
}
