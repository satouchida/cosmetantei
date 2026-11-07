/**
 * ブランドごとの製品名の略し方（docs/plans/search-flexibility.md）。そのブランドの製品だけ、製品名の written を
 * readAs に書き換えた形でも照合する。略し方はブランドで違うので、全部のブランドには当てない（オーナーの判断 2026-11-07）
 * - brand: src/lib/data/brands-jp.ts のブランド名（英字表記などの別の書き方のブランド欄にも当たる）
 * - written: 製品名に書かれた形。語の頭（行頭・空白・括弧・中黒の後）にあるときだけ。英字で終わる形は、
 *   後ろに英字が続かないときだけ（「SP」で「SPF」を書き換えない）
 * - readAs: 読み替えた形。英語の読み（super stay）も書ける
 * 足すときは tests/search-cases.ts に、その検索語と製品の行を足す
 */

export interface NameAlias {
  brand: string;
  written: string;
  readAs: string[];
}

export const NAME_ALIASES: readonly NameAlias[] = [
  // メイベリン：「SPステイ」＝「スーパーステイ」（Super Stay）
  { brand: 'メイベリン', written: 'SP', readAs: ['スーパー'] },
  { brand: 'メイベリン', written: 'SPステイ', readAs: ['super stay'] },
];
