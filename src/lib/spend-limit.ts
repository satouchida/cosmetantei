/**
 * 有料の呼び出しが上限で断られたことを、画面に伝える（サーバーとブラウザの両方で使う）。
 * - サーバー：API ルートが、その要求で断られた上限の種類を応答のヘッダーに付ける（src/lib/server/api-route.ts）
 * - ブラウザ：apiFetch がヘッダーを読み、画面に案内を出す（src/lib/client/spend-limit-store.ts）
 * 予算の日・月は UTC で数える（src/lib/server/spend-cap-core.ts）。日本時間の午前9時に戻る
 */

/** 上限の種類。強い順（同じ要求で複数断られたら強いほうを伝える） */
export const SPEND_LIMIT_REASONS = ['month', 'day', 'client', 'minute', 'unavailable'] as const;
export type SpendLimitReason = (typeof SPEND_LIMIT_REASONS)[number];

export const SPEND_LIMIT_HEADER = 'X-Spend-Limit';

export function parseSpendLimit(value: string | null | undefined): SpendLimitReason | null {
  return SPEND_LIMIT_REASONS.find((r) => r === value) ?? null;
}

/** 強いほう（null は弱い） */
export function strongerSpendLimit(a: SpendLimitReason | null, b: SpendLimitReason | null): SpendLimitReason | null {
  if (!a) return b;
  if (!b) return a;
  return SPEND_LIMIT_REASONS.indexOf(a) <= SPEND_LIMIT_REASONS.indexOf(b) ? a : b;
}

/** 上限のあいだも使える機能（有料の呼び出しをしない） */
const STILL_AVAILABLE = '成分表示を文字で入力した比較と、すでに成分が分かっている商品での比較は、引き続き使えます。';
/** 上限で止まる機能（写真の読み取りも Gemini を使う） */
const STOPPED = 'Web での成分の調査・写真の読み取り・AI による解説は使えません。';

const MESSAGES: Record<SpendLimitReason, string> = {
  month: `今月の検索の上限（サービス全体で使える量）に達しました。毎月1日の午前9時（日本時間）まで、${STOPPED}${STILL_AVAILABLE}`,
  day: `本日の検索の上限（サービス全体で使える量）に達しました。毎日午前9時（日本時間）まで、${STOPPED}${STILL_AVAILABLE}`,
  client: `この端末・ネットワークからの本日の検索の上限に達しました。毎日午前9時（日本時間）まで、${STOPPED}${STILL_AVAILABLE}`,
  minute: `いま検索が混み合っています。1分ほど待ってから、もう一度お試しください。${STILL_AVAILABLE}`,
  unavailable: `検索が一時的に使えません。少し時間をおいてから、もう一度お試しください。${STILL_AVAILABLE}`,
};

export function spendLimitMessage(reason: SpendLimitReason): string {
  return MESSAGES[reason];
}

const MINUTE_MS = 60_000;

/** 案内を出しておく期限（上限が戻る時刻。ミリ秒）。日・月は UTC の次の区切り、混雑・障害は1分後 */
export function spendLimitUntil(reason: SpendLimitReason, now: number): number {
  const d = new Date(now);
  if (reason === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  if (reason === 'day' || reason === 'client') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return now + MINUTE_MS;
}
