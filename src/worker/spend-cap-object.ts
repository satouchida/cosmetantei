import { isClientKeys, isClientLimits, isSpendBucket, isSpendLimits, isSpendPeriod, SpendCounter, SpentTotals } from '../lib/server/spend-cap-core';

/**
 * 有料の呼び出しの上限を数える Durable Object（worker.ts から export する）。
 * アプリは名前 "global" の1つのインスタンスだけを使うので、全世界のリクエストが同じ金額・件数を見る。
 * 1日・1か月の合計金額はストレージに保存し（再起動しても消えない）、直近60秒の件数はメモリに持つ。
 * SpendCounter が依頼を1つずつ処理し、Durable Object の入力ゲートもストレージの読み書きの間の割り込みを防ぐ
 */

interface DurableObjectStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  list<T>(options: { prefix: string; limit: number }): Promise<Map<string, T>>;
  delete(keys: string[]): Promise<number>;
}

/** 前の日の利用者の合計を、1回に消す数（Durable Object の delete は1回 128 キーまで） */
const CLEANUP_BATCH = 128;

interface DurableObjectStateLike {
  storage: DurableObjectStorageLike;
}

export class SpendCapObject {
  private counter: SpendCounter;

  constructor(state: DurableObjectStateLike) {
    const storage = state.storage;
    this.counter = new SpendCounter({
      get: (key) => storage.get<SpentTotals>(key),
      put: (key, value) => storage.put(key, value),
      getClient: (key) => storage.get<number>(key),
      putClient: (key, micros) => storage.put(key, micros),
      // 前の日の分を少しずつ消す（1回の呼び出しを長く止めない）。消し残しがあれば true
      async deleteOldClients(keepPrefix) {
        const listed = await storage.list<number>({ prefix: 'client:', limit: CLEANUP_BATCH * 2 });
        const old = [...listed.keys()].filter((key) => !key.startsWith(keepPrefix)).slice(0, CLEANUP_BATCH);
        if (old.length > 0) await storage.delete(old);
        return old.length === CLEANUP_BATCH;
      },
    });
  }

  /**
   * POST /consume { bucket, limits, costMicros, clients? } → SpendDecision
   * POST /settle { deltaMicros, period, clients? } → SpentTotals
   * clients は利用者ごとの1日の上限（consume は { key, dayMicros } の一覧、settle はキーの一覧。IP・/24・
   * クラウドの事業者・確認済みのセッション）。有料の呼び出しは、そのどれも超えないときだけ使う
   */
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const path = new URL(request.url).pathname;
    let body: Record<string, unknown>;
    try {
      body = ((await request.json()) ?? {}) as Record<string, unknown>;
    } catch {
      return new Response('bad request', { status: 400 });
    }
    let run: (() => Promise<unknown>) | undefined;
    if (path === '/consume') {
      const { bucket, limits, costMicros, clients } = body;
      if (
        isSpendBucket(bucket) &&
        isSpendLimits(limits) &&
        Number.isSafeInteger(costMicros) &&
        (costMicros as number) >= 0 &&
        (clients === undefined || isClientLimits(clients))
      ) {
        run = () => this.counter.consume(bucket, limits, costMicros as number, Date.now(), clients);
      }
    } else if (path === '/settle') {
      const { deltaMicros, period, clients } = body;
      if (Number.isSafeInteger(deltaMicros) && isSpendPeriod(period) && (clients === undefined || isClientKeys(clients))) {
        run = () => this.counter.settle(deltaMicros as number, period, Date.now(), clients);
      }
    }
    if (!run) return new Response('bad request', { status: 400 });
    try {
      return Response.json(await run());
    } catch (err) {
      // 呼び出し側は 500 を「断る」として扱う。原因はここでしか見えないのでログに出す
      console.error('SpendCapObject storage failure:', err);
      return new Response('storage error', { status: 500 });
    }
  }
}
