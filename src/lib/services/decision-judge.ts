/**
 * 成分名ごとの「はい・いいえ」を Gemini の Decisions API で判定し、KV に残す（全員で共有。同じ質問は1回だけ聞く）。
 * 鉱物油の判定（mineral-oil-judge.ts）と、成分DBに無い避けたい語の判定（avoided-word-judge.ts）が使う。
 * 判定は呼び出し側の覚え場所（analyzer）に入れる。確認は同期のまま、判定は確認の前に取ってくる。
 *
 * KV は判定のまとまり（鉱物油・避けたい語ごと）に1つの値（判定の帳面）。名前ごとに書くと、Free プランの KV の書き込み
 * （1日1,000回）を1回の依頼で使い切ることがある。読むのはまとまりごとに1回、書くのは Gemini に聞いた呼び出しごとに1回。
 * 読めなかった帳面は書かない（空の帳面で、ほかの判定を消さない）。
 * 同時に書いた依頼があれば後の書き込みが残り、先の判定はいずれ聞き直す（判定が無い名前は確かめられないので外れるだけ）
 */
import { cacheGetJSONStrict, cachePutJSON, hashedCacheKey } from '../server/cache';
import { isEvaluableIngredientName } from './dynamic-ingredient-service';
import { callGeminiDecisions, isGeminiConfigured } from './gemini-client';

/** 判定を残す期間。「分からない」は短く（次に聞けば決まることがある） */
const VERDICT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const UNSURE_TTL_MS = 24 * 60 * 60 * 1000;
/** 帳面に残す判定の数の上限（読むたびに JSON を読むので、大きくしすぎない。超えたら期限の近いものから捨てる） */
const MAX_BOOK_ENTRIES = 3000;
/** 「はい」の確率がこれ以上なら「はい」、NO 以下なら「いいえ」。その間は「分からない」（ブランドの判定と同じ） */
const YES_PROBABILITY = 0.7;
const NO_PROBABILITY = 0.3;
/** 1回の依頼で、最初に聞いてからこれを過ぎたら聞かない（遅い応答が続いても、返事を待たせすぎない） */
const ASK_BUDGET_MS = 15_000;

export interface DecisionJudgeSpec<V extends string> {
  /** 使用量の記録に使う呼び出しの目的 */
  task: string;
  /** KV のキーの版。質問・しきい値・帳面の形を変えたら上げる */
  keyPrefix: string;
  /** すべての質問に共通の入力 */
  input: string;
  /** 判定の名前（「はい」「いいえ」「分からない」） */
  verdicts: { yes: V; no: V; unsure: V };
  /** 1回の依頼で Gemini を呼ぶ回数と、1回で聞く質問の数の上限（残りは判定が無いまま＝確かめられない） */
  maxCalls: number;
  maxQuestionsPerCall: number;
  /** 判定を覚える（帳面から読んだ判定も、聞いた判定も） */
  remember: (group: string, key: string, verdict: V) => void;
}

/** key: 判定を覚える名前（まとまりの中で一意。正規化済み）。text: 質問の本文（データも含めて書き切る） */
export interface DecisionQuestion {
  key: string;
  text: string;
}

/** 判定の帳面：名前 → [判定, 期限（ミリ秒）] */
type Book = Record<string, [string, number]>;

function isBook(v: unknown): v is Book {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 期限の切れた判定を捨て、多すぎれば期限の近いものから捨てる */
function pruned(book: Book, now: number): Book {
  const live = Object.entries(book).filter(([, entry]) => Array.isArray(entry) && entry[1] > now);
  live.sort((a, b) => b[1][1] - a[1][1]);
  return Object.fromEntries(live.slice(0, MAX_BOOK_ENTRIES));
}

/**
 * 1回の依頼の分の判定。group は判定のまとまり（KV の1つの値）。Gemini を呼んだ回数を数え、失敗したら残りは聞かない
 * （判定が無い名前は確かめられないものとして外れる）。聞く回数を使い切った後も、帳面にある判定は読む
 */
export function decisionJudge<V extends string>(
  spec: DecisionJudgeSpec<V>
): (group: string, questions: readonly DecisionQuestion[]) => Promise<void> {
  const known = new Set<string>(Object.values(spec.verdicts));
  const verdictOf = (probability: number): V =>
    probability >= YES_PROBABILITY ? spec.verdicts.yes : probability <= NO_PROBABILITY ? spec.verdicts.no : spec.verdicts.unsure;
  let calls = 0;
  let failed = false;
  let firstAskAt: number | undefined;
  /** この依頼で見た質問（答えが無かった質問も、この依頼では聞き直さない） */
  const looked = new Set<string>();
  /** まとまりごとの帳面（この依頼で1回だけ読む） */
  const books = new Map<string, Promise<{ kvKey: string; book: Book; writable: boolean }>>();
  const bookOf = (group: string) => {
    let loaded = books.get(group);
    if (!loaded) {
      loaded = (async () => {
        const kvKey = await hashedCacheKey(spec.keyPrefix, group);
        try {
          const stored = await cacheGetJSONStrict<unknown>(kvKey);
          return { kvKey, book: isBook(stored) ? { ...stored } : {}, writable: true };
        } catch (err) {
          console.error('Decision book read failed:', err instanceof Error ? err.message : err);
          return { kvKey, book: {}, writable: false };
        }
      })();
      books.set(group, loaded);
    }
    return loaded;
  };
  const mayAsk = () =>
    !failed && calls < spec.maxCalls && isGeminiConfigured() && (firstAskAt === undefined || Date.now() - firstAskAt < ASK_BUDGET_MS);

  return async (group, questions) => {
    const fresh = questions.filter(({ key }) => {
      const id = `${group}\u0000${key}`;
      if (looked.has(id)) return false;
      looked.add(id);
      return true;
    });
    if (fresh.length === 0) return;
    const { kvKey, book, writable } = await bookOf(group);
    // 1. 帳面にある判定
    const now = Date.now();
    const toAsk = fresh.filter(({ key }) => {
      const entry = book[key];
      if (!Array.isArray(entry) || !(entry[1] > now) || !known.has(entry[0])) return true;
      spec.remember(group, key, entry[0] as V);
      return false;
    });
    // 2. 残りを Gemini に聞く（上限の数ずつ）。帳面は最後に1回だけ書く（途中で失敗しても、それまでの判定は書く）
    let answered = false;
    try {
      for (let start = 0; start < toAsk.length && mayAsk(); start += spec.maxQuestionsPerCall) {
        const asked = toAsk.slice(start, start + spec.maxQuestionsPerCall);
        calls++;
        firstAskAt ??= Date.now();
        const answers = await callGeminiDecisions({
          task: spec.task,
          input: spec.input,
          yesNoQuestions: Object.fromEntries(asked.map(({ text }, i) => [`q${i}`, text])),
        });
        if (!answers) {
          failed = true;
          return;
        }
        const answeredAt = Date.now();
        asked.forEach(({ key }, i) => {
          const probability = answers.get(`q${i}`);
          if (probability === undefined) return;
          const verdict = verdictOf(probability);
          spec.remember(group, key, verdict);
          book[key] = [verdict, answeredAt + (verdict === spec.verdicts.unsure ? UNSURE_TTL_MS : VERDICT_TTL_MS)];
          answered = true;
        });
      }
    } finally {
      if (answered && writable) {
        const kept = pruned(book, Date.now());
        for (const key of Object.keys(book)) if (!(key in kept)) delete book[key];
        await cachePutJSON(kvKey, kept, VERDICT_TTL_MS / 1000);
      }
    }
  };
}

/** 英語の文（指示）のような名前を聞かないための、空白で区切った語の数の上限（INCI 名は多くても4語ほど） */
const MAX_ASKED_NAME_WORDS = 4;
/**
 * 聞いてよい名前。お店の説明から取った名前は出品者が書いた文字列なので、短く、文のかな（ひらがな）を含まず、
 * 語の少ないものだけ（聞かない名前は判定が無いまま＝確かめられないので外れる）
 */
const MAX_ASKED_NAME_LENGTH = 40;
export function isAskableName(name: string): boolean {
  return (
    isEvaluableIngredientName(name) &&
    name.length <= MAX_ASKED_NAME_LENGTH &&
    !/[ぁ-ゖ]/.test(name) &&
    name.trim().split(/\s+/).length <= MAX_ASKED_NAME_WORDS
  );
}
