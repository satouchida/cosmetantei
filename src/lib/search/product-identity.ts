import { Product } from '../types';
import { listedBrandKeys } from './product-match';

/**
 * 同じ製品かどうか（表記の違う同じ製品を1つにまとめる・比較リストに登録した製品を代わりの商品に出さない）
 */

/** ブランド表記の会社名部分（「ちふれ化粧品」「〇〇株式会社」等） */
const COMPANY_SUFFIX = /(株式会社|化粧品|コスメティックス?|cosmetics?|inc|co|ltd)$/;

const compact = (t: string) => t.normalize('NFKC').toLowerCase().replace(/[\s・･.,、。()（）\[\]【】'"’-]/g, '');

/** ブランド欄の語（会社名部分を除く。「ちふれ・CHIFURE」→ ちふれ, chifure） */
function brandTokens(brand: string): string[] {
  return brand
    .normalize('NFKC')
    .toLowerCase()
    .split(/[\s・･/()（）,、]+/)
    .map((t) => compact(t).replace(COMPANY_SUFFIX, ''))
    .filter((t) => t.length >= 2);
}

/**
 * ページごとに表記が違う同じ製品を同一視するためのキー
 * 例: 「ちふれ・CHIFURE / 美白化粧水 Ｗ」と「ちふれ化粧品 / ちふれ美白化粧水 W」は同じキーになる
 */
export function productIdentityKey(brand: string, name: string): string {
  // 容量（150ml・つめかえ用の 130ml 等）は成分が同じなので区別しない
  let key = compact(name).replace(/\d+(\.\d+)?(ml|g|l)\b/g, '');
  for (const token of brandTokens(brand)) key = key.split(token).join('');
  return key || compact(name);
}

/** JAN コードの比較用の形（数字だけ・先頭の 0 を除く） */
export const normalJan = (code: string | undefined): string => (code ? code.replace(/\D/g, '').replace(/^0+/, '') : '');

/** ブランドが同じか（語が1つ共通、または一覧の同じブランドの別の書き方。「Maybelline」と「メイベリン ニューヨーク」） */
function sameBrand(a: string, b: string): boolean {
  const tokens = new Set(brandTokens(a));
  if (brandTokens(b).some((t) => tokens.has(t))) return true;
  const listed = new Set(listedBrandKeys(a));
  return listedBrandKeys(b).some((k) => listed.has(k));
}

/** 同じ製品かを比べるのに使う項目 */
export type ProductIdentity = Pick<Product, 'id' | 'brand' | 'name'> & Partial<Pick<Product, 'barcode'>>;

/**
 * 同じ製品か：ID が同じ、JAN コードが同じ、またはブランドが同じで名前のキーが同じ。
 * 名前だけでは決めない（「リップクリーム」のような一般的な名前の、別のブランドの製品を同じにしない）
 */
export function isSameProduct(a: ProductIdentity, b: ProductIdentity): boolean {
  if (a.id === b.id) return true;
  const jan = normalJan(a.barcode);
  if (jan && jan === normalJan(b.barcode)) return true;
  return productIdentityKey(a.brand, a.name) === productIdentityKey(b.brand, b.name) && sameBrand(a.brand, b.brand);
}

/** 登録した製品（肌荒れした・使えているコスメ）のどれかと同じ製品か */
export function isRegisteredProduct(product: ProductIdentity, registered: readonly ProductIdentity[]): boolean {
  return registered.some((r) => isSameProduct(product, r));
}

/**
 * isRegisteredProduct と同じ判定を、登録した製品のキーを1回だけ作って何度も行う（成分DBの全製品と比べるとき）
 */
export function registeredMatcher(registered: readonly ProductIdentity[]): (product: ProductIdentity) => boolean {
  if (registered.length === 0) return () => false;
  const ids = new Set(registered.map((r) => r.id));
  const jans = new Set(registered.map((r) => normalJan(r.barcode)).filter(Boolean));
  const byKey = new Map<string, string[]>();
  for (const r of registered) {
    const key = productIdentityKey(r.brand, r.name);
    byKey.set(key, [...(byKey.get(key) ?? []), r.brand]);
  }
  return (p) => {
    if (ids.has(p.id)) return true;
    const jan = normalJan(p.barcode);
    if (jan && jans.has(jan)) return true;
    const brands = byKey.get(productIdentityKey(p.brand, p.name));
    return !!brands && brands.some((b) => sameBrand(p.brand, b));
  };
}
