/**
 * 毎日の調べ直しの1日（UTC）の件数（オーナーの判断 2026-10-31）。予定の仕事（src/worker/seed-schedule.ts）と
 * サーバー（src/lib/services/seeding.ts の refreshNextProduct）の両方が使うので、ほかを読み込まない小さなファイルに置く。
 * 一覧の上限 300 件なら、期限の前の7日で1日 43 件までになる。調べ直せなかった製品は期限（30日）で捨てられ、
 * 次に検索されたときに調べ直される（古いまま残ることはない）。
 * 一覧を大きくする・期限の近い製品が多い日が続くときは、[verified-refresh] のログの件数と、毎日期限が切れる件数を
 * 比べて、この数を見直す（security-audit/run-1/FIX-PLAN.md の 5）
 */
export const REFRESH_PER_DAY = 20;
