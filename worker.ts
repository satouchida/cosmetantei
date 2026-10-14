/**
 * Worker のエントリー（wrangler.toml の main）。OpenNext が作る .open-next/worker.js をそのまま使い、
 * アプリの Durable Object（有料の呼び出しの上限）を足して export する。
 * .open-next/worker.js は pnpm build:cloudflare で作られるため、型チェック・lint の対象から外している
 */
// @ts-ignore 生成されるファイル
import handler from './.open-next/worker.js';

export default handler;

// OpenNext の Durable Object（使っていなくても export しておく。OpenNext の custom worker の手順どおり）
// @ts-ignore 生成されるファイル
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from './.open-next/worker.js';

export { SpendCapObject } from './src/worker/spend-cap-object';
