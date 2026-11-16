import 'server-only';
import { getBindings, warnOnceInProduction } from './cloudflare';
import { isUpstreamLimit, markRefused, recordUsage } from './usage';
import { reserveSpend } from './spend-cap';
import { WEB_SEARCH_COST_MICROS } from './prices';

export type WebSearchProvider = 'exa' | 'linkup';

export interface WebSearchItem {
  url: string;
  title: string;
  description: string;
}

const WEB_SEARCH_TIMEOUT_MS = 8_000;

/**
 * Cloudflare Web Search で1回検索する。バインディングが無い・エラー・タイムアウト時は null
 * - 結果は読むページの候補として一時的に使うだけで、どこにもキャッシュしない（Exa・Linkup の規約）
 * - 検索語はアプリが商品名などから組み立てたもの。利用者のチャット文は渡さない
 */
export async function runWebSearch(
  query: string,
  provider: WebSearchProvider,
  limit: number
): Promise<WebSearchItem[] | null> {
  const { AI } = await getBindings();
  if (!AI?.websearch) {
    warnOnceInProduction('websearch-binding', 'Workers AI websearch is unavailable; web research is skipped.');
    return null;
  }
  // Web 検索は常に AI Gateway 経由（クレジット課金）。ゲートウェイ未設定なら呼ばない
  const gatewayId = (process.env.AI_GATEWAY_ID || '').trim();
  if (!gatewayId) {
    warnOnceInProduction('websearch-gateway', 'AI_GATEWAY_ID is not set; web research is skipped.');
    return null;
  }

  if (!(await reserveSpend('web_search', WEB_SEARCH_COST_MICROS[provider]))) {
    console.warn('Web search skipped: spend cap reached');
    await recordUsage({ kind: 'web_search', task: 'web_search', model: provider, outcome: 'capped' });
    return null;
  }

  const started = Date.now();
  let ok = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('web search timed out')), WEB_SEARCH_TIMEOUT_MS);
    });
    let result: unknown = await Promise.race([AI.websearch({ query, provider, limit, gatewayId }), timeout]);
    // バインディングは Response を返す（Phase 0 で確認）。プレーンなオブジェクトにも対応する
    if (result instanceof Response) {
      if (!result.ok) {
        if (isUpstreamLimit(result.status)) markRefused('unavailable', 'web_search');
        console.error(`Web search (${provider}) failed: ${result.status}`);
        return null;
      }
      result = await result.json();
    }
    ok = true;
    const items = (result as { items?: unknown })?.items;
    if (!Array.isArray(items)) return [];
    return items
      .filter((i): i is { url: string; title?: unknown; description?: unknown } =>
        typeof (i as { url?: unknown })?.url === 'string' && /^https?:\/\//.test((i as { url: string }).url)
      )
      .map((i) => ({
        url: i.url,
        title: typeof i.title === 'string' ? i.title : '',
        description: typeof i.description === 'string' ? i.description : '',
      }));
  } catch (err) {
    if (isUpstreamLimit(err)) markRefused('unavailable', 'web_search');
    console.error(`Web search (${provider}) failed:`, err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
    // 検索語は記録しない（利用者の入力から作った商品名を含むため）
    await recordUsage({ kind: 'web_search', task: 'web_search', model: provider, outcome: ok ? 'ok' : 'error', ms: Date.now() - started });
  }
}
