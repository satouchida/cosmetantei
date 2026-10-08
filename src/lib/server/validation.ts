import 'server-only';
import { Product, UserRoutineState } from '../types';

/**
 * APIリクエストで受け取る製品データの検証
 * 分析処理は成分数×既知DBの計算量になるため、件数と文字数に上限を設ける
 */
const MAX_INGREDIENTS = 300;
const MAX_INGREDIENT_LENGTH = 200;
const MAX_TEXT_LENGTH = 200;
const MAX_ROUTINE_PRODUCTS = 20;
export const MAX_MESSAGE_LENGTH = 1000;

const isShortString = (v: unknown, max = MAX_TEXT_LENGTH): v is string =>
  typeof v === 'string' && v.length <= max;

export function isValidProduct(p: unknown): p is Product {
  if (!p || typeof p !== 'object') return false;
  const product = p as Record<string, unknown>;
  return (
    isShortString(product.id) &&
    isShortString(product.name) &&
    isShortString(product.brand) &&
    Array.isArray(product.ingredients) &&
    product.ingredients.length <= MAX_INGREDIENTS &&
    product.ingredients.every((i) => isShortString(i, MAX_INGREDIENT_LENGTH))
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
