import { labelBrandName, listedBrandName } from './services/brand-suggest';
import { displayListingName } from './search/listing-name';
import { readsAlike } from './search/product-identity';
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
  // 一覧に無いブランドを「英字 読み」で書いた名前（「THE FUTURE ザフューチャー …」）は、英字の語をブランドの行に出し、読みも名前から外す
  // （最初の語だけをブランドにすると「THE」と「FUTURE ザフューチャー …」になる）
  const withReading = isKnownBrand(p.brand) ? null : brandAndReading(cleaned);
  if (withReading) return withReading;
  const brand = getDisplayBrand(p.brand, cleaned);
  // 名前から外すのは、ブランドの行に出したブランド（会社名の brand 欄なら、商品名の中のブランド）
  const fromLabel = isKnownBrand(p.brand) ? labelBrandName(p.brand, cleaned) : null;
  return { brand, name: displayListingName(p.name, fromLabel ?? (isKnownBrand(p.brand) ? p.brand : brand)) };
}

/** ブランドに使う英字の語（「THE」「rom&nd」「Dr.Jart+」） */
const LATIN_WORD = /^[a-z0-9&.'+-]+$/i;
/** 読みのカタカナの語 */
const KANA_WORD = /^[ァ-ヺー]{2,}$/;
const MAX_BRAND_WORDS = 3;

/**
 * 名前の先頭の英字の語（3語まで）と、その読みのカタカナの語（「TIRTIR ティルティル …」）。ブランドと、読みの後の名前。
 * 読みの後に名前が無ければ null
 */
function brandAndReading(name: string): { brand: string; name: string } | null {
  const words = name.split(' ');
  for (let n = 1; n <= MAX_BRAND_WORDS && n < words.length - 1; n++) {
    if (!LATIN_WORD.test(words[n - 1])) break;
    const brand = words.slice(0, n).join(' ');
    if (KANA_WORD.test(words[n]) && readsAlike(brand, words[n])) return { brand, name: words.slice(n + 1).join(' ') };
  }
  return null;
}

/**
 * カードのブランドの行（brand 欄があるときだけ getDisplayBrand でそろえる。「花王」の「キュレル …」→ キュレル、
 * 「Curel」→ キュレル）。brand 欄が空・「ブランド未登録」なら、そのまま（商品名の最初の語をブランドにしない）
 */
export function brandLine(p: Pick<Product, 'brand' | 'name'>): string {
  return isKnownBrand(p.brand) ? getDisplayBrand(p.brand, p.name) : p.brand;
}

/**
 * 「ブランド 商品名」の、ブランドを brandLine にしたもの（「花王」の「キュレル ハンドクリーム」→「キュレル ハンドクリーム」）。
 * 商品名に brand 欄か brandLine のブランドが入っていれば商品名だけ（「Curel」の「Curel フォーム」に「キュレル」を足さない）
 */
export function shownProductLabel(p: Pick<Product, 'brand' | 'name'>): string {
  const brand = brandLine(p);
  if (productLabel(p) === p.name || productLabel({ brand, name: p.name }) === p.name) return p.name;
  return [brand, p.name].filter(Boolean).join(' ');
}

/** 「ブランド 商品名」。商品名にブランド名（「ちふれ化粧品 / ちふれ」のどれか）が入っていれば商品名だけ */
export function productLabel(p: Pick<Product, 'brand' | 'name'>): string {
  const tokens = p.brand.split(/[/／・|,、]/).map((t) => t.trim()).filter((t) => t.length >= 2);
  return tokens.some((t) => p.name.includes(t)) ? p.name : [p.brand, p.name].filter(Boolean).join(' ');
}
