import { Product } from '../types';
import { normalizeIngredientName } from '../utils/ingredient-name';
import { findMatchingKnownIngredient, isPlaceholderIngredient, labelIngredients } from './ingredient-match';

type FreeOfFlags = Pick<Product, 'fragranceFree' | 'alcoholFree'>;

/** 全成分が分からない製品には印を付けない（成分の無い製品・AI の推定に「無香料」と出さない） */
const NO_FLAGS: FreeOfFlags = { fragranceFree: undefined, alcoholFree: undefined };

/**
 * カードの「無香料」「アルコールフリー」の印。全成分の表示を成分DBで照合して決める（代わりの商品の確認と同じ照合）。
 * 香料は「香料」「Parfum」「Fragrance」等、アルコールは「エタノール」「変性アルコール」「Alcohol Denat.」等
 * （フェノキシエタノール・エタノールアミン類は含めない）。医薬部外品の有効成分も見る。
 * 製品を作るとき（Open Beauty Facts・Web のページ・お店の説明・入力した成分表示）と、保存した製品を読み込むときに付ける
 * （Web のページ・お店の製品は、印を持たずに保存されていた）
 */
export function freeOfFlags(product: Product): FreeOfFlags {
  if (
    product.isEstimatedFromMarketplaces ||
    product.ingredientSource === 'ai_estimate' ||
    product.ingredients.length === 0 ||
    product.ingredients.some(isPlaceholderIngredient)
  ) {
    return NO_FLAGS;
  }
  const ids = new Set<string | undefined>();
  for (const { raw } of labelIngredients(product)) {
    if (MAY_BE_FRAGRANCE_OR_ETHANOL.test(normalizeIngredientName(raw))) ids.add(findMatchingKnownIngredient(raw)?.id);
  }
  // 「他 n成分」（名前の書かれていない成分）がある表示では、含まないとは言えない。含むことは分かる
  const free = (id: string) => (ids.has(id) ? false : (product.undisclosedIngredientCount ?? 0) > 0 ? undefined : true);
  return { fragranceFree: free('fragrance'), alcoholFree: free('ethanol') };
}

/**
 * 成分DBの「香料」「エタノール」の項目に一致しうる名前（正規化した名前。項目の名前・別名はどれもこの語を含む。
 * src/lib/data/ingredients-db.ts）。これを含まない名前は照合しない（照合は1成分ずつ重く、保存した製品 300 件を
 * 読み込むたびにすべての成分を照合すると 1 秒近くかかる）
 */
const MAY_BE_FRAGRANCE_OR_ETHANOL = /香料|fragrance|parfum|flavor|エタノール|アルコール|alcohol|ethanol/;

/** 製品に印を付け直す */
export function withFreeOfFlags(product: Product): Product {
  return { ...product, ...freeOfFlags(product) };
}
