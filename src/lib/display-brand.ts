import { labelBrandName, listedBrandName } from './services/brand-suggest';
import { displayListingName } from './search/listing-name';
import type { Product } from './types';

/**
 * UI表示用の安全なブランド名取得（クライアントでも使えるよう、サーバー専用モジュールに依存しない）
 * - 一覧のブランドなら、その名前にそろえる（「Curel」「花王 / キュレル」→「キュレル」）
 * - brand 欄が会社名で、商品名に一覧のブランドがあれば、そのブランド（「花王」の「キュレル ハンドクリーム」→「キュレル」）
 * - 一般名詞や不正ワードが入っていた場合は、商品名の先頭語や安全な表記にフォールバック
 * - isGenericTerm はサーバー側で Gemini 判定キャッシュを参照するために差し込む
 */
/** brand 欄にブランド名がある（空・「ブランド未登録」「ブランド未記載」でない） */
function isKnownBrand(brand: string | undefined): brand is string {
  return !!brand && brand !== 'ブランド未登録' && brand !== 'ブランド未記載';
}

export function getDisplayBrand(
  brand?: string,
  name?: string,
  isGenericTerm: (term: string) => boolean = () => false
): string {
  if (isKnownBrand(brand) && !isGenericTerm(brand)) {
    return (name && labelBrandName(brand, name)) || listedBrandName(brand) || brand;
  }
  if (name) {
    const firstWord = name.split(/[\s　]+/)[0];
    if (firstWord && !isGenericTerm(firstWord) && firstWord.length >= 2 && firstWord.length <= 12) {
      return firstWord;
    }
  }
  return '実在コスメ';
}

/**
 * お店の商品のカードに出すブランドの行と名前（名前は displayListingName）。ブランドが分からなければ、飾りを外した名前の最初の語を
 * ブランドの行に出し、名前からは外す（「「ポイント10倍 11月20〜21日」ANTI-SIGNAL リンクルハンター」の売り文句をブランドにしない）
 */
export function listingCardLabels(p: Pick<Product, 'brand' | 'name'>): { brand: string; name: string } {
  const cleaned = displayListingName(p.name);
  const brand = getDisplayBrand(p.brand, cleaned);
  // 名前から外すのは、ブランドの行に出したブランド（会社名の brand 欄なら、商品名の中のブランド）
  const fromLabel = isKnownBrand(p.brand) ? labelBrandName(p.brand, cleaned) : null;
  return { brand, name: displayListingName(p.name, fromLabel ?? (isKnownBrand(p.brand) ? p.brand : brand)) };
}

/** 「ブランド 商品名」。商品名にブランド名（「ちふれ化粧品 / ちふれ」のどれか）が入っていれば商品名だけ */
export function productLabel(p: Pick<Product, 'brand' | 'name'>): string {
  const tokens = p.brand.split(/[/／・|,、]/).map((t) => t.trim()).filter((t) => t.length >= 2);
  return tokens.some((t) => p.name.includes(t)) ? p.name : [p.brand, p.name].filter(Boolean).join(' ');
}
