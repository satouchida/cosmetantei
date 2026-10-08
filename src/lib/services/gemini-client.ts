import 'server-only';

/**
 * Gemini API 共通クライアント
 * - APIキーはURLではなく x-goog-api-key ヘッダーで送信
 * - 応答の全テキストパートを結合（思考パートは除外）
 * - JSON 出力は responseSchema で構造化
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_TIMEOUT_MS = 20_000;

const PLACEHOLDER_KEY_PATTERNS = [/^YOUR_GEMINI_API_KEY/, /^AIzaSy_YOUR/];

export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL || 'gemini-3.8-flash';
}

function getGeminiApiKey(): string {
  return (process.env.GEMINI_API_KEY || '').trim();
}

/** 本物のAPIキーが設定されているか（未設定・プレースホルダーは false） */
export function hasGeminiKey(): boolean {
  const key = getGeminiApiKey();
  return key.length > 0 && !PLACEHOLDER_KEY_PATTERNS.some((p) => p.test(key));
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: { text: string }[];
}

export interface GeminiRequest {
  prompt: string;
  systemInstruction?: string;
  history?: GeminiContent[];
  /** Google検索グラウンディングを有効にする */
  grounding?: boolean;
  /** 指定すると JSON モード（responseMimeType: application/json）で responseSchema を適用 */
  responseSchema?: Record<string, unknown>;
  generationConfig?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface GeminiResult {
  text: string;
  /** 出力上限（MAX_TOKENS）で途中終了した応答か */
  truncated: boolean;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

/** 応答候補の全テキストパートを結合する（思考パートは除外） */
export function extractResponseText(data: unknown): string {
  const parts: GeminiPart[] =
    (data as { candidates?: { content?: { parts?: GeminiPart[] } }[] })?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
    .trim();
}

/**
 * Gemini を呼び出して応答テキストを返す。キー未設定・エラー・空応答時は null
 */
export async function callGemini(req: GeminiRequest): Promise<GeminiResult | null> {
  if (!hasGeminiKey()) return null;

  const generationConfig: Record<string, unknown> = { ...req.generationConfig };
  if (req.responseSchema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = req.responseSchema;
  }

  const body: Record<string, unknown> = {
    contents: [...(req.history ?? []), { role: 'user', parts: [{ text: req.prompt }] }],
    generationConfig,
  };
  if (req.systemInstruction) {
    body.systemInstruction = { parts: [{ text: req.systemInstruction }] };
  }
  if (req.grounding) {
    body.tools = [{ googleSearch: {} }];
  }

  try {
    const response = await fetch(
      `${GEMINI_API_BASE}/${encodeURIComponent(getGeminiModel())}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': getGeminiApiKey(),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      }
    );

    if (!response.ok) {
      console.error('Gemini API error:', response.status, (await response.text()).slice(0, 500));
      return null;
    }

    const data = await response.json();
    const text = extractResponseText(data);
    if (!text) return null;

    const finishReason = (data as { candidates?: { finishReason?: string }[] })?.candidates?.[0]?.finishReason;
    const truncated = finishReason === 'MAX_TOKENS';
    if (truncated) console.warn('Gemini output truncated (MAX_TOKENS)');
    return { text, truncated };
  } catch (err) {
    console.error('Gemini API request failed:', err);
    return null;
  }
}

/**
 * JSON モードで呼び出し、パース済みオブジェクトを返す。失敗時は null
 */
export async function callGeminiJSON<T>(req: GeminiRequest & { responseSchema: Record<string, unknown> }): Promise<T | null> {
  const result = await callGemini(req);
  // 途中で切れた JSON は不完全なので使わない
  if (!result || result.truncated) return null;
  return parseJsonLoose<T>(result.text);
}

/**
 * モデル出力からJSONを取り出す（そのまま → コードブロック内 → 最初と最後の括弧の範囲 の順に試す）
 * 構造化出力を使えないグラウンディング呼び出し向け
 */
export function parseJsonLoose<T>(text: string): T | null {
  const candidates: string[] = [text.trim()];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());

  for (const [open, close] of [
    ['[', ']'],
    ['{', '}'],
  ]) {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // 次の候補を試す
    }
  }
  return null;
}
