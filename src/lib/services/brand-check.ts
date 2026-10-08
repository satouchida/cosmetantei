import 'server-only';

import { BoundedCache } from '../utils/bounded-cache';
import { cacheGetJSON, cachePutJSON, hashedCacheKey, runWorkersAI } from '../server/cloudflare';

/**
 * ブランド名チェック
 * AI が生成した製品の brand 欄が、実在ブランドではなく一般名詞や検索語（「炭」「泡洗顔」「敏感肌」等）に
 * なっていないかを判定する。Gemini を毎回呼ばないよう、次の順に安いものから判定する。
 *
 * 1. 無料の語彙チェック：一般名詞だけで構成された brand は即除外
 * 2. ブランド単位のキャッシュ（メモリ → KV、90日）：一度判定したブランドは再判定しない
 * 3. 製品生成時の Gemini 自己申告（isOfficialBrand）：false なら追加呼び出しなしで除外
 * 4. 未判定のブランドだけを Cloudflare Workers AI の Clef でまとめて1回判定し、結果をキャッシュ
 *    Clef が使えない環境では、3 の自己申告を暫定的に採用する（キャッシュしない）
 */

export type BrandVerdict = 'brand' | 'generic_term' | 'not_brand';

export interface BrandCandidate {
  brand: string;
  productName: string;
  /** 製品生成時に Gemini が申告した「正式なブランド名か」（未回答なら undefined） */
  selfReportedOfficial?: boolean;
}

/** 判定結果。unverified は Clef が使えず自己申告のみで採用したもの */
export type BrandDecision = BrandVerdict | 'unverified';

const CLEF_MODEL_ID = '@cf/cloudflare/clef';
const BRAND_VERDICT_TTL_SECONDS = 60 * 60 * 24 * 90;
/** Clef の判定を採用する最低確率。これ未満は判定保留（キャッシュしない） */
const MIN_CLEF_PROBABILITY = 0.7;
/** Clef は1リクエスト最大64問 */
const MAX_CLEF_QUESTIONS = 64;
const MAX_BRAND_LENGTH = 40;

const memoryVerdicts = new BoundedCache<BrandVerdict>(5000);

/** ブランド名の正規化キー（全角半角・大文字小文字・空白記号の揺れを吸収） */
export function normalizeBrandKey(brand: string): string {
  return brand
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\-_・/\\,.、。()（）「」【】]+/g, '');
}

// アプリ内で使っている肌悩み・成分・カテゴリ・検索修飾語（detectQueryIntent / isNonCosmeticSearchQuery と同じ語彙）
const GENERIC_VOCABULARY =
  /乾燥肌|脂性肌|混合肌|敏感肌|乾燥|カサつき|かさつき|つっぱり|粉ふき|皮むけ|ニキビ|吹き出物|コメド|アクネ|赤み|赤ら顔|ヒリヒリ|ピリピリ|しみる|敏感|酒さ|かゆみ|肌荒れ|毛穴|黒ずみ|角栓|いちご鼻|テカリ|皮脂|日焼け止め|日やけ止め|日焼け|紫外線|uv|レチノール|ビタミンa|セラミド|ビタミンc|アスコルビン|cica|シカ|ツボクサ|リップクリーム|リップバーム|リップ|口紅|ルージュ|ティント|バーム|化粧水|ローション|トナー|洗顔料|洗顔フォーム|泡洗顔|洗顔|クレンジング|ウォッシュ|クリーム|乳液|ミルク|美容液|セラム|エッセンス|パック|シートマスク|マスク|ファンデーション|コスメ|スキンケア|炭酸泡|炭酸洗顔|保湿|低刺激/g;

/**
 * 1. 無料の語彙チェック（Gemini・Clef を呼ばずに判定できるもの）
 */
export function precheckBrand(brand: string): BrandVerdict | null {
  const key = normalizeBrandKey(brand);
  if (!key) return 'generic_term';
  if (key.length > MAX_BRAND_LENGTH) return 'not_brand';
  // 一般名詞を取り除くと何も残らない = 一般名詞だけで構成されている
  if (key.replace(GENERIC_VOCABULARY, '').length === 0) return 'generic_term';
  return null;
}

/**
 * 同期判定：一般名詞であることが分かっているか（語彙チェック＋メモリ上の判定結果）
 * 表示用ブランド名の決定など、非同期処理ができない箇所で使う
 */
export function isKnownGenericTerm(term: string): boolean {
  if (!term || !term.trim()) return true;
  if (precheckBrand(term) === 'generic_term') return true;
  return memoryVerdicts.get(normalizeBrandKey(term)) === 'generic_term';
}

async function getCachedVerdict(key: string): Promise<BrandVerdict | null> {
  const local = memoryVerdicts.get(key);
  if (local) return local;
  const stored = await cacheGetJSON<BrandVerdict>(await hashedCacheKey('brand:v1', key));
  if (stored) memoryVerdicts.set(key, stored);
  return stored;
}

async function saveVerdict(key: string, verdict: BrandVerdict): Promise<void> {
  memoryVerdicts.set(key, verdict);
  await cachePutJSON(await hashedCacheKey('brand:v1', key), verdict, BRAND_VERDICT_TTL_SECONDS);
}

interface ClefChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

const BRAND_VERDICTS: BrandVerdict[] = ['brand', 'generic_term', 'not_brand'];

/**
 * 4. Clef で複数ブランドをまとめて判定する（1リクエスト）。使えない場合は null
 */
async function judgeWithClef(
  items: { id: string; candidate: BrandCandidate }[],
  searchQuery: string
): Promise<Map<string, BrandVerdict> | null> {
  if (items.length === 0) return new Map();

  const questions: Record<string, unknown> = {};
  for (const { id, candidate } of items) {
    questions[id] = {
      type: 'choice',
      instructions: {
        question: '次の brand は、実在する化粧品の正式なブランド名・メーカー名・発売元ですか？',
        brand: candidate.brand,
        productName: candidate.productName,
      },
      criteria: {
        brand: '実在する化粧品のブランド名・メーカー名・発売元（例: キュレル, ちふれ, FANCL, KATE, 無印良品）',
        generic_term:
          '化粧品の一般名詞・検索語（剤形・成分・肌悩み・効果・ターゲット層など。例: 炭, 泡洗顔, 敏感肌, 保湿クリーム, メンズ）',
        not_brand: 'ブランドではない語（店舗名・人名・意味をなさない語・架空の名称など）',
      },
    };
  }

  const response = await runWorkersAI(CLEF_MODEL_ID, {
    model: 'clef',
    state: {
      task: '化粧品検索アプリで、AIが生成した製品候補の brand 欄が実在ブランドかを確認する',
      searchQuery,
      candidates: items.map(({ id, candidate }) => ({ id, brand: candidate.brand, productName: candidate.productName })),
    },
    questions,
  });
  if (!response) return null;

  const answers = (response as { answers?: Record<string, ClefChoiceAnswer> }).answers;
  if (!answers || typeof answers !== 'object') return null;

  const verdicts = new Map<string, BrandVerdict>();
  for (const { id } of items) {
    const answer = answers[id];
    if (!answer || answer.type !== 'choice' || !BRAND_VERDICTS.includes(answer.choice as BrandVerdict)) continue;
    // 確率が低い（迷っている）判定は採用しない
    const probability = answer.probabilities?.[answer.choice];
    if (typeof probability !== 'number' || probability < MIN_CLEF_PROBABILITY) continue;
    verdicts.set(id, answer.choice as BrandVerdict);
  }
  return verdicts;
}

/**
 * 製品候補の brand を判定する。戻り値は候補と同じ順序の判定結果
 * - 'brand' / 'unverified' の候補のみ表示してよい
 */
export async function judgeBrands(candidates: BrandCandidate[], searchQuery: string): Promise<BrandDecision[]> {
  const decisions: (BrandDecision | undefined)[] = new Array(candidates.length);
  // 同じブランドは1問にまとめる
  const pending = new Map<string, { id: string; candidate: BrandCandidate; indexes: number[] }>();

  for (const [index, candidate] of candidates.entries()) {
    // 1. 語彙チェック
    const pre = precheckBrand(candidate.brand);
    if (pre) {
      decisions[index] = pre;
      continue;
    }

    // 2. キャッシュ
    const key = normalizeBrandKey(candidate.brand);
    const cached = await getCachedVerdict(key);
    if (cached) {
      decisions[index] = cached;
      continue;
    }

    // 3. 生成時の自己申告で「ブランドではない」なら追加の判定なしで除外
    if (candidate.selfReportedOfficial === false) {
      decisions[index] = 'not_brand';
      continue;
    }

    const entry = pending.get(key);
    if (entry) {
      entry.indexes.push(index);
    } else if (pending.size < MAX_CLEF_QUESTIONS) {
      pending.set(key, { id: `b${pending.size}`, candidate, indexes: [index] });
    }
  }

  // 4. 未判定のブランドを Clef でまとめて判定
  const items = [...pending.values()];
  const clefVerdicts = await judgeWithClef(items, searchQuery);

  for (const [key, item] of pending) {
    const verdict = clefVerdicts?.get(item.id);
    if (verdict) await saveVerdict(key, verdict);
    for (const index of item.indexes) {
      // Clef が使えない・判定保留の場合は自己申告を暫定採用（キャッシュしない）
      decisions[index] = verdict ?? (item.candidate.selfReportedOfficial ? 'unverified' : 'not_brand');
    }
  }

  // 64問を超えた分など、判定できなかった候補は採用しない
  return decisions.map((d) => d ?? 'not_brand');
}

export function isAcceptedBrand(decision: BrandDecision): boolean {
  return decision === 'brand' || decision === 'unverified';
}
