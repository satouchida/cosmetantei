'use client';

import { createContext, useContext } from 'react';
import { Product } from '@/lib/types';
import { isRegisteredProduct, ProductIdentity } from '@/lib/search/product-identity';

/**
 * 比較リストに登録した製品（肌荒れした・使えているコスメ）。
 * 代わりの商品のカードに出さない（サーバーでも除くが、AI の評価で分析をやり直したときと、
 * 結果を出した後に登録した製品はサーバーが知らないので、表示のときにも除く）
 */
export const RegisteredProductsContext = createContext<readonly ProductIdentity[]>([]);

/** 登録した製品を除いた代わりの商品 */
export function useUnregisteredProducts(products: Product[]): Product[] {
  const registered = useContext(RegisteredProductsContext);
  return registered.length === 0 ? products : products.filter((p) => !isRegisteredProduct(p, registered));
}
