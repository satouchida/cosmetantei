import { Product } from './types';

/**
 * 「有効成分」として出してよい成分。有効成分は承認を受けた医薬部外品（と医薬品）だけの言葉で、
 * 化粧品に「有効成分」と出すと承認を受けた製品と誤認させる（薬機法第66条・景品表示法第5条第1号）。
 * 医薬部外品の印（isQuasiDrug）が無い製品の有効成分の一覧は、ほかの成分と同じに扱う。
 * 読み取り・調べた製品は有効成分があれば医薬部外品にするが、共有の画像・リンク、ブラウザに保存した一覧、
 * API に送られた製品は印と一覧が食い違うことがあるため、表示する側で確かめる
 */
export function quasiDrugActives(product: Product): string[] {
  return product.isQuasiDrug === true ? (product.activeIngredientsJa ?? []) : [];
}

/**
 * 有効成分以外の成分（表示の順）。印の無い製品の有効成分の一覧は、全成分（配合量の多い順）を崩さないよう後ろに足す
 */
export function ordinaryIngredients(product: Product): string[] {
  return product.isQuasiDrug === true ? product.ingredients : [...product.ingredients, ...(product.activeIngredientsJa ?? [])];
}
