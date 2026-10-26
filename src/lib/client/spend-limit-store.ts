/**
 * 上限に達したことの案内（画面の上の帯）。apiFetch が応答のヘッダーを見て知らせ（src/lib/client/api-fetch.ts）、
 * 画面は useSyncExternalStore で読む（src/components/chat/SpendLimitNotice.tsx）。
 * - このページを開いている間だけ覚える（端末にもサーバーにも保存しない）
 * - 上限が戻る時刻（spendLimitUntil）を過ぎたら消す。閉じたら、同じ種類とそれより弱い種類は、その時刻まで出さない
 * - 強い上限（今月）が出ているときに弱い上限（混雑）を知らされても、強いほうのまま
 */

import { SpendLimitReason, spendLimitUntil, strongerSpendLimit } from '@/lib/spend-limit';

export interface SpendLimitNoticeState {
  reason: SpendLimitReason;
  /** 案内を消す時刻（ミリ秒） */
  until: number;
}

let current: SpendLimitNoticeState | null = null;
/** 閉じた案内のうち強いほう（同じ種類と弱い種類は、その期限まで出さない） */
let dismissed: SpendLimitNoticeState | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function schedule(now: number): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!current) return;
  // setTimeout の上限（約24.8日）を超える待ちは、上限で一度起きて確かめ直す
  timer = setTimeout(expire, Math.min(Math.max(0, current.until - now), 2 ** 31 - 1));
}

function expire(): void {
  const now = Date.now();
  if (dismissed && dismissed.until <= now) dismissed = null;
  if (current && current.until <= now) {
    current = null;
    emit();
  }
  schedule(now);
}

/** 上限で断られたことを知らせる */
export function noteSpendLimit(reason: SpendLimitReason, now = Date.now()): void {
  if (dismissed && dismissed.until <= now) dismissed = null;
  if (dismissed && strongerSpendLimit(dismissed.reason, reason) === dismissed.reason) return;
  const live = current && current.until > now ? current : null;
  const stronger = strongerSpendLimit(live?.reason ?? null, reason);
  if (live && stronger === live.reason) return;
  current = { reason, until: spendLimitUntil(reason, now) };
  schedule(now);
  emit();
}

/** 案内を閉じる */
export function dismissSpendLimit(): void {
  if (!current) return;
  const keep = dismissed && dismissed.until > Date.now() && strongerSpendLimit(dismissed.reason, current.reason) === dismissed.reason;
  if (!keep) dismissed = current;
  current = null;
  schedule(Date.now());
  emit();
}

export function subscribeSpendLimit(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSpendLimitSnapshot(): SpendLimitNoticeState | null {
  return current;
}

/** サーバーでの描画では出さない */
export function getSpendLimitServerSnapshot(): SpendLimitNoticeState | null {
  return null;
}

/** テスト用 */
export function resetSpendLimitForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  current = null;
  dismissed = null;
}
