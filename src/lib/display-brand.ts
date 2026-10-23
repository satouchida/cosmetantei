import { listedBrandName } from './services/brand-suggest';

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
