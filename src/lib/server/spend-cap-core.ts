/**
 * 有料の呼び出しの上限（全体で厳密に数える）の計算部分。Cloudflare に依存しない
 * - Durable Object（src/worker/spend-cap-object.ts）が、全世界で1つのインスタンスでこれを使う
 * - Durable Object が無い環境（next dev・テスト）では、アイソレートごとのメモリ版が使う
 * docs/walkthroughs/2026-10-14-cost-tracking.md の「Strict cap」
 */

export const SPEND_BUCKETS = ['web_search', 'gemini', 'workers_ai'] as const;
export type SpendBucket = (typeof SPEND_BUCKETS)[number];

export interface SpendLimits {
  perMinute: number;
  /** UTC の1日あたり */
  perDay: number;
}

export interface SpendDecision {
  allowed: boolean;
  /** この呼び出しを含めた、直近60秒の件数（断ったときは数えない） */
  minuteCount: number;
  /** この呼び出しを含めた、今日（UTC）の件数（断ったときは数えない） */
  dayCount: number;
}

/** 1日の件数の保存先（Durable Object のストレージ、またはメモリ） */
export interface DayCountStore {
  get(key: string): Promise<{ day: string; count: number } | undefined>;
  put(key: string, value: { day: string; count: number }): Promise<void>;
}

const MINUTE_MS = 60_000;

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function isSpendBucket(v: unknown): v is SpendBucket {
  return typeof v === 'string' && (SPEND_BUCKETS as readonly string[]).includes(v);
}

export function isSpendLimits(v: unknown): v is SpendLimits {
  const l = v as SpendLimits;
  return (
    !!l &&
    Number.isSafeInteger(l.perMinute) &&
    Number.isSafeInteger(l.perDay) &&
    l.perMinute >= 0 &&
    l.perDay >= 0
  );
}

/**
 * 件数を数えて、上限内なら1件分を使う。呼び出しの前に使う（失敗した呼び出しも数える）。
 * 同じインスタンスへの呼び出しは自分で1つずつ処理する（読んで足して書く間に、ほかの呼び出しを割り込ませない）
 */
export class SpendCounter {
  /** 直近60秒の呼び出し時刻。再起動で消えてよい（1分の上限は短い急増を止めるためのもの） */
  private recent = new Map<SpendBucket, number[]>();

  /** 前の呼び出しの終わり（次の呼び出しはこの後に始める） */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private store: DayCountStore) {}

  consume(bucket: SpendBucket, limits: SpendLimits, now: number): Promise<SpendDecision> {
    const run = this.tail.then(() => this.consumeOne(bucket, limits, now));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async consumeOne(bucket: SpendBucket, limits: SpendLimits, now: number): Promise<SpendDecision> {
    const recent = (this.recent.get(bucket) ?? []).filter((t) => now - t < MINUTE_MS);
    this.recent.set(bucket, recent);
    const day = utcDay(now);
    const saved = await this.store.get(bucket);
    const dayCount = saved && saved.day === day ? saved.count : 0;

    if (recent.length >= limits.perMinute || dayCount >= limits.perDay) {
      return { allowed: false, minuteCount: recent.length, dayCount };
    }
    recent.push(now);
    await this.store.put(bucket, { day, count: dayCount + 1 });
    return { allowed: true, minuteCount: recent.length, dayCount: dayCount + 1 };
  }
}

/** メモリの保存先（Durable Object が無い環境用） */
export class MemoryDayCountStore implements DayCountStore {
  private data = new Map<string, { day: string; count: number }>();
  async get(key: string) {
    return this.data.get(key);
  }
  async put(key: string, value: { day: string; count: number }) {
    this.data.set(key, value);
  }
}
