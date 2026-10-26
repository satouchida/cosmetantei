import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getBindings } from './cloudflare';
import { SpendLimitReason, strongerSpendLimit } from '@/lib/spend-limit';

/**
 * 有料の呼び出し（Gemini・Workers AI・Web 検索）の利用量の記録（docs/review/02-cost-and-model.md の 7）
 * - 1回の呼び出しにつき1件。どの API ルートから呼ばれたかを付ける（withUsageRoute）
 * - ログ（Workers Logs・wrangler tail）に `[usage] {...}` の1行で出す。USAGE（Workers Analytics Engine）が
 *   あれば同じ内容を書き、SQL で集計できるようにする
 * - 件数・トークン数・所要時間だけを記録する。プロンプト・応答・検索語・成分表示などの本文は記録しない
 */

export type UsageKind = 'gemini' | 'workers_ai' | 'web_search';
/**
 * ok: 成功 / error: 失敗（タイムアウトを含む） / capped: 上限に達して呼ばなかった /
 * cache_hit: AI Gateway のキャッシュから返った（モデルの提供元への有料の呼び出しは無いので、トークン数は数えない）
 */
// recitation: Gemini が著作物の引用に似ているとして出力を止めた（ページの成分表示の書き写しで起きる）
// blocked: 安全フィルターなどで止められた / truncated: 出力の上限で途中で切れた（どちらも課金される）
export type UsageOutcome = 'ok' | 'error' | 'capped' | 'cache_hit' | 'recitation' | 'blocked' | 'truncated';

export interface UsageEvent {
  kind: UsageKind;
  /** 何のための呼び出しか（chat_reply・page_read・ingredient_explain・label_read・chat_gate 等） */
  task: string;
  /** モデル名、または Web 検索のプロバイダー */
  model: string;
  outcome: UsageOutcome;
  promptTokens?: number;
  outputTokens?: number;
  /** 思考トークン（出力として課金される） */
  thoughtTokens?: number;
  /** 暗黙のキャッシュに当たった入力トークン */
  cachedTokens?: number;
  /** URL context でページを読んだか */
  urlContext?: boolean;
  ms?: number;
}

/**
 * 利用者ごとの1日の予算のキー（src/lib/server/spend-cap.ts）。1回の要求に、種類ごとに1つまで付く
 * - ip: IP（IPv6 は /48） / network: IPv4 の /24 / hosting: クラウドの事業者（AS 番号） /
 *   session: Turnstile で確かめたブラウザのセッション /
 *   new_session: 発行したばかりのセッション（キーは session と同じで、上限だけ小さい）
 */
export type BudgetClientKind = 'ip' | 'network' | 'hosting' | 'session' | 'new_session';
export interface BudgetClient {
  kind: BudgetClientKind;
  key: string;
}

const routeContext = new AsyncLocalStorage<{
  route: string;
  clients: BudgetClient[];
  refused?: boolean;
  /** 断られた上限のうち、画面に伝えるもの（急がない仕事・無料のお店の API・1回の要求の上限で断られたときは付けない） */
  limit?: SpendLimitReason;
  /** 同じものを、断られた呼び出しの種類（spend-cap.ts の SpendBucket）ごとに */
  limitByBucket?: Map<string, SpendLimitReason>;
  /** 要求を受けた時刻と、この要求で確保した有料の呼び出しの見積もりの合計（1回の要求の上限に使う） */
  startedAt: number;
  reservedMicros: number;
}>();

/**
 * 1回の要求で確保してよい有料の呼び出しの見積もりの合計（[vars] の SPEND_PER_REQUEST_USD、既定 $0.30）。
 * 調べものの段が重なっても、1回の要求で利用者の1日の予算（$0.50）を使い切らないように。
 * 製品を Web で調べる1回は、見積もりで約 $0.19〜0.29
 */
const DEFAULT_REQUEST_SPEND_USD = 0.3;
function maxRequestSpendMicros(): number {
  const usd = Number(process.env.SPEND_PER_REQUEST_USD);
  return Math.round((Number.isFinite(usd) && usd > 0 ? usd : DEFAULT_REQUEST_SPEND_USD) * 1_000_000);
}
/**
 * 要求を受けてから、新しい有料の呼び出しを始めてよい時間。ブラウザは 90 秒で待つのをやめる
 * （src/lib/client/chat-request.ts）。ページの読み取りは最長 30 秒なので、60 秒までに始めれば間に合う
 */
export const REQUEST_PAID_CALL_DEADLINE_MS = 60_000;

/**
 * API ルートの処理を包み、その中の有料の呼び出しにルート名と利用者（利用者ごとの1日の予算のキー）を付ける。
 * API ルートは src/lib/server/api-route.ts の apiRoute から使う
 */
export function withUsageRoute<A extends unknown[], R>(
  route: string,
  handler: (...args: A) => Promise<R>,
  clients: BudgetClient[] = []
) {
  return (...args: A): Promise<R> =>
    routeContext.run({ route, clients, startedAt: Date.now(), reservedMicros: 0 }, () => handler(...args));
}

export function currentUsageRoute(): string {
  return routeContext.getStore()?.route ?? 'other';
}

/** この有料の呼び出しを頼んだ利用者の予算のキー（API ルートの外・テストでは空） */
export function currentClients(): BudgetClient[] {
  return routeContext.getStore()?.clients ?? [];
}

/**
 * この要求でもう1回、この見積もりの有料の呼び出しをしてよいか（よければ合計に足す）。
 * 1回の要求の見積もりの合計か、始めてよい時間を超えたら false。API ルートの外（テスト・バックグラウンド）では制限しない
 */
export function takeRequestSpend(costMicros: number): boolean {
  const store = routeContext.getStore();
  if (!store) return true;
  if (Date.now() - store.startedAt > REQUEST_PAID_CALL_DEADLINE_MS) return false;
  if (store.reservedMicros + costMicros > maxRequestSpendMicros()) return false;
  store.reservedMicros += costMicros;
  return true;
}

/** 確保した見積もりを取り消す・実際の金額に直す（負の値で減らす）。API ルートの外では何もしない */
export function adjustRequestSpend(deltaMicros: number): void {
  const store = routeContext.getStore();
  if (store) store.reservedMicros = Math.max(0, store.reservedMicros + deltaMicros);
}

/**
 * この要求の有料の呼び出しが、上限（利用者ごと・全体の予算・1分の件数）で断られた・数えられなかった（spend-cap.ts が付ける）。
 * limit があれば、画面に伝える上限として、全体と呼び出しの種類（bucket）ごとに覚える（同じ要求で複数あれば強いほう）
 */
export function markRefused(limit?: SpendLimitReason, bucket?: string): void {
  const store = routeContext.getStore();
  if (!store) return;
  store.refused = true;
  if (!limit) return;
  store.limit = strongerSpendLimit(store.limit ?? null, limit) ?? undefined;
  if (bucket) {
    const byBucket = (store.limitByBucket ??= new Map());
    byBucket.set(bucket, strongerSpendLimit(byBucket.get(bucket) ?? null, limit) ?? limit);
  }
}

/**
 * この要求で断られた、画面に伝える上限（無ければ null。API ルートの外でも null）。
 * buckets を渡すと、その種類の呼び出しが断られた分だけを見る（「見つからなかった」の代わりに上限を伝えるかの判断。
 * チャットの判定など、ほかの呼び出しが断られただけなら、調べた結果の「見つからなかった」のまま）
 */
export function currentSpendLimit(buckets?: readonly string[]): SpendLimitReason | null {
  const store = routeContext.getStore();
  if (!store) return null;
  if (!buckets) return store.limit ?? null;
  let strongest: SpendLimitReason | null = null;
  for (const bucket of buckets) strongest = strongerSpendLimit(strongest, store.limitByBucket?.get(bucket) ?? null);
  return strongest;
}

/**
 * 失敗を「しばらく頼み直さない」として全員の分に覚えてよいか。上限で断られた呼び出しの失敗は、検索語そのものの失敗では
 * ないので覚えない（利用者が自分の上限に達したあとや、1分の件数を埋めたあとに、費用をかけずに人気の検索語などを
 * 全員の分だけ失敗扱いにできないように）
 */
export function mayRememberFailure(): boolean {
  return routeContext.getStore()?.refused !== true;
}

const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0);

/** 記録する。失敗しても呼び出し元の処理は止めない */
export async function recordUsage(event: UsageEvent): Promise<void> {
  const route = currentUsageRoute();
  const line = {
    route,
    kind: event.kind,
    task: event.task,
    model: event.model,
    outcome: event.outcome,
    promptTokens: count(event.promptTokens),
    outputTokens: count(event.outputTokens),
    thoughtTokens: count(event.thoughtTokens),
    cachedTokens: count(event.cachedTokens),
    ...(event.urlContext && { urlContext: true }),
    ms: Math.round(count(event.ms)),
  };
  console.log(`[usage] ${JSON.stringify(line)}`);
  try {
    const { USAGE } = await getBindings();
    // blob と double の並びは docs/walkthroughs/2026-10-14-cost-tracking.md の SQL と合わせる
    USAGE?.writeDataPoint({
      indexes: [line.kind],
      blobs: [line.route, line.kind, line.task, line.model, line.outcome, line.urlContext ? 'url_context' : ''],
      doubles: [1, line.promptTokens, line.outputTokens, line.thoughtTokens, line.cachedTokens, line.ms],
    });
  } catch (err) {
    console.error('Usage write failed:', err instanceof Error ? err.message : err);
  }
}

/** Gemini の usageMetadata（promptTokenCount 等）からトークン数を取り出す */
export function geminiTokenCounts(data: unknown): Pick<UsageEvent, 'promptTokens' | 'outputTokens' | 'thoughtTokens' | 'cachedTokens'> {
  const u = (data as { usageMetadata?: Record<string, unknown> })?.usageMetadata ?? {};
  return {
    promptTokens: count(u.promptTokenCount) + count(u.toolUsePromptTokenCount),
    outputTokens: count(u.candidatesTokenCount),
    thoughtTokens: count(u.thoughtsTokenCount),
    cachedTokens: count(u.cachedContentTokenCount),
  };
}
