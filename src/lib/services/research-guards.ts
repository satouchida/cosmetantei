import 'server-only';
import { Product } from '../types';
import { isJailbreakAttempt } from './gemini';

/**
 * Web リサーチで信頼できない文に掛ける確かめ（web-research.ts）。
 * 検索語に本人の話題・連絡先・指示のような文を入れさせず、ページが名乗れる製品名・成分表示の長さと件数を抑える
 */

/**
 * AI への指示のような語（検索語・ページの成分名に入っていたら使わない）。検索語は Gemini のページ読み取りにも渡るため、
 * 「ignore page ingredients」のような語で読み取りを変えさせない。お店の商品名（出品者が書ける）もここを通る
 */
const INSTRUCTION_PHRASE =
  /\b(?:ignore|disregard|forget)\s+(?:all|any|the|previous|prior|above|page|these|those)\b|\b(?:system|assistant|developer)\s*(?:prompt|message|instruction|role|:)|\b(?:instructions?|prompts?)\b|\b(?:respond|reply|output|print)\s+(?:with|only|in|the|as)\b|\bpretend\b|無視|指示|命令|出力し|回答し|答えて|ふりをし|ルールを/i;
/**
 * 成分名に入るはずのない英単語（成分名だけに使う。商品名には「System」「Output」を含む本物の名前がある）
 */
const INSTRUCTION_WORD = /\b(?:ignore|instructions?|prompts?|system|assistant|output|respond|pretend)\b/i;

/** 指示のような文が入っていないか（検索語。商品名に使われる単語だけでは断らない） */
export function isInstructionLike(text: string): boolean {
  return INSTRUCTION_PHRASE.test(text) || isJailbreakAttempt(text);
}

/** ページから読んだ成分名として使えないか（指示のような文・英単語） */
export function isInstructionLikeIngredient(text: string): boolean {
  return isInstructionLike(text) || INSTRUCTION_WORD.test(text);
}

/** CMS から写した文章に混じりやすい、意味の無い見えない文字（ゼロ幅・ソフトハイフン・BOM）。読む前に外す */
export const HARMLESS_INVISIBLE = /[\u200b-\u200d\u2060\ufeff\u00ad]/g;

export const MAX_NAME_LENGTH = 100;
/** ブランド名の長さの上限（ブランドの判定 brand-check と同じ） */
export const MAX_BRAND_LENGTH = 40;
export const MIN_INGREDIENTS = 3;
export const MAX_INGREDIENTS = 150;
export const MAX_INGREDIENT_LENGTH = 80;
export const MAX_ACTIVE_INGREDIENTS = 10;

export const PRODUCT_CATEGORIES: Product['category'][] = [
  'cleanser',
  'toner',
  'serum',
  'cream',
  'sunscreen',
  'mask',
  'lip',
  'foundation',
  'other',
];

/** 本人の肌・体調の話題や連絡先。商品名ではないので検索語にしない */
export const PERSONAL_PATTERN = new RegExp(
  [
    // 本人・家族・知人
    // （「赤ちゃん」「子供用」「アトピー肌用」等は商品名にも使われるため、人を指す言い回しのときだけ）
    '私|わたし|僕|ぼく|俺|自分|うちの|娘|息子|妻|夫|彼氏|彼女|友達|友人|赤ちゃんが|赤ちゃんに|子供が|子どもが|子供に|子どもに',
    // 体調・症状・属性
    '肌荒れ|かゆ|痒|赤く|ヒリヒリ|症状|病院|皮膚科|治ら|治療|妊娠中|妊娠して|妊婦|授乳中|アトピーの|\\d+(?:歳|才|代)',
    // 文の言い回し（商品名には現れない）
    'です|ます|ました|でした|だった|てる|ている|使って|使った|たい|けど|ので',
  ].join('|')
);
// 区切り（空白・ハイフン・長音記号など）を挟んだ数字の並びも連絡先・番号とみなす
export const CONTACT_PATTERN = /@|https?:|www\.|〒|\d(?:[\s\-ー−‐–.]*\d){4,}/;
