import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';

/**
 * ビルドで作ったページ（トップ・404 など）は、Workers の静的アセットから返す（pnpm deploy が書き込む）。
 * 既定（"dummy"）では、要求のたびに Next.js を読み込んで React で描き直すため、新しいアイソレートへの
 * まとまった要求（ボットの巡回）で無料プランの CPU 時間（10ms）を超えていた（2026-11-01 のログ）。
 * enableCacheInterception: 保存済みのページは Next.js を通さずに返す。
 * 静的アセットのキャッシュは書き換えできない：時間で作り直すページ（revalidate）を足すときは、KV・R2 のキャッシュに替える
 */
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
