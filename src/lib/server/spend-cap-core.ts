/**
 * 有料の呼び出しの上限（全体で厳密に数える）の計算部分。Cloudflare に依存しない
 * - Durable Object（src/worker/spend-cap-object.ts）が、全世界で1つのインスタンスでこれを使う
 * - Durable Object が無い環境（next dev・テスト）では、アイソレートごとのメモリ版が使う
 * - 金額はマイクロドル（1 USD = 1,000,000）の整数で数える
 * docs/walkthroughs/2026-10-14-cost-tracking.md の「Strict cap」と「Budget」
 */

// rakuten_api・yahoo_api はお店の API（無料）。金額は 0 で、1分あたりの件数だけを全体で数える（1秒に1回までの規約）
export const SPEND_BUCKETS = ['web_search', 'gemini', 'workers_ai', 'rakuten_api', 'yahoo_api', 'open_beauty_facts'] as const;
export type SpendBucket = (typeof SPEND_BUCKETS)[number];

export interface SpendLimits {
  /** この種類の呼び出しの、直近60秒の件数 */
  perMinute: number;
  /** 全種類の合計金額の、UTC の1日あたりの上限（マイクロドル） */
  dayMicros: number;
  /** 全種類の合計金額の、UTC の1か月あたりの上限（マイクロドル） */
  monthMicros: number;
  /**
   * 今日の全体の合計がこの金額に達したら、利用者ごとの上限を tightenedPercent % に下げる（多くの IP を使う利用者が
   * 予算を使い切っても、残りを多くの利用者で分けられるように）。無ければ下げない
   */
  tightenAfterMicros?: number;
  /** 下げた後の、利用者ごとの上限の割合（0〜100） */
  tightenedPercent?: number;
}

/**
 * 利用者ごとの1日の上限（全種類の合計金額、UTC）。1回の呼び出しに複数付けられ、どれか1つでも超えれば断る
 * （IP・IPv4 の /24・クラウドの事業者・確認済みのセッション。src/lib/server/spend-cap.ts）
 */
export interface ClientLimit {
  key: string;
  dayMicros: number;
}

/** 1回の呼び出しに付けられる利用者の上限の数 */
export const MAX_CLIENT_LIMITS = 4;

/** 呼び出しを数えた日と月（後で実際の金額に直すときに、同じ日・月の合計だけを直す） */
export interface SpendPeriod {
  day: string;
  month: string;
}

export interface SpendDecision {
  allowed: boolean;
  /** 断った理由（client: 利用者ごとの1日の上限のどれか） */
  reason?: 'minute' | 'day' | 'month' | 'client';
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
  /** 利用者ごとのその日の合計金額（キーは clientKey()）。無ければ undefined */
  getClient(key: string): Promise<number | undefined>;
  putClient(key: string, micros: number): Promise<void>;
  /** 利用者ごとの合計のうち、keepPrefix で始まらない（前の日の）ものを消す。消し残しがあれば true */
  deleteOldClients(keepPrefix: string): Promise<boolean>;
}

/** 利用者ごとの合計のキー（日ごとに分け、前の日の分はまとめて消す） */
export function clientKey(day: string, client: string): string {
  return `client:${day}:${client}`;
}

const MINUTE_MS = 60_000;
const TOTALS_KEY = 'spent';
/** メモリに写しを持つ利用者の数（超えたら最後に使ったのが古い利用者から忘れる。ストレージには残る） */
const MAX_TRACKED_CLIENTS = 20_000;
/** 利用者のキーの長さの上限（「ip:」と IPv6 の /48 など） */
const MAX_CLIENT_KEY_LENGTH = 64;

export function isClientKey(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_CLIENT_KEY_LENGTH;
}

/** 利用者の上限の一覧（数が上限以内で、キーが重ならない） */
export function isClientLimits(v: unknown): v is ClientLimit[] {
  return (
    Array.isArray(v) &&
    v.length <= MAX_CLIENT_LIMITS &&
    v.every((c) => !!c && isClientKey(c.key) && isCount(c.dayMicros)) &&
    new Set(v.map((c) => c.key)).size === v.length
  );
}

/** 精算で直す利用者のキーの一覧 */
export function isClientKeys(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= MAX_CLIENT_LIMITS && v.every(isClientKey) && new Set(v).size === v.length;
}

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
  return (
    !!l &&
    isCount(l.perMinute) &&
    isCount(l.dayMicros) &&
    isCount(l.monthMicros) &&
    (l.tightenAfterMicros === undefined || isCount(l.tightenAfterMicros)) &&
    (l.tightenedPercent === undefined || (isCount(l.tightenedPercent) && l.tightenedPercent <= 100))
  );
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

  /**
   * 利用者ごとの今日（UTC）の合計金額の写し（キーは clientKey()）。もとはストレージにあり、使われていない間に
   * Durable Object が止まって写しが消えても、ゆっくり呼び出す利用者の合計がゼロに戻らない
   */
  private clients = new Map<string, number>();
  /** 前の日の利用者の合計を消し終えた日 */
  private cleanedDay = '';

  /** 前の依頼の終わり（次の依頼はこの後に始める） */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private store: SpendStore) {}

  consume(
    bucket: SpendBucket,
    limits: SpendLimits,
    costMicros: number,
    now: number,
    clients: ClientLimit[] = []
  ): Promise<SpendDecision> {
    return this.queue(() => this.consumeOne(bucket, limits, costMicros, now, clients));
  }

  /** 確保した金額を実際の金額に直す（deltaMicros = 実際 − 見積もり）。日・月が変わっていればその合計は直さない */
  settle(deltaMicros: number, period: SpendPeriod, now: number, clients: string[] = []): Promise<SpentTotals> {
    return this.queue(() => this.settleOne(deltaMicros, period, now, clients));
  }

  /** 利用者のその日の合計金額（写し → ストレージ） */
  private async clientMicros(client: string, day: string): Promise<number> {
    const key = clientKey(day, client);
    const cached = this.clients.get(key);
    if (cached !== undefined) return cached;
    const stored = (await this.store.getClient(key)) ?? 0;
    this.remember(key, stored);
    return stored;
  }

  private async setClientMicros(client: string, day: string, micros: number): Promise<void> {
    const key = clientKey(day, client);
    const value = Math.max(0, micros);
    this.remember(key, value);
    await this.store.putClient(key, value);
  }

  /** 写しに入れる（Map の順番を「最後に使った順」にし、多すぎれば古いものから忘れる。ストレージには残る） */
  private remember(key: string, micros: number): void {
    this.clients.delete(key);
    this.clients.set(key, micros);
    while (this.clients.size > MAX_TRACKED_CLIENTS) {
      const oldest = this.clients.keys().next().value;
      if (oldest === undefined) break;
      this.clients.delete(oldest);
    }
  }

  /** 日が変わったら、前の日の利用者の合計を消す（ストレージに IP ごとのキーを溜めない） */
  private async cleanOldClients(day: string): Promise<void> {
    if (this.cleanedDay === day) return;
    const prefix = clientKey(day, '');
    for (const key of this.clients.keys()) if (!key.startsWith(prefix)) this.clients.delete(key);
    // 一度に消しきれなければ、次の呼び出しで続きを消す
    if (!(await this.store.deleteOldClients(prefix))) this.cleanedDay = day;
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

  private async consumeOne(
    bucket: SpendBucket,
    limits: SpendLimits,
    costMicros: number,
    now: number,
    clients: ClientLimit[]
  ): Promise<SpendDecision> {
    const recent = (this.recent.get(bucket) ?? []).filter((t) => now - t < MINUTE_MS);
    this.recent.set(bucket, recent);
    const t = await this.totals(now);
    const period = { day: t.day, month: t.month };
    // 金額 0 の呼び出し（お店の API）は件数だけを数え、予算には関係させない
    const paid = costMicros > 0;
    // 利用者ごとの1日の上限（1人で全員の予算を使い切れないように）
    const charged = paid ? clients : [];
    if (charged.length > 0) await this.cleanOldClients(t.day);
    const used: number[] = [];
    for (const c of charged) used.push(await this.clientMicros(c.key, t.day));
    // 全体の合計が多くなったら、利用者ごとの上限を下げる
    const tightened = limits.tightenAfterMicros !== undefined && t.dayMicros >= limits.tightenAfterMicros;
    const clientLimit = (c: ClientLimit) =>
      tightened ? Math.floor((c.dayMicros * (limits.tightenedPercent ?? 100)) / 100) : c.dayMicros;
    const reason =
      recent.length >= limits.perMinute
        ? 'minute'
        : paid && t.dayMicros + costMicros > limits.dayMicros
        ? 'day'
        : paid && t.monthMicros + costMicros > limits.monthMicros
        ? 'month'
        : charged.some((c, i) => used[i] + costMicros > clientLimit(c))
        ? 'client'
        : undefined;
    if (reason) {
      return { allowed: false, reason, minuteCount: recent.length, dayMicros: t.dayMicros, monthMicros: t.monthMicros, period };
    }
    recent.push(now);
    for (const [i, c] of charged.entries()) await this.setClientMicros(c.key, t.day, used[i] + costMicros);
    const next = { ...t, dayMicros: t.dayMicros + costMicros, monthMicros: t.monthMicros + costMicros };
    // 金額が変わらなければ書き込まない
    if (paid) await this.store.put(TOTALS_KEY, next);
    return { allowed: true, minuteCount: recent.length, dayMicros: next.dayMicros, monthMicros: next.monthMicros, period };
  }

  private async settleOne(deltaMicros: number, period: SpendPeriod, now: number, clients: string[]): Promise<SpentTotals> {
    const t = await this.totals(now);
    if (t.day === period.day) {
      for (const client of clients) await this.setClientMicros(client, t.day, (await this.clientMicros(client, t.day)) + deltaMicros);
    }
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
  private clients = new Map<string, number>();
  async get(key: string) {
    return this.data.get(key);
  }
  async put(key: string, value: SpentTotals) {
    this.data.set(key, value);
  }
  async getClient(key: string) {
    return this.clients.get(key);
  }
  async putClient(key: string, micros: number) {
    this.clients.set(key, micros);
  }
  async deleteOldClients(keepPrefix: string) {
    for (const key of this.clients.keys()) if (!key.startsWith(keepPrefix)) this.clients.delete(key);
    return false;
  }
}
