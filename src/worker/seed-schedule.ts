import { SEED_PRODUCTS } from '../lib/data/seed-products';

/**
 * 毎日の予定の仕事（wrangler.toml の [triggers]）：src/lib/data/seed-products.ts の製品を1つずつ、
 * POST /api/internal/seed で保存する。
 * - 自分自身への Service binding（SELF）で呼ぶ：製品ごとに別の呼び出しになり、無料プランの CPU 時間（1回 10ms）と
 *   1回の要求の費用の上限（$0.30）を、製品ごとに使える。ネットワークは通らない
 * - 失敗しても次の製品へ進む。結果は件数だけをログに出す（[seed] の行）
 */

export interface SeedEnv {
  SELF?: { fetch: (input: string, init?: RequestInit) => Promise<Response> };
  SEED_SECRET?: string;
}

/** ホスト名は使われない（Service binding）。ログで分かるように本番の名前にしておく */
const SEED_URL = 'https://cosmetantei.app/api/internal/seed';

export async function runSeedSchedule(env: SeedEnv): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const add = (key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };
  const secret = (env.SEED_SECRET || '').trim();
  if (!env.SELF || secret.length < 32) {
    console.warn('[seed] skipped: the SELF service binding or SEED_SECRET (32+ characters) is missing');
    return counts;
  }
  for (let index = 0; index < SEED_PRODUCTS.length; index++) {
    try {
      const res = await env.SELF.fetch(SEED_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-seed-secret': secret },
        body: JSON.stringify({ index }),
      });
      const data = (await res.json().catch(() => null)) as { result?: unknown } | null;
      add(res.ok && typeof data?.result === 'string' ? data.result : `http_${res.status}`);
      // 無料プランの CPU 時間の上限（1102）などで止まった製品が分かるように
      if (!res.ok) console.warn(`[seed] index ${index}: HTTP ${res.status}`);
    } catch (err) {
      add('error');
      console.warn(`[seed] index ${index}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`[seed] ${JSON.stringify(counts)}`);
  return counts;
}
