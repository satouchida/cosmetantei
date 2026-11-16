import 'server-only';
import { getBindings, warnOnceInProduction } from './cloudflare';
import { isUpstreamLimit, markRefused, recordUsage } from './usage';
import { reserveSpend } from './spend-cap';
import { workersAiCostMicros } from './prices';

/** Workers AI（Clef）の呼び出しを待つ上限 */
const WORKERS_AI_TIMEOUT_MS = 5_000;

/**
 * Workers AI のモデルを実行する。バインディングが無い環境（next dev・テスト）・エラー・タイムアウト時は null
 */
export async function runWorkersAI(
  model: string,
  input: Record<string, unknown>,
  options: { containsUserText?: boolean; task: string }
): Promise<unknown | null> {
  const { AI } = await getBindings();
  if (!AI) {
    warnOnceInProduction('ai-binding', 'Workers AI binding "AI" is missing; Workers AI checks are skipped.');
    return null;
  }
  // AI_GATEWAY_ID があれば AI Gateway を経由し、Gemini と同じダッシュボードで利用量・コストを確認できるようにする。
  // ただし利用者の入力文を含むリクエストは、本文をログに残してよいゲートウェイ（開発用）でのみ経由する
  // （バインディング経由ではリクエストごとに本文ログを止められないため）
  const allowGateway = !options.containsUserText || process.env.AI_GATEWAY_LOG_PAYLOAD === 'true';
  const gatewayId = allowGateway ? (process.env.AI_GATEWAY_ID || '').trim() : '';
  // 見積もり：入力の JSON の文字数をトークン数とみなす（Clef は入力だけ課金。1回 0.001 ドル未満）
  if (!(await reserveSpend('workers_ai', workersAiCostMicros(model, JSON.stringify(input).length)))) {
    console.warn(`Workers AI ${model} skipped: spend cap reached`);
    await recordUsage({ kind: 'workers_ai', task: options.task, model, outcome: 'capped' });
    return null;
  }
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // 応答が無いまま待ち続けない（呼び出し側のゲート・フィルターにも短い上限があるが、ブランドの判定には無いため）
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${WORKERS_AI_TIMEOUT_MS} ms`)), WORKERS_AI_TIMEOUT_MS);
    });
    const result = await Promise.race([AI.run(model, input, gatewayId ? { gateway: { id: gatewayId } } : undefined), timeout]);
    const usage = (result as { usage?: { input_tokens?: number; output_tokens?: number } })?.usage;
    await recordUsage({
      kind: 'workers_ai',
      task: options.task,
      model,
      outcome: 'ok',
      promptTokens: usage?.input_tokens,
      outputTokens: usage?.output_tokens,
      ms: Date.now() - started,
    });
    return result;
  } catch (err) {
    // ゲートウェイの上限で断られた失敗は、失敗として覚えない（判定は手元の規則に戻るので、画面には伝えない）
    if (isUpstreamLimit(err)) markRefused();
    console.error(`Workers AI ${model} failed:`, err instanceof Error ? err.message : err);
    await recordUsage({ kind: 'workers_ai', task: options.task, model, outcome: 'error', ms: Date.now() - started });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
