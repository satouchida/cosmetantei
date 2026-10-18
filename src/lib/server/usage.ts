import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getBindings } from './cloudflare';

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
 *   session: Turnstile で確かめたブラウザのセッション
 */
export type BudgetClientKind = 'ip' | 'network' | 'hosting' | 'session';
export interface BudgetClient {
  kind: BudgetClientKind;
  key: string;
}

const routeContext = new AsyncLocalStorage<{ route: string; clients: BudgetClient[]; refused?: boolean }>();

/**
 * API ルートの処理を包み、その中の有料の呼び出しにルート名と利用者（利用者ごとの1日の予算のキー）を付ける。
 * API ルートは src/lib/server/api-route.ts の apiRoute から使う
 */
export function withUsageRoute<A extends unknown[], R>(
  route: string,
  handler: (...args: A) => Promise<R>,
  clients: BudgetClient[] = []
) {
  return (...args: A): Promise<R> => routeContext.run({ route, clients }, () => handler(...args));
}

export function currentUsageRoute(): string {
  return routeContext.getStore()?.route ?? 'other';
}

/** この有料の呼び出しを頼んだ利用者の予算のキー（API ルートの外・テストでは空） */
export function currentClients(): BudgetClient[] {
  return routeContext.getStore()?.clients ?? [];
}

/** この要求の有料の呼び出しが、上限（利用者ごと・全体の予算・1分の件数）で断られた・数えられなかった（spend-cap.ts が付ける） */
export function markRefused(): void {
  const store = routeContext.getStore();
  if (store) store.refused = true;
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
