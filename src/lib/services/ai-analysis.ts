import 'server-only';
import { Product, ProductAnalysisResult } from '../types';
import { analyzeProduct, unratedIngredientNames } from '../analyzer/ingredient-analyzer';
import { evaluateUnknownIngredients } from './dynamic-ingredient-service';

/**
 * 成分DBとルールで「未評価」の成分を AI で評価してから分析する（分析カードが表示のあとで頼む）。
 * fromServer: サーバーが持っている製品か。持っていない製品（入力した成分表示、まだ届いていない・キャッシュから外れた製品）の
 * 成分は、Gemini のプロンプトにも共有のキャッシュにも入れない（src/lib/server/client-products.ts）
 * - サーバーが持っていない製品・Gemini の呼び出しが失敗したときは aiEvaluation の無い分析（カードは「調べられませんでした」）。
 *   入力した成分表示は、カードが初めから頼まない
 * - 頼む成分が無かった（全て評価済み・評価できない名前）ときは evaluatedCount 0
 */
export async function analyzeProductWithAI(product: Product, { fromServer }: { fromServer: boolean }): Promise<ProductAnalysisResult> {
  const base = analyzeProduct(product);
  if (!fromServer) return base;
  const unrated = unratedIngredientNames(base);
  if (unrated.length === 0) return { ...base, aiEvaluation: { evaluatedCount: 0 } };
  const { evaluations, failed } = await evaluateUnknownIngredients(unrated);
  if (evaluations.size === 0) return failed ? base : { ...base, aiEvaluation: { evaluatedCount: 0 } };
  return analyzeProduct(product, evaluations);
}
