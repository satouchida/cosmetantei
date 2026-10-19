import { Product } from './types';
import { LABEL_LIMITS } from './analyzer/label-parser';

/**
 * APIリクエストで受け取る製品データの検証
 * 分析処理は成分数×既知DBの計算量になるため、件数と文字数に上限を設ける。
 * ブラウザに保存した「今使っているコスメ」の読み込み（current-use.ts）でも同じ検証を使い、
 * サーバーが受け付けない製品を保存したまま送り続けないようにする
 */
const MAX_INGREDIENTS = LABEL_LIMITS.ingredients;
const MAX_INGREDIENT_LENGTH = 200;
const MAX_TEXT_LENGTH = 200;
export const MAX_ROUTINE_PRODUCTS = 20;
const MAX_ACTIVE_INGREDIENTS = LABEL_LIMITS.activeIngredients;
const MAX_UNDISCLOSED_INGREDIENTS = LABEL_LIMITS.undisclosed;

const PRODUCT_CATEGORIES: readonly string[] = ['cleanser', 'toner', 'serum', 'cream', 'sunscreen', 'mask', 'lip', 'other'];
const INGREDIENT_SOURCES: readonly string[] = ['open_beauty_facts', 'user_label', 'web_page', 'ai_estimate', 'shop_listing'];
/** 出典ページの URL（カードにリンクとして出すため、長さと種類を確かめる） */
const MAX_URL_LENGTH = 2048;

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
        (product.undisclosedIngredientCount as number) <= MAX_UNDISCLOSED_INGREDIENTS)) &&
    (product.ingredientsEn === undefined ||
      (Array.isArray(product.ingredientsEn) &&
        product.ingredientsEn.length <= MAX_INGREDIENTS &&
        product.ingredientsEn.every((i) => isShortString(i, MAX_INGREDIENT_LENGTH)))) &&
    (product.ingredientSource === undefined ||
      (typeof product.ingredientSource === 'string' && INGREDIENT_SOURCES.includes(product.ingredientSource))) &&
    (product.sourceUrl === undefined ||
      (isShortString(product.sourceUrl, MAX_URL_LENGTH) && /^https?:\/\//i.test(product.sourceUrl)))
  );
}

export function isValidProductList(list: unknown): list is Product[] {
  return Array.isArray(list) && list.length <= MAX_ROUTINE_PRODUCTS && list.every(isValidProduct);
}

