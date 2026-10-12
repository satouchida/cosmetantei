/**
 * チャット入力の無料ガード（明白な無関係トピック・指示の書き換え）と、AI 出力の書式フィルター
 */

/**
 * マークダウンの太字（**text**）やイタリック（*text*）の書式を強制除去・置換するフィルター
 */
export function stripMarkdownEmphasis(text: string): string {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '「$1」') // **強調** を 「」 に変換
    .replace(/__(.*?)__/g, '「$1」')
    .replace(/\*(.*?)\*/g, '$1')         // *斜体* を通常テキストに変換
    .replace(/_(.*?)_/g, '$1');
}

// 明らかな無関係トピック（Gemini呼び出し前に無料で拒否する）
// 英単語は単語境界つきで判定し、「Dandelion」「redundant」などの成分名・一般語を誤って弾かないようにする
const OFF_TOPIC_PATTERNS = [
  /\b(python|javascript|typescript|java|html|css|sql|docker|kubernetes)\b|c\+\+/i,
  /コードを書いて|プログラムを書いて|関数を書いて|アルゴリズム|バグを修正/,
  /小説を書いて|エッセイを書いて|詩を作って|歌詞を書いて|物語を書いて/,
  /翻訳して|英語に訳して|中国語に訳して|\btranslate\b/i,
  /政治|大統領|総理大臣|株価|暗号資産|仮想通貨|ビットコイン/,
  /数学|方程式|積分|微分|計算して/,
];
// 指示の書き換え・システム設定の聞き出し（ジェイルブレイク）。チャットゲートでも、Clef の判定に関係なく拒否する
const JAILBREAK_PATTERN =
  /ignore (all )?(the )?previous instructions|\bsystem prompt\b|\bjailbreak\b|(これまで|今まで|以前|上記|(?<![ぁ-んァ-ヶ一-龠々])前)の(指示|命令|設定|ルール)を(すべて|全て)?(無視|忘れ)|システムプロンプト/i;
// 「DAN」ジェイルブレイクは大文字の単語のみを対象にする（大文字小文字を区別）
const DAN_JAILBREAK_PATTERN = /\bDAN\b/;

export function isJailbreakAttempt(text: string): boolean {
  return JAILBREAK_PATTERN.test(text) || DAN_JAILBREAK_PATTERN.test(text);
}

/**
 * 明らかに化粧品・スキンケアと無関係な入力を判定（Gemini呼び出し前の無料フィルター）
 * ここで弾くのは明白な無関係トピックのみ。境界的な話題はチャットゲート（Clef）に任せる
 */
export function isCosmeticTopicRelevant(userText: string, hasContextData: boolean): boolean {
  if (hasContextData) return true;
  const text = userText.trim();
  if (text.length <= 1) return false;

  if (isJailbreakAttempt(text)) return false;
  return !OFF_TOPIC_PATTERNS.some((pattern) => pattern.test(text));
}

/** 化粧品と無関係な相談・指示の書き換えを断る定型文 */
export const OFF_TOPIC_REPLY_JA =
  '申し訳ありません。コスメ探偵は化粧品成分・スキンケア分析専用のAIアシスタントです。化粧品名や成分、肌荒れ・スキンケアに関するご相談をお聞かせください。';
