/**
 * 有料の呼び出しの単価（予算の上限の見積もりと精算に使う。src/lib/server/spend-cap.ts）
 * 値と確認日は docs/walkthroughs/2026-10-14-cost-tracking.md の「Budget」。値上げ・モデル変更のときはここを直す
 * 1M トークンあたりの USD は、1トークンあたりのマイクロドルと同じ数になる
 */

export interface TokenPrice {
  /** 入力（URL context で読んだページを含む） */
  input: number;
  /** 暗黙のキャッシュに当たった入力 */
  cachedInput: number;
  /** 出力（思考トークンを含む） */
  output: number;
}

/** Gemini（ai.google.dev/gemini-api/docs/pricing の Standard、有料枠）。from は UTC の日付 */
const GEMINI_PRICES: Record<string, { from: string; price: TokenPrice }[]> = {
  'gemini-3.8-flash': [
    { from: '2000-01-01', price: { input: 0.75, cachedInput: 0.075, output: 3.75 } },
    { from: '2027-01-01', price: { input: 1.5, cachedInput: 0.15, output: 7.5 } },
  ],
};

/** 表に無いモデル。高めに見積もって予算を超えないようにする（モデルを変えたら表に足す） */
export const UNKNOWN_GEMINI_PRICE: TokenPrice = { input: 5, cachedInput: 5, output: 30 };

let warnedUnknownModel = false;

export function geminiPrice(model: string, now: number): TokenPrice {
  const steps = GEMINI_PRICES[model];
  if (!steps) {
    if (!warnedUnknownModel) {
      warnedUnknownModel = true;
      console.warn(`No price for Gemini model ${model}; the spend cap counts it at a high price. Add it to prices.ts.`);
    }
    return UNKNOWN_GEMINI_PRICE;
  }
  const today = new Date(now).toISOString().slice(0, 10);
  let price = steps[0].price;
  for (const step of steps) if (step.from <= today) price = step.price;
  return price;
}

/** Workers AI の入力単価（developers.cloudflare.com/workers-ai/platform/pricing/）。Clef は出力の課金なし */
const WORKERS_AI_INPUT_PRICES: Record<string, number> = {
  '@cf/cloudflare/clef': 0.24,
  '@cf/cloudflare/clef-omni': 0.15,
  '@cf/cloudflare/clef-flash': 0.038,
};

/** 表に無いモデル（高めに見積もる。出力のあるモデルかもしれないので、出力の分も足す） */
const UNKNOWN_WORKERS_AI_PRICE = { input: 2, output: 10, outputTokens: 1_000 };

/** Workers AI 1回の見積もり（マイクロドル）。入力の文字数をトークン数とみなす */
export function workersAiCostMicros(model: string, inputChars: number): number {
  const input = WORKERS_AI_INPUT_PRICES[model];
  if (input !== undefined) return tokenCostMicros(inputChars, input);
  const p = UNKNOWN_WORKERS_AI_PRICE;
  return tokenCostMicros(inputChars, p.input) + tokenCostMicros(p.outputTokens, p.output);
}

/**
 * Web 検索1回のマイクロドル。AI Gateway のクレジット払い（定価そのまま）に、クレジット購入時の手数料 5% を含める
 * （Exa $7.00・Linkup $5.00 / 1,000 searches。docs/plans/gemini-role-redesign.md）
 */
export const WEB_SEARCH_COST_MICROS: Record<'exa' | 'linkup', number> = {
  exa: 7_350,
  linkup: 5_250,
};

/** トークン数 × 1M あたりの USD → マイクロドル（切り上げ） */
export function tokenCostMicros(tokens: number, pricePerMillion: number): number {
  return Math.ceil(Math.max(0, tokens) * pricePerMillion);
}
