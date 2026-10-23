import { listedBrandName } from './services/brand-suggest';
import type { Product } from './types';

/**
 * UI表示用の安全なブランド名取得（クライアントでも使えるよう、サーバー専用モジュールに依存しない）
 * - 一覧のブランドなら、その名前にそろえる（「Curel」「花王 / キュレル」→「キュレル」）
 * - 一般名詞や不正ワードが入っていた場合は、商品名の先頭語や安全な表記にフォールバック
 * - isGenericTerm はサーバー側で Gemini 判定キャッシュを参照するために差し込む
 */
export function getDisplayBrand(
  brand?: string,
  name?: string,
  isGenericTerm: (term: string) => boolean = () => false
): string {
  if (brand && !isGenericTerm(brand) && brand !== 'ブランド未登録' && brand !== 'ブランド未記載') {
    return listedBrandName(brand) ?? brand;
  }
  if (name) {
    const firstWord = name.split(/[\s　]+/)[0];
    if (firstWord && !isGenericTerm(firstWord) && firstWord.length >= 2 && firstWord.length <= 12) {
      return firstWord;
    }
  }
  return '実在コスメ';
}

/** 「ブランド 商品名」。商品名にブランド名（「ちふれ化粧品 / ちふれ」のどれか）が入っていれば商品名だけ */
export function productLabel(p: Pick<Product, 'brand' | 'name'>): string {
  const tokens = p.brand.split(/[/／・|,、]/).map((t) => t.trim()).filter((t) => t.length >= 2);
  return tokens.some((t) => p.name.includes(t)) ? p.name : [p.brand, p.name].filter(Boolean).join(' ');
}
