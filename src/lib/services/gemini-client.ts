import 'server-only';

/**
 * Gemini API 共通クライアント（Cloudflare AI Gateway 経由）
 * - Gemini の APIキーはアプリに持たず、AI Gateway の Provider Keys（Secrets Store）に保存する
 * - アプリは AI Gateway の認証トークン（cf-aig-authorization）だけを送る
 * - 応答の全テキストパートを結合（思考パートは除外）
 * - JSON 出力は responseSchema で構造化
 */

import { geminiTokenCounts, recordUsage, UsageOutcome } from '../server/usage';
import { reserveSpend, settleSpend } from '../server/spend-cap';
import { geminiPrice, tokenCostMicros } from '../server/prices';

const AI_GATEWAY_BASE = 'https://gateway.ai.cloudflare.com/v1';
const DEFAULT_TIMEOUT_MS = 20_000;

const PLACEHOLDER_PATTERN = /^YOUR_/;

export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL || 'gemini-3.8-flash';
}

/** Gemini 3.x の思考レベル（gemini-3.8-flash は low / medium / high に対応。既定は medium） */
export type ThinkingLevel = 'low' | 'medium' | 'high';
const THINKING_LEVELS: ThinkingLevel[] = ['low', 'medium', 'high'];

/**
 * 既定の思考レベル。思考トークンは出力トークンとして課金されるため、既定は low
 * （GEMINI_THINKING_LEVEL で変更可能。旧来の thinkingBudget は Gemini 3 では使わない）
 */
export function getDefaultThinkingLevel(): ThinkingLevel {
  const level = (process.env.GEMINI_THINKING_LEVEL || '').trim().toLowerCase();
  return THINKING_LEVELS.includes(level as ThinkingLevel) ? (level as ThinkingLevel) : 'low';
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
  const accountId = readEnv('CLOUDFLARE_ACCOUNT_ID');
  const gatewayId = readEnv('AI_GATEWAY_ID');
  const token = readEnv('CF_AIG_TOKEN');
  return accountId && gatewayId && token ? { accountId, gatewayId, token } : null;
}

let warnedMissingConfig = false;

/** 設定不足で Gemini が無効になっていることを、変数名だけ（値は出さない）一度だけログに出す */
function warnMissingGatewayConfigOnce(): void {
  if (warnedMissingConfig) return;
  warnedMissingConfig = true;
  const missing = ['CLOUDFLARE_ACCOUNT_ID', 'AI_GATEWAY_ID', 'CF_AIG_TOKEN'].filter((name) => !readEnv(name));
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

/** プロンプトに添える画像（base64） */
export interface GeminiImage {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  data: string;
}

export interface GeminiRequest {
  /** 何のための呼び出しか（利用量の記録に使う。chat_reply・page_read・ingredient_explain・ingredient_evaluate・ingredient_translate・label_read） */
  task: string;
  prompt: string;
  /** プロンプトの前に添える画像（成分表示の写真の読み取り等） */
  images?: GeminiImage[];
  systemInstruction?: string;
  history?: GeminiContent[];
  /**
   * URL context ツールを有効にし、プロンプト内の URL のページを読ませる。
   * Google 検索グラウンディングは使わない（Web 検索は Cloudflare Web Search で行う）
   */
  urlContext?: boolean;
  /** 指定すると JSON モード（responseMimeType: application/json）で responseSchema を適用 */
  responseSchema?: Record<string, unknown>;
  generationConfig?: Record<string, unknown>;
  /** 思考レベル。未指定なら getDefaultThinkingLevel() */
  thinkingLevel?: ThinkingLevel;
  timeoutMs?: number;
  /** AI Gateway のキャッシュを使わない（価格など、古い応答を返してはいけないもの）。画像付きは常に使わない */
  skipCache?: boolean;
  /**
   * 急がない仕事（成分の評価・翻訳）。1分あたりの上限の一部（SPEND_BACKGROUND_SHARE）だけを使い、
   * 残りをチャットの返事など利用者が待っている呼び出しのために空けておく
   */
  background?: boolean;
  /**
   * 安全フィルターの強さ（GEMINI_SAFETY_SETTINGS）。未指定は user_facing。
   * extraction はページ・写真・成分表示を書き写すだけの呼び出し（体のケア用品のページなどで止めすぎないように）
   */
  safety?: GeminiSafetyProfile;
}

export type GeminiSafetyProfile = 'user_facing' | 'extraction';

const SAFETY_CATEGORIES = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
] as const;

/**
 * 安全フィルターの設定（送らないと API の既定が使われ、モデルによっては止めない設定になる）。
 * - user_facing: 利用者に見せる文章（チャットの返事・成分の解説と評価）。嫌がらせ・差別・性的な内容は中程度から止める。
 *   危険な内容は「高」だけ（酸・ピーリング・ハイドロキノン・刺激成分のふつうの説明まで止めないように）
 * - extraction: ページ・写真の書き写し（コードが形を確かめる）。どれも「高」だけ
 * 止められた応答は blocked として返し、使用量に blocked と記録する
 */
export const GEMINI_SAFETY_SETTINGS: Record<GeminiSafetyProfile, { category: string; threshold: string }[]> = {
  user_facing: SAFETY_CATEGORIES.map((category) => ({
    category,
    threshold: category === 'HARM_CATEGORY_DANGEROUS_CONTENT' ? 'BLOCK_ONLY_HIGH' : 'BLOCK_MEDIUM_AND_ABOVE',
  })),
  extraction: SAFETY_CATEGORIES.map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' })),
};

/** 安全フィルター・禁止された内容・個人情報などで止められた終わり方（同じ入力なら、また止められる） */
const BLOCKED_FINISH_REASONS = new Set([
  'SAFETY',
  'PROHIBITED_CONTENT',
  'SPII',
  'BLOCKLIST',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
]);
/** 正常に終わった・出力の上限で切れた・著作物の引用で止められた（RECITATION は別に扱う）以外は、モデルの一時的な失敗として扱う */
const HANDLED_FINISH_REASONS = new Set(['STOP', 'MAX_TOKENS', 'RECITATION']);

export interface GeminiResult {
  text: string;
  /** 出力上限（MAX_TOKENS）で途中終了した応答か */
  truncated: boolean;
  /** URL context で読み込みに成功した URL（urlContext 指定時のみ） */
  retrievedUrls?: string[];
  /**
   * 著作物の引用に似ているとして Gemini が出力を止めた（finishReason: RECITATION）。text は空。
   * urlContext 指定時だけこの形で返す（ページを分けて読み直せるように）。それ以外は null
   */
  recitation?: boolean;
  /**
   * 安全フィルターなどで止められた（promptFeedback.blockReason、または SAFETY・PROHIBITED_CONTENT・SPII などの finishReason）。
   * text は空。入力は課金されていて、同じ入力ならまた止められる（呼び出し側は一時的な失敗と区別する）
   */
  blocked?: string;
  /** 止められたのはプロンプトそのもの（promptFeedback.blockReason）。ページを分けて読み直しても同じ */
  promptBlocked?: boolean;
}

interface UrlMetadata {
  retrievedUrl?: string;
  urlRetrievalStatus?: string;
  retrieved_url?: string;
  url_retrieval_status?: string;
}

/** URL context のメタデータから、読み込みに成功した URL を取り出す */
export function extractRetrievedUrls(data: unknown): string[] {
  const candidate = (data as { candidates?: Record<string, unknown>[] })?.candidates?.[0];
  const meta = (candidate?.urlContextMetadata ?? candidate?.url_context_metadata) as
    | { urlMetadata?: UrlMetadata[]; url_metadata?: UrlMetadata[] }
    | undefined;
  const entries = meta?.urlMetadata ?? meta?.url_metadata ?? [];
  return entries
    .filter((m) => (m.urlRetrievalStatus ?? m.url_retrieval_status) === 'URL_RETRIEVAL_STATUS_SUCCESS')
    .map((m) => m.retrievedUrl ?? m.retrieved_url)
    .filter((u): u is string => typeof u === 'string');
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

  const model = getGeminiModel();
  const generationConfig: Record<string, unknown> = { ...req.generationConfig };
  // thinkingLevel は Gemini 3 系のみ対応（2.5 系は thinkingBudget を使い、thinkingLevel を拒否する）
  if (/^gemini-3/.test(model)) {
    generationConfig.thinkingConfig = { thinkingLevel: req.thinkingLevel ?? getDefaultThinkingLevel() };
  }
  if (req.responseSchema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = req.responseSchema;
  }

  const body: Record<string, unknown> = {
    contents: [
      ...(req.history ?? []),
      {
        role: 'user',
        parts: [
          ...(req.images ?? []).map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.data } })),
          { text: req.prompt },
        ],
      },
    ],
    generationConfig,
    safetySettings: GEMINI_SAFETY_SETTINGS[req.safety ?? 'user_facing'],
  };
  if (req.systemInstruction) {
    body.systemInstruction = { parts: [{ text: req.systemInstruction }] };
  }
  if (req.urlContext) {
    body.tools = [{ urlContext: {} }];
  }

  // 有料の呼び出しの上限（全体で数える）。見積もり金額を確保し、予算を超えるなら呼ばない
  const price = geminiPrice(model, Date.now());
  const ticket = await reserveSpend('gemini', estimateGeminiCostMicros(req, price), { background: req.background });
  if (!ticket) {
    console.warn('Gemini call skipped: spend cap reached');
    await recordUsage({ kind: 'gemini', task: req.task, model, outcome: 'capped' });
    return null;
  }

  const started = Date.now();
  let data: unknown;
  let outcome: UsageOutcome = 'error';
  // 実際の金額。undefined は分からない（通信エラー・タイムアウトは課金されたかもしれないので、見積もりを残す）
  let actualMicros: number | undefined;
  // 応答が届いたか（届く前の接続の失敗は課金されていない）
  let responded = false;
  try {
    const response = await fetch(geminiEndpoint(gateway, model), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Gemini の APIキーは送らない（AI Gateway に保存されたキーが使われる）
        'cf-aig-authorization': `Bearer ${gateway.token}`,
        // 本番はプロンプト・応答本文をログに残さない（肌トラブルの相談内容を含むため）。
        // 写真は開発用の AI_GATEWAY_LOG_PAYLOAD=true でもログに残さず、ゲートウェイのキャッシュも使わない
        'cf-aig-collect-log-payload':
          !req.images?.length && process.env.AI_GATEWAY_LOG_PAYLOAD === 'true' ? 'true' : 'false',
        ...(req.images?.length || req.skipCache ? { 'cf-aig-skip-cache': 'true' } : {}),
        // ゲートウェイで再試行しない（再試行の分も課金されるが、上限には1回分しか確保していない）
        'cf-aig-max-attempts': '1',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    responded = true;

    if (!response.ok) {
      // 4xx（レート制限を含む）は課金されない。5xx・ゲートウェイのタイムアウトは生成の後に起きうるので見積もりを残す
      if (response.status < 500) actualMicros = 0;
      console.error(await describeGatewayError(response));
      return null;
    }

    data = await response.json();
    // AI Gateway のキャッシュから返った応答の usageMetadata は、元の呼び出しの値（今回は課金されない）
    outcome = response.headers.get('cf-aig-cache-status')?.toUpperCase() === 'HIT' ? 'cache_hit' : 'ok';
    actualMicros = outcome === 'cache_hit' ? 0 : geminiCostMicros(data, price);
    const text = extractResponseText(data);
    const candidate = (data as { candidates?: { finishReason?: string; safetyRatings?: { category?: string; blocked?: boolean }[] }[] })
      ?.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const blockReason = (data as { promptFeedback?: { blockReason?: string } })?.promptFeedback?.blockReason;
    // 安全フィルターなどで止められた（途中までの文章があっても使わない）。RECITATION は下で別に扱う
    const blocked = blockReason ?? (finishReason && BLOCKED_FINISH_REASONS.has(finishReason) ? finishReason : undefined);
    if (blocked) {
      if (outcome === 'ok') outcome = 'blocked';
      // 理由と分類名だけを記録する（本文は記録しない）
      const categories = (candidate?.safetyRatings ?? []).filter((r) => r.blocked).map((r) => r.category);
      console.warn(`Gemini output blocked (${blocked}${categories.length ? ` ${categories.join(',')}` : ''}) for task ${req.task}`);
      return {
        text: '',
        truncated: false,
        blocked,
        ...(blockReason && { promptBlocked: true }),
        ...(req.urlContext && { retrievedUrls: extractRetrievedUrls(data) }),
      };
    }
    // そのほかの終わり方（OTHER・MALFORMED_RESPONSE・ツールの呼び出しの失敗など）は、モデルの一時的な失敗。途中の文章は使わない
    if (finishReason && !HANDLED_FINISH_REASONS.has(finishReason)) {
      if (outcome === 'ok') outcome = 'error';
      console.warn(`Gemini stopped unexpectedly (${finishReason}) for task ${req.task}`);
      return null;
    }
    // 思考で出力の上限を使い切り、文章が無い
    if (!text && finishReason === 'MAX_TOKENS') {
      if (outcome === 'ok') outcome = 'truncated';
      console.warn(`Gemini output truncated (MAX_TOKENS) for task ${req.task}`);
      return { text: '', truncated: true, ...(req.urlContext && { retrievedUrls: extractRetrievedUrls(data) }) };
    }
    if (!text) {
      if (finishReason !== 'RECITATION') return null;
      // 入力は課金済み（キャッシュから返ったものを除く）。理由を使用量の記録に残す
      if (outcome === 'ok') outcome = 'recitation';
      console.warn(`Gemini output blocked (RECITATION) for task ${req.task}`);
      return req.urlContext ? { text: '', truncated: false, retrievedUrls: extractRetrievedUrls(data), recitation: true } : null;
    }

    const truncated = finishReason === 'MAX_TOKENS';
    if (truncated) {
      if (outcome === 'ok') outcome = 'truncated';
      console.warn(`Gemini output truncated (MAX_TOKENS) for task ${req.task}`);
    }
    return req.urlContext ? { text, truncated, retrievedUrls: extractRetrievedUrls(data) } : { text, truncated };
  } catch (err) {
    // 応答が届く前の接続の失敗（fetch の TypeError）は課金されていない。タイムアウト・本文を読む途中の失敗は課金されたかもしれないので見積もりを残す
    if (err instanceof TypeError && !responded) actualMicros = 0;
    console.error('Gemini API request failed:', err);
    return null;
  } finally {
    // 失敗した呼び出しも件数に数える（トークン数は応答があったときだけ）
    await recordUsage({
      kind: 'gemini',
      task: req.task,
      model,
      outcome,
      ...((outcome === 'ok' || outcome === 'recitation' || outcome === 'blocked' || outcome === 'truncated') &&
        geminiTokenCounts(data)),
      urlContext: req.urlContext,
      ms: Date.now() - started,
    });
    if (actualMicros !== undefined) await settleSpend(ticket, actualMicros);
  }
}

/** 見積もりの前提（実際の金額は呼び出しの後に usageMetadata で直す） */
const IMAGE_TOKENS = 2_000;
/** URL context で読む1ページあたり（ページの文章は入力として課金される） */
const URL_PAGE_TOKENS = 20_000;
/** maxOutputTokens が無い呼び出し（今は無い）の出力の見積もり */
const DEFAULT_OUTPUT_TOKENS = 8_192;

/**
 * 呼び出しの前の見積もり金額（マイクロドル）。高めに見積もる：
 * - 文字数をトークン数とみなす（日本語は1文字1トークン以下、英語はもっと少ない）
 * - 出力は maxOutputTokens いっぱい（思考トークンも maxOutputTokens に含まれる）
 * - URL context はプロンプト内の URL 1件につき URL_PAGE_TOKENS
 */
export function estimateGeminiCostMicros(req: GeminiRequest, price: { input: number; output: number }): number {
  const textChars =
    req.prompt.length +
    (req.systemInstruction?.length ?? 0) +
    (req.history ?? []).reduce((n, c) => n + c.parts.reduce((m, p) => m + p.text.length, 0), 0) +
    (req.responseSchema ? JSON.stringify(req.responseSchema).length : 0);
  const pages = req.urlContext ? Math.max(1, req.prompt.match(/https?:\/\/\S+/g)?.length ?? 0) : 0;
  const inputTokens = textChars + (req.images?.length ?? 0) * IMAGE_TOKENS + pages * URL_PAGE_TOKENS;
  const maxOutput = Number(req.generationConfig?.maxOutputTokens);
  const outputTokens = Number.isFinite(maxOutput) && maxOutput > 0 ? maxOutput : DEFAULT_OUTPUT_TOKENS;
  return tokenCostMicros(inputTokens, price.input) + tokenCostMicros(outputTokens, price.output);
}

/** 応答の usageMetadata からの実際の金額（マイクロドル）。usageMetadata が無ければ undefined（見積もりを残す） */
export function geminiCostMicros(
  data: unknown,
  price: { input: number; cachedInput: number; output: number }
): number | undefined {
  if (!(data as { usageMetadata?: unknown })?.usageMetadata) return undefined;
  const t = geminiTokenCounts(data);
  const prompt = t.promptTokens ?? 0;
  const cached = Math.min(prompt, t.cachedTokens ?? 0);
  return (
    tokenCostMicros(prompt - cached, price.input) +
    tokenCostMicros(cached, price.cachedInput) +
    tokenCostMicros((t.outputTokens ?? 0) + (t.thoughtTokens ?? 0), price.output)
  );
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
 * 構造化出力を使えない URL context 呼び出し向け
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
