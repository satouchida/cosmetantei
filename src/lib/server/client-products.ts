import 'server-only';
import { Product, UserRoutineState } from '../types';
import { COSMETICS_DATABASE, hydrateVerifiedProducts, isShareable, isVerifiedSource } from '../data/cosmetics-db';

/**
 * ブラウザから送られた製品（分析・比較・価格のボタン）を、サーバーが持っている製品で置き換える。
 * docs/review/03-other-upgrades.md の「Don't trust product objects from the browser」
 *
 * - サーバーが同じ ID の成分確認済み製品を持っていれば、その製品（名前・成分・出典）を使う。
 *   ブラウザで書き換えた成分・商品名は使わない
 * - 持っていない製品（ユーザーが入力した成分表示、キャッシュが切れた製品など）は、送られたものを使う。
 *   その結果は送った本人への応答にだけ使い、共有のキャッシュ・ほかの人の検索結果・Gemini のプロンプトには入れない
 *   （テスト 71 で確かめる）
 * - サーバーのキャッシュから外れた製品（メモリ 500件・KV 300件を超えた古いもの）も、送られたものを使う
 */

function serverCopy(id: string): Product | undefined {
  const found = COSMETICS_DATABASE.find((p) => p.id === id);
  return found && isVerifiedSource(found) && isShareable(found) && found.ingredients.length > 0 ? found : undefined;
}

export async function resolveClientProducts(products: Product[]): Promise<Product[]> {
  if (products.length === 0) return products;
  await hydrateVerifiedProducts();
  return products.map((p) => serverCopy(p.id) ?? p);
}

export async function resolveClientProduct(product: Product): Promise<Product> {
  const [resolved] = await resolveClientProducts([product]);
  return resolved;
}

export async function resolveClientRoutine(routine: UserRoutineState): Promise<UserRoutineState> {
  const [badProducts, safeProducts, currentlyUsing] = await Promise.all([
    resolveClientProducts(routine.badProducts),
    resolveClientProducts(routine.safeProducts ?? []),
    resolveClientProducts(routine.currentlyUsing ?? []),
  ]);
  return { badProducts, safeProducts, currentlyUsing };
}
