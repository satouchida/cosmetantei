import React from 'react';

/**
 * 絵文字（ZWJ・異体字セレクタ・キーキャップ・肌の色でつながったものと、国旗の2文字を1つとして）。
 * 見えない文字はエスケープで書く（ファイルにそのまま入れると、編集や差分で消えやすい）
 */
const EMOJI_PATTERN =
  '\\p{Regional_Indicator}{2}|\\p{Extended_Pictographic}[\\u{FE0F}\\u{20E3}\\u{1F3FB}-\\u{1F3FF}]*(?:\\u{200D}\\p{Extended_Pictographic}[\\u{FE0F}\\u{1F3FB}-\\u{1F3FF}]*)*';
/** split で絵文字を残すため、つかまえる形（split は lastIndex を使わない） */
const EMOJI = new RegExp(`(${EMOJI_PATTERN})`, 'u');
const EMOJI_ALL = new RegExp(EMOJI_PATTERN, 'gu');

/** 読み上げる文から絵文字を外す（ライブリージョン用） */
export function withoutEmoji(text: string): string {
  return text.replace(EMOJI_ALL, '');
}

/**
 * 文中の飾りの絵文字を読み上げから外す（「カメラのフラッシュ バーコードを…」と読まれないように）。
 * 見た目は変えない。ボタンの中で使えば、ボタンの名前からも外れる
 */
export function withHiddenEmoji(text: string): React.ReactNode {
  const parts = text.split(EMOJI);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    // split の結果は、奇数番目がつかまえた絵文字
    i % 2 === 1 ? (
      <span key={i} aria-hidden="true">
        {part}
      </span>
    ) : (
      part
    )
  );
}
