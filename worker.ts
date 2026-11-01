/**
 * Worker のエントリー（wrangler.toml の main）。OpenNext が作る .open-next/worker.js をそのまま使い、
 * アプリの Durable Object（有料の呼び出しの上限）を足して export する。
 * .open-next/worker.js は pnpm build:cloudflare で作られるため、型チェック・lint の対象から外している
 */
// @ts-ignore 生成されるファイル
import handler from './.open-next/worker.js';
import { REFRESH_CRON, runRefreshSchedule, runSeedSchedule, SeedEnv } from './src/worker/seed-schedule';

/**
 * 要求は OpenNext のまま。予定の仕事（wrangler.toml の [triggers]、毎日 03:00 JST）では、よく調べられる製品を
 * 保存しておく。03:30 JST には、期限の近い保存した製品を調べ直す（src/worker/seed-schedule.ts）
 */
export default {
  // handler のメソッドとして呼ぶ（this を保つ）
  fetch(request: Request, env: unknown, ctx: unknown) {
    return handler.fetch(request, env, ctx);
  },
  async scheduled(controller: { cron?: string }, env: SeedEnv, ctx: { waitUntil: (promise: Promise<unknown>) => void }) {
    // 03:30 JST は保存した製品の調べ直し、それ以外（03:00 JST）は自動の保存
    ctx.waitUntil(controller.cron === REFRESH_CRON ? runRefreshSchedule(env) : runSeedSchedule(env));
  },
};

// OpenNext の Durable Object（使っていなくても export しておく。OpenNext の custom worker の手順どおり）
// @ts-ignore 生成されるファイル
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from './.open-next/worker.js';

export { SpendCapObject } from './src/worker/spend-cap-object';
