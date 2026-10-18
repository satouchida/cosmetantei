/**
 * AI・Web ページから来た文章を、利用者に見せる・全員で共有する前に確かめる（Gemini の応答、ページから読んだ商品名など）。
 * プロンプトで禁じていても、指示に従わない応答・ページに書かれた指示で、リンクや書式が紛れ込むことがあるため
 */

/** リンク（URL・www・ドメイン名だけの書き方） */
export const LINK_PATTERN =
  /https?:|www\.|(?<![a-z0-9.])[a-z0-9][a-z0-9-]+\.(com|net|org|jp|co|io|xyz|info|biz|top|site|me|ly|app|dev|link|shop|online)(?![a-z0-9])/i;

/** Markdown の書式（見出し・コード・リンク・HTML のタグ） */
const MARKUP_PATTERN = /^\s*#|`|\]\(|<\/?[a-z]/im;

/** 行頭の箇条書きの記号 */
const LIST_MARKER_PATTERN = /^\s*[-*・•]\s/m;

/** 見えない文字（制御文字・書式文字・私用文字・行区切り）。改行とタブは除く */
const INVISIBLE_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cf}\p{Co}\p{Zl}\p{Zp}]/u;

/** 利用者に見せる文章として使えるか（チャットの返事・成分の解説）。長さは呼び出し側で確かめる */
export function isPlainReplyText(text: string): boolean {
  return !LINK_PATTERN.test(text) && !MARKUP_PATTERN.test(text) && !LIST_MARKER_PATTERN.test(text) && !INVISIBLE_PATTERN.test(text);
}

/** 商品名・ブランド名・店名として使えるか（1行で、リンク・書式・見えない文字を含まない）。長さは呼び出し側で確かめる */
export function isPlainLabelText(text: string): boolean {
  return !/[\r\n\t]/.test(text) && !LINK_PATTERN.test(text) && !MARKUP_PATTERN.test(text) && !INVISIBLE_PATTERN.test(text);
}

/**
 * Web ページなどから来た名前を、AI（Clef）への質問に入れる形にする（見えない文字・改行を除き、長さをそろえる）。
 * 名前の中の指示に従わせないよう、質問の文でもデータであることを伝える
 */
export function forAiQuestion(text: string, maxLength: number): string {
  return text
    .replace(new RegExp(INVISIBLE_PATTERN.source, 'gu'), '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
