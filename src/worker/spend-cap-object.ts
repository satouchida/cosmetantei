import { isSpendBucket, isSpendLimits, isSpendPeriod, SpendCounter, SpentTotals } from '../lib/server/spend-cap-core';

/**
 * 有料の呼び出しの上限を数える Durable Object（worker.ts から export する）。
 * アプリは名前 "global" の1つのインスタンスだけを使うので、全世界のリクエストが同じ金額・件数を見る。
 * 1日・1か月の合計金額はストレージに保存し（再起動しても消えない）、直近60秒の件数はメモリに持つ。
 * SpendCounter が依頼を1つずつ処理し、Durable Object の入力ゲートもストレージの読み書きの間の割り込みを防ぐ
 */

interface DurableObjectStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

interface DurableObjectStateLike {
  storage: DurableObjectStorageLike;
}

export class SpendCapObject {
  private counter: SpendCounter;

  constructor(state: DurableObjectStateLike) {
    this.counter = new SpendCounter({
      get: (key) => state.storage.get<SpentTotals>(key),
      put: (key, value) => state.storage.put(key, value),
    });
  }

  /**
   * POST /consume { bucket, limits, costMicros } → SpendDecision
   * POST /settle { deltaMicros, period } → SpentTotals
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
      const { bucket, limits, costMicros } = body;
      if (isSpendBucket(bucket) && isSpendLimits(limits) && Number.isSafeInteger(costMicros) && (costMicros as number) >= 0) {
        run = () => this.counter.consume(bucket, limits, costMicros as number, Date.now());
      }
    } else if (path === '/settle') {
      const { deltaMicros, period } = body;
      if (Number.isSafeInteger(deltaMicros) && isSpendPeriod(period)) {
        run = () => this.counter.settle(deltaMicros as number, period, Date.now());
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
