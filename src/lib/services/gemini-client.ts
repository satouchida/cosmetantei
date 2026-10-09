import 'server-only';

/**
 * Gemini API 共通クライアント（Cloudflare AI Gateway 経由）
 * - Gemini の APIキーはアプリに持たず、AI Gateway の Provider Keys（Secrets Store）に保存する
 * - アプリは AI Gateway の認証トークン（cf-aig-authorization）だけを送る
 * - 応答の全テキストパートを結合（思考パートは除外）
 * - JSON 出力は responseSchema で構造化
 */

const AI_GATEWAY_BASE = 'https://gateway.ai.cloudflare.com/v1';
const DEFAULT_TIMEOUT_MS = 20_000;

const PLACEHOLDER_PATTERN = /^YOUR_/;

export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL || 'gemini-3.8-flash';
}

interface GatewayConfig {
  accountId: string;
  gatewayId: string;
  token: string;
}

function readEnv(name: string): string {
  const value = (process.env[name] || '').trim();
  return PLACEHOLDER_PATTERN.test(value) ? '' : value;
}

/** AI Gateway の接続設定。いずれかが未設定・プレースホルダーなら null */
function getGatewayConfig(): GatewayConfig | null {
  const accountId = readEnv('CF_ACCOUNT_ID');
  const gatewayId = readEnv('AI_GATEWAY_ID');
  const token = readEnv('CF_AIG_TOKEN');
  return accountId && gatewayId && token ? { accountId, gatewayId, token } : null;
}

let warnedMissingConfig = false;

/** 設定不足で Gemini が無効になっていることを、変数名だけ（値は出さない）一度だけログに出す */
function warnMissingGatewayConfigOnce(): void {
  if (warnedMissingConfig) return;
  warnedMissingConfig = true;
  const missing = ['CF_ACCOUNT_ID', 'AI_GATEWAY_ID', 'CF_AIG_TOKEN'].filter((name) => !readEnv(name));
  console.warn('Gemini disabled: AI Gateway config missing or placeholder:', missing.join(', '));
}

/** Gemini を呼び出せる設定が揃っているか（AI Gateway のアカウントID・ゲートウェイID・トークン） */
export function isGeminiConfigured(): boolean {
  return getGatewayConfig() !== null;
}

/** AI Gateway 経由の Gemini generateContent エンドポイント */
export function geminiEndpoint(config: { accountId: string; gatewayId: string }, model: string): string {
  return `${AI_GATEWAY_BASE}/${encodeURIComponent(config.accountId)}/${encodeURIComponent(
    config.gatewayId
  )}/google-ai-studio/v1beta/models/${encodeURIComponent(model)}:generateContent`;
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
  const gateway = getGatewayConfig();
  if (!gateway) {
    warnMissingGatewayConfigOnce();
    return null;
  }

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
    const response = await fetch(geminiEndpoint(gateway, getGeminiModel()), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Gemini の APIキーは送らない（AI Gateway に保存されたキーが使われる）
        'cf-aig-authorization': `Bearer ${gateway.token}`,
        // 本番はプロンプト・応答本文をログに残さない（肌トラブルの相談内容を含むため）
        'cf-aig-collect-log-payload': process.env.AI_GATEWAY_LOG_PAYLOAD === 'true' ? 'true' : 'false',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(await describeGatewayError(response));
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
 * エラー応答のログ文言。原因の切り分けができるよう種類と Google のエラーコードは常に出し、
 * 本文（プロンプトの一部を含み得る）は開発用ゲートウェイ（AI_GATEWAY_LOG_PAYLOAD=true）のときだけ出す
 */
async function describeGatewayError(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  const kind =
    response.status === 401
      ? 'AI Gateway auth failed (check CF_AIG_TOKEN)'
      : response.status === 429
      ? 'AI Gateway or Gemini rate limited'
      : 'Gemini API error';

  let errorCode = '';
  try {
    const parsed = JSON.parse(body) as { error?: { status?: unknown } };
    if (typeof parsed?.error?.status === 'string') errorCode = parsed.error.status;
  } catch {
    // Gemini 以外（ゲートウェイ等）のエラー本文
  }

  const detail = process.env.AI_GATEWAY_LOG_PAYLOAD === 'true' ? ` ${body.slice(0, 500)}` : '';
  return `${kind}: ${response.status}${errorCode ? ` ${errorCode}` : ''}${detail}`;
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
