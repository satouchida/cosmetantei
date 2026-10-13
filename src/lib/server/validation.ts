import 'server-only';
import { Product, UserRoutineState } from '../types';
import { LABEL_LIMITS } from '../analyzer/label-parser';

/**
 * APIリクエストで受け取る製品データの検証
 * 分析処理は成分数×既知DBの計算量になるため、件数と文字数に上限を設ける
 */
const MAX_INGREDIENTS = LABEL_LIMITS.ingredients;
const MAX_INGREDIENT_LENGTH = 200;
const MAX_TEXT_LENGTH = 200;
const MAX_ROUTINE_PRODUCTS = 20;
const MAX_ACTIVE_INGREDIENTS = LABEL_LIMITS.activeIngredients;
const MAX_UNDISCLOSED_INGREDIENTS = LABEL_LIMITS.undisclosed;
export const MAX_MESSAGE_LENGTH = 1000;

const PRODUCT_CATEGORIES: readonly string[] = ['cleanser', 'toner', 'serum', 'cream', 'sunscreen', 'mask', 'lip', 'other'];

const isShortString = (v: unknown, max = MAX_TEXT_LENGTH): v is string =>
  typeof v === 'string' && v.length <= max;

export function isValidProduct(p: unknown): p is Product {
  if (!p || typeof p !== 'object') return false;
  const product = p as Record<string, unknown>;
  return (
    isShortString(product.id) &&
    isShortString(product.name) &&
    isShortString(product.brand) &&
    // 種類は決まった語だけ（代わりの商品探しの検索語に使う）
    (product.category === undefined ||
      (typeof product.category === 'string' && PRODUCT_CATEGORIES.includes(product.category))) &&
    Array.isArray(product.ingredients) &&
    product.ingredients.length <= MAX_INGREDIENTS &&
    product.ingredients.every((i) => isShortString(i, MAX_INGREDIENT_LENGTH)) &&
    // 医薬部外品の項目（有効成分も分析するため、成分と同じく上限を設ける）
    (product.activeIngredientsJa === undefined ||
      (Array.isArray(product.activeIngredientsJa) &&
        product.activeIngredientsJa.length <= MAX_ACTIVE_INGREDIENTS &&
        product.activeIngredientsJa.every((i) => isShortString(i, MAX_INGREDIENT_LENGTH)))) &&
    (product.isQuasiDrug === undefined || typeof product.isQuasiDrug === 'boolean') &&
    (product.undisclosedIngredientCount === undefined ||
      (Number.isInteger(product.undisclosedIngredientCount) &&
        (product.undisclosedIngredientCount as number) >= 0 &&
        (product.undisclosedIngredientCount as number) <= MAX_UNDISCLOSED_INGREDIENTS))
  );
}

export function isValidProductList(list: unknown): list is Product[] {
  return Array.isArray(list) && list.length <= MAX_ROUTINE_PRODUCTS && list.every(isValidProduct);
}

export function isValidRoutine(r: unknown): r is UserRoutineState {
  if (!r || typeof r !== 'object') return false;
  const routine = r as Record<string, unknown>;
  return (
    isValidProductList(routine.badProducts) &&
    (routine.safeProducts === undefined || isValidProductList(routine.safeProducts)) &&
    (routine.currentlyUsing === undefined || isValidProductList(routine.currentlyUsing))
  );
}
