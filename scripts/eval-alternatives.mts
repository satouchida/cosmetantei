/**
 * 代わりの商品探しの決まった評価（docs/plans/alternative-search-improvements.md「Path 0」0b）。
 *
 *   RAKUTEN_APPLICATION_ID=… RAKUTEN_ACCESS_KEY=… YAHOO_CLIENT_ID=… \
 *     npx tsx --conditions=react-server scripts/eval-alternatives.mts [--limit N]
 *
 * - 8 種類 × 3 成分（香料・エタノール・フェノキシエタノール）の 24 件。1件ごとに findShopAlternatives を
 *   有料の調べもの無しで呼び、ログ [alternatives] の shop と同じ数を Markdown の表の1行にする
 *   （計画の「Measurements」に日付つきで貼る）
 * - お店のキーは、実行する人の環境変数から読む（片方のお店だけでもよい）。キーが無ければそう言って、何も呼ばずに終わる
 * - 出すのは数と決まった語だけ。キー・商品名・お店の文は出さない
 * - --limit は1回で探す数。既定の 3 はボタン1回と同じ（そろったら残りは確かめない）。30 にすると全候補を確かめる
 */
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ShopSearchCounts } from '../src/lib/services/shop-alternatives';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** よくある原因候補（香料・アルコール・防腐剤） */
export const SUSPECTS = ['香料', 'エタノール', 'フェノキシエタノール'] as const;
const DEFAULT_LIMIT = 3;
/** お店の API は同じアプリで1秒に1回まで（shop-apis.ts の API_INTERVAL_MS と同じ間隔） */
const CASE_INTERVAL_MS = 1_100;
const DROP_COLUMNS = ['otherKind', 'notSingle', 'excluded', 'noList', 'suspect', 'irritant', 'standard', 'unrated', 'duplicate'] as const;

export interface EvalRow {
  kind: string;
  avoid: string;
  /** お店の検索語に足した決まった語（本番と同じ shopTerms） */
  terms: string[];
  status: 'ok' | 'unavailable';
  counts: ShopSearchCounts;
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** 24 件を順に調べる。お店のキーが無ければ null（何も呼ばない） */
export async function evaluate({ limit = DEFAULT_LIMIT, intervalMs = CASE_INTERVAL_MS } = {}): Promise<EvalRow[] | null> {
  const apis = await import(`${ROOT}/src/lib/services/shop-apis`);
  if (!apis.isRakutenApiConfigured() && !apis.isYahooApiConfigured()) return null;
  const { findShopAlternatives } = await import(`${ROOT}/src/lib/services/shop-alternatives`);
  const { shopTerms } = await import(`${ROOT}/src/lib/services/alternatives-service`);
  const { findMatchingKnownIngredient } = await import(`${ROOT}/src/lib/analyzer/ingredient-match`);
  const { CATEGORY_LABELS_JA } = await import(`${ROOT}/src/lib/analyzer/product-category`);

  const rows: EvalRow[] = [];
  for (const kind of Object.keys(CATEGORY_LABELS_JA)) {
    for (const avoid of SUSPECTS) {
      if (rows.length > 0) await wait(intervalMs);
      // 本番（alternativeRequestFromText）と同じく、成分DBの項目から避ける名前と検索語を作る
      const known = findMatchingKnownIngredient(avoid);
      if (!known) throw new Error(`${avoid} is not in the ingredient database`);
      const terms: string[] = shopTerms({ known: [known] });
      const result = await findShopAlternatives({
        category: kind,
        avoid: [{ nameJa: known.nameJa, nameEn: known.nameEn }],
        terms,
        exclude: [],
        limit,
        allowPaidLookups: false,
      });
      rows.push({ kind, avoid, terms, status: result.status, counts: result.counts });
    }
  }
  return rows;
}

/** Markdown の表（見出し・行・合計）。数と決まった語だけ */
export function formatTable(rows: EvalRow[]): string {
  const header = ['kind', 'avoid', 'terms', 'status', 'rakuten', 'yahoo', ...DROP_COLUMNS, 'checked', 'notChecked', 'paid', 'shown'];
  const numbers = (c: ShopSearchCounts) => [
    c.fetched.rakuten,
    c.fetched.yahoo,
    ...DROP_COLUMNS.map((d) => c.dropped[d]),
    c.checked,
    c.notChecked,
    c.paidLookups,
    c.shown,
  ];
  const line = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;
  const body = rows.map((r) => line([r.kind, r.avoid, r.terms.join(' ') || '-', r.status, ...numbers(r.counts)]));
  const totals = rows.map((r) => numbers(r.counts)).reduce((sum, n) => sum.map((v, i) => v + n[i]), new Array<number>(header.length - 4).fill(0));
  return [line(header), line(header.map(() => '---')), ...body, line(['all', '', '', '', ...totals])].join('\n');
}

async function main(): Promise<void> {
  const flags = process.argv.slice(2);
  const limitAt = flags.indexOf('--limit');
  const limit = limitAt >= 0 ? Number(flags[limitAt + 1]) : DEFAULT_LIMIT;
  if (!(Number.isInteger(limit) && limit > 0)) throw new Error('--limit needs a positive integer');
  const rows = await evaluate({ limit });
  if (!rows) {
    console.log('No shop keys in the environment (RAKUTEN_APPLICATION_ID and RAKUTEN_ACCESS_KEY, or YAHOO_CLIENT_ID); nothing was called.');
    process.exitCode = 1;
    return;
  }
  console.log(`alternatives evaluation ${new Date().toISOString().slice(0, 10)}, limit ${limit}, paid lookups off\n`);
  console.log(formatTable(rows));
}

// テストからは evaluate と formatTable だけを読み込む（実行したときだけ main）。
// シンボリックリンク（macOS の /var → /private/var など）から実行しても同じファイルと分かるように実パスで比べる
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) await main();
