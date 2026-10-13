import 'server-only';
import { CulpritIngredient, KnownIngredient, Product, UserRoutineState } from '../types';
import {
  findMatchingKnownIngredient,
  findSafeAlternatives,
  performDifferentialAnalysis,
} from '../analyzer/ingredient-analyzer';
import { findIngredientsInText } from './chat-replies';
import { productIdentityKey, researchAlternativeCandidates } from './web-research';

/**
 * 原因成分を含まない代わりの商品探し（T3）。手順: docs/plans/gemini-role-redesign.md「Phases 3 and 4」
 * - 検索語は成分DBの名前と決まった語だけで作る（利用者の文章・商品名は送らない）
 * - 候補は必ずコードで確かめる（findSafeAlternatives）。確かめられなければ代わりの商品を出さない
 */

export type AlternativeCategory = Exclude<Product['category'], 'other'>;

export const CATEGORY_LABELS_JA: Readonly<Record<AlternativeCategory, string>> = {
  cleanser: '洗顔料',
  toner: '化粧水',
  serum: '美容液',
  cream: 'クリーム',
  sunscreen: '日焼け止め',
  mask: 'パック',
  lip: 'リップ',
};

/** 文章に出てくる種類の言葉（先に一致したものを使う） */
const CATEGORY_WORDS: readonly [RegExp, AlternativeCategory][] = [
  [/洗顔|クレンジング|メイク落とし/, 'cleanser'],
  [/日焼け止め|サンスクリーン|uv/i, 'sunscreen'],
  [/化粧水|ローション|トナー/, 'toner'],
  [/美容液|セラム|エッセンス/, 'serum'],
  [/クリーム|乳液|ミルク|保湿ジェル/, 'cream'],
  [/パック|シートマスク/, 'mask'],
  [/リップ|口紅|唇/, 'lip'],
];

/** 検索語に使う成分の上限（長い検索語は結果が減る） */
const MAX_QUERY_INGREDIENTS = 3;
const DEFAULT_LIMIT = 3;

export interface AlternativeRequest {
  /** 含まないことを確かめる成分。比較の候補成分は、成分DBに無い名前も含む */
  avoid: (CulpritIngredient | { nameJa: string; nameEn?: string })[];
  /** 検索語に使う成分（成分DBの項目だけ） */
  known: KnownIngredient[];
  category?: AlternativeCategory;
  /** 候補から除く製品（肌荒れしたコスメ） */
  excludeIds: string[];
}

export function categoryFromText(text: string): AlternativeCategory | undefined {
  const t = text.normalize('NFKC');
  return CATEGORY_WORDS.find(([pattern]) => pattern.test(t))?.[1];
}

/**
 * 文章（「香料が入っていない化粧水」等）から。成分DBの成分も種類も無ければ null
 * 文章そのものは検索に使わない
 */
export function alternativeRequestFromText(text: string): AlternativeRequest | null {
  const mentioned = findIngredientsInText(text, { includeNegated: true });
  // 「セラミド配合で香料フリー」のように、避けたいと書かれた成分があれば、それだけを避ける
  const negated = mentioned.filter((k) => isNegatedInText(k, text));
  const known = negated.length > 0 ? negated : mentioned;
  const category = categoryFromText(text);
  if (known.length === 0 && !category) return null;
  return { avoid: known.map((k) => ({ nameJa: k.nameJa, nameEn: k.nameEn })), known, category, excludeIds: [] };
}

const NEGATION = /入っていない|入ってない|入らない|含まない|含まれていない|不使用|フリー|free|なし|無し|ゼロ|抜き/;
const POSITIVE = /配合|入り|入っている|入ってる|含む|使用/;
/** 名前のあとを見る範囲（「エタノールとパラベンが入っていない」のように並べた成分にも届く長さ） */
const NEGATION_WINDOW = 20;

/**
 * 「香料が入っていない」「エタノールとパラベン不使用」「無香料」のように、含まないことを求めているか。
 * 「セラミド配合で香料フリー」のセラミドは、否定の前に「配合」があるので求めていない
 */
function isNegatedInText(item: KnownIngredient, text: string): boolean {
  const t = text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  const names = [...item.nameJa.split(/[（(/／)）]/), ...item.aliases]
    .map((n) => n.normalize('NFKC').toLowerCase().replace(/\s+/g, ''))
    .filter((n) => n.length >= 2);
  return names.some((n) => {
    for (let i = t.indexOf(n); i >= 0; i = t.indexOf(n, i + 1)) {
      if (t[i - 1] === '無') return true;
      const after = t.slice(i + n.length, i + n.length + NEGATION_WINDOW);
      const neg = NEGATION.exec(after);
      if (neg && !POSITIVE.test(after.slice(0, neg.index))) return true;
    }
    return false;
  });
}

/** 肌荒れしたコスメに多い種類（「その他」は除く） */
function mostCommonCategory(products: Product[]): AlternativeCategory | undefined {
  const counts = new Map<AlternativeCategory, number>();
  for (const p of products) {
    // 決まった種類だけ（検証済みだが、検索語に入るので念のため確かめる）
    if (!Object.hasOwn(CATEGORY_LABELS_JA, p.category)) continue;
    const c = p.category as AlternativeCategory;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * 比較リストから。サーバーで比較をやり直し、その候補成分を避ける。肌荒れしたコスメが無ければ null
 */
export function alternativeRequestFromRoutine(routine: UserRoutineState | undefined): AlternativeRequest | null {
  if (!routine || routine.badProducts.length === 0) return null;
  const diff = performDifferentialAnalysis(routine.badProducts, routine.safeProducts ?? []);
  const known: KnownIngredient[] = [];
  for (const c of diff.culprits) {
    if (c.riskLevel === 'safe') continue;
    const k = findMatchingKnownIngredient(c.nameJa) ?? findMatchingKnownIngredient(c.nameEn);
    if (k && k.riskLevel !== 'safe' && !known.some((x) => x.id === k.id)) known.push(k);
  }
  return {
    avoid: diff.culprits,
    known,
    category: mostCommonCategory(routine.badProducts),
    excludeIds: routine.badProducts.map((p) => p.id),
  };
}

/** 検索語の中の成分の言い方（「無香料」「アルコールフリー」「〇〇不使用」） */
function queryTerm(k: KnownIngredient): string {
  if (k.category === 'fragrance' || k.category === 'essential_oil') return '無香料';
  if (k.id === 'ethanol') return 'アルコールフリー';
  if (k.id === 'parabens') return 'パラベンフリー';
  const short = k.nameJa.split(/[（(／/\s]/)[0].replace(/類$/, '').trim();
  return `${short}不使用`;
}

/** 検索語（成分DBの名前と決まった語だけ） */
export function buildAlternativeQuery(req: AlternativeRequest): string {
  const terms = [...new Set(req.known.map(queryTerm))].slice(0, MAX_QUERY_INGREDIENTS);
  return ['敏感肌', req.category ? CATEGORY_LABELS_JA[req.category] : 'スキンケア', ...terms, '全成分'].join(' ');
}

export interface AlternativeResult {
  products: Product[];
  /** Web で探した（キャッシュ済みの候補だけでは足りなかった） */
  researched: boolean;
}

/**
 * 代わりの商品を探す。キャッシュ済みの確認済み製品から探し、足りなければ Web で候補を探してから、
 * 同じ確認（避ける成分・強い刺激成分を含まない、全成分が確認済み、同じ種類）をやり直す
 */
export async function findAlternatives(req: AlternativeRequest, limit = DEFAULT_LIMIT): Promise<AlternativeResult> {
  // 同じ製品がブランド表記違いで重複して登録されていることがあるため、多めに取って1件にまとめる
  const check = () => {
    const unique: Product[] = [];
    const seen = new Set<string>();
    for (const p of findSafeAlternatives(req.avoid, req.excludeIds, limit * 4, { category: req.category })) {
      const key = productIdentityKey(p.brand, p.name);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(p);
    }
    return unique.slice(0, limit);
  };
  const local = check();
  if (local.length >= limit) return { products: local, researched: false };

  const target = `敏感肌向けの${req.category ? CATEGORY_LABELS_JA[req.category] : 'スキンケア製品'}`;
  await researchAlternativeCandidates(buildAlternativeQuery(req), target);
  return { products: check(), researched: true };
}

/** 返答で見せる、避けた成分の名前（最大3つ） */
export function avoidedNames(req: AlternativeRequest): string[] {
  const names = req.avoid
    .filter((a) => !('riskLevel' in a) || a.riskLevel !== 'safe')
    .map((a) => a.nameJa.split(/[（(]/)[0].trim().slice(0, 30))
    .filter(Boolean);
  return [...new Set(names)].slice(0, 3);
}

/**
 * 依頼の内容を決める。文章に成分DBの成分があればそれを避ける。無ければ比較リストの候補成分を避け、
 * 種類は文章で指定されていればそれを使う。どちらも無ければ null
 */
export function alternativeRequest(text: string, routine: UserRoutineState | undefined): AlternativeRequest | null {
  const fromText = alternativeRequestFromText(text);
  if (fromText && fromText.known.length > 0) return fromText;
  const fromRoutine = alternativeRequestFromRoutine(routine);
  if (fromRoutine) return { ...fromRoutine, category: fromText?.category ?? fromRoutine.category };
  return fromText;
}

/** 代わりの商品の返答（定型文。Gemini は使わない） */
export function summarizeAlternatives(req: AlternativeRequest, products: Product[]): string {
  const names = avoidedNames(req);
  const kind = req.category ? CATEGORY_LABELS_JA[req.category] : 'コスメ';
  const subject = names.length > 0 ? `「${names.join('、')}」を含まない${kind}` : `刺激になりやすい成分を含まない${kind}`;
  if (products.length === 0) {
    return [
      `${subject}は、全成分を確認できた商品の中からは見つかりませんでした。`,
      names.length > 0
        ? `商品を選ぶときは、パッケージの全成分表示に「${names.join('」「')}」が無いかをご確認ください。`
        : '商品を選ぶときは、パッケージの全成分表示をご確認ください。',
    ].join('\n\n');
  }
  return [
    `${subject}を${products.length}件見つけました。全成分を確認でき、${names.length > 0 ? 'これらの成分や' : ''}強い刺激になりやすい成分が入っていない商品だけを表示しています。`,
    '肌に合うかは人によって違います。初めて使うときは少量から試してください。',
  ].join('\n\n');
}
