/**
 * チャットの商品名の検索で、検索語が製品に合うか・合わないかの表（docs/plans/search-flexibility.md）。
 * 実際に聞かれた検索語と、見つけた製品。src/lib/data/brands-jp.ts のブランドの書き方や
 * src/lib/data/name-aliases.ts の略し方を足すときは、ここに行を足す（直した検索が後で戻らないように）
 */

export interface SearchCase {
  query: string;
  brand: string;
  name: string;
  category: string;
  /** 答えとして出すか */
  matches: boolean;
  note: string;
}

export const SEARCH_CASES: readonly SearchCase[] = [
  // メイベリン（2026-11-07 のログ。公式の製品名は「SPステイ」）
  { query: 'メイベリン　ヴィニルインク', brand: 'メイベリン ニューヨーク', name: 'SPステイ ヴィニルインク', category: 'lip', matches: true, note: '全角の空白' },
  { query: 'メイベリン　スーパーステイ', brand: 'メイベリン ニューヨーク', name: 'SPステイ マットインク', category: 'lip', matches: true, note: 'SP＝スーパー（メイベリンだけ）' },
  { query: 'メイベリン　スーパーステイ　リップ', brand: 'メイベリン ニューヨーク', name: 'SPステイ マットインク', category: 'lip', matches: true, note: '分類の語は製品の分類で合う' },
  { query: 'Maybelline マットインク', brand: 'メイベリン ニューヨーク', name: 'SPステイ マットインク', category: 'lip', matches: true, note: '英字のブランド名' },
  { query: 'MAYBELLINE NEW YORK マットインク', brand: 'メイベリン ニューヨーク', name: 'SPステイ マットインク', category: 'lip', matches: true, note: '英字のブランド名（2語）' },
  { query: 'maybelline super stay', brand: 'メイベリン ニューヨーク', name: 'SPステイ マットインク', category: 'lip', matches: true, note: '英語の読み（name-aliases の readAs）' },
  { query: 'メイベリン マットインク', brand: 'MAYBELLINE NEW YORK', name: 'SPステイ マットインク', category: 'lip', matches: true, note: '製品のブランド欄が英字' },
  { query: 'メイベリン ビニルインク', brand: 'メイベリン ニューヨーク', name: 'SPステイ ヴィニルインク', category: 'lip', matches: true, note: 'ヴィ＝ビ' },
  { query: 'メイベリン ヴィニールインク', brand: 'メイベリン ニューヨーク', name: 'SPステイ ヴィニルインク', category: 'lip', matches: false, note: '長音の有無は読み替えない（意味が変わる語があるため）' },
  { query: 'マットインク 化粧水', brand: 'メイベリン ニューヨーク', name: 'SPステイ マットインク', category: 'lip', matches: false, note: '分類が違う' },
  { query: 'ほかのブランド スーパーステイ', brand: 'ほかのブランド', name: 'SPステイ マットインク', category: 'lip', matches: false, note: '略し方はそのブランドだけ' },
  // 以前からの照合
  { query: 'キュレル 潤浸保湿 化粧水', brand: 'Curel', name: '潤浸保湿 化粧水', category: 'toner', matches: true, note: '英字のブランド欄をカタカナで' },
  { query: 'マキアージュ ドラマティックエッセンスリキッド', brand: '資生堂 / マキアージュ', name: 'ドラマティックルージュEX', category: 'lip', matches: false, note: '同じブランドの別の製品は答えにしない（2026-11-03 のログ）' },
];
