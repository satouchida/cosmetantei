import 'server-only';
import { Product, ProductAnalysisResult } from '../types';
import { analyzeProduct, unratedIngredientNames } from '../analyzer/ingredient-analyzer';
import { evaluateUnknownIngredients } from './dynamic-ingredient-service';

/**
 * 成分DBとルールで「未評価」の成分を AI で評価してから分析する（分析カードが表示のあとで頼む）。
 * AI を呼べなかったときは aiEvaluation の無い、ふつうの分析を返す。
 * fromServer: サーバーが持っている製品か。持っていない製品（入力した成分表示など）の成分は、
 * Gemini のプロンプトにも共有のキャッシュにも入れない（src/lib/server/client-products.ts）
 */
export async function analyzeProductWithAI(product: Product, { fromServer }: { fromServer: boolean }): Promise<ProductAnalysisResult> {
  const base = analyzeProduct(product);
  if (!fromServer) return { ...base, aiEvaluation: { evaluatedCount: 0, userSupplied: true } };
  const unrated = unratedIngredientNames(base);
  if (unrated.length === 0) return { ...base, aiEvaluation: { evaluatedCount: 0 } };
  const evaluations = await evaluateUnknownIngredients(unrated);
  return evaluations.size > 0 ? analyzeProduct(product, evaluations) : base;
}
