import { isSpendBucket, isSpendLimits, SpendCounter } from '../lib/server/spend-cap-core';

/**
 * 有料の呼び出しの上限を数える Durable Object（worker.ts から export する）。
 * アプリは名前 "global" の1つのインスタンスだけを使うので、全世界のリクエストが同じ件数を見る。
 * 1日の件数はストレージに保存し（再起動しても消えない）、直近60秒の件数はメモリに持つ。
 * SpendCounter が呼び出しを1つずつ処理し、Durable Object の入力ゲートもストレージの読み書きの間の割り込みを防ぐ
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
      get: (key) => state.storage.get<{ day: string; count: number }>(key),
      put: (key, value) => state.storage.put(key, value),
    });
  }

  /** POST { bucket, limits } → { allowed, minuteCount, dayCount } */
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response('bad request', { status: 400 });
    }
    const { bucket, limits } = (body ?? {}) as { bucket?: unknown; limits?: unknown };
    if (!isSpendBucket(bucket) || !isSpendLimits(limits)) return new Response('bad request', { status: 400 });
    try {
      const decision = await this.counter.consume(bucket, limits, Date.now());
      return Response.json(decision);
    } catch (err) {
      // 呼び出し側は 500 を「断る」として扱う。原因はここでしか見えないのでログに出す
      console.error('SpendCapObject storage failure:', err);
      return new Response('storage error', { status: 500 });
    }
  }
}
