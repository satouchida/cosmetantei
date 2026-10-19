import 'server-only';
import { CulpritIngredient, KnownIngredient, PriceApiCredit, Product, UserRoutineState } from '../types';
import {
  alternativeAvoidItems,
  analyzeProduct,
  findMatchingKnownIngredient,
  findSafeAlternatives,
  performDifferentialAnalysis,
} from '../analyzer/ingredient-analyzer';
import {
  AlternativeCategory,
  CATEGORY_LABELS_JA,
  categoryFromText,
  mostCommonCategory,
  productCategory,
} from '../analyzer/product-category';
import { findShopAlternatives } from './shop-alternatives';
import { findIngredientsInText } from './chat-replies';
import { productIdentityKey, researchAlternativeCandidates } from './web-research';

/**
 * 原因成分を含まない代わりの商品探し（T3）。手順: docs/plans/gemini-role-redesign.md「Phases 3 and 4」
 * - 検索語は成分DBの名前と決まった語だけで作る（利用者の文章・商品名は送らない）
 * - 候補は必ずコードで確かめる（findSafeAlternatives）。確かめられなければ代わりの商品を出さない
 */

/** 検索語に使う成分の上限（長い検索語は結果が減る） */
const MAX_QUERY_INGREDIENTS = 3;
const DEFAULT_LIMIT = 3;

export interface AlternativeRequest {
  /** 含まないことを確かめる成分。比較の候補成分は、成分DBに無い名前も含む */
  avoid: (CulpritIngredient | { nameJa: string; nameEn?: string })[];
  /** 検索語に使う成分（成分DBの項目だけ） */
  known: KnownIngredient[];
  category?: AlternativeCategory;
  /** 比較リストから作ったが、肌荒れしたコスメの種類が分からない（同数・不明）。別の種類を勧めないよう探さない */
  unknownKind?: boolean;
  /** 候補から除く製品（肌荒れしたコスメ） */
  excludeIds: string[];
  /** お店の候補から除く製品の名前（同じ製品・同じシリーズを、別のお店の商品として勧めない） */
  excludeProducts?: (Pick<Product, 'id' | 'name'> & Partial<Pick<Product, 'barcode'>>)[];
  /** お店で足りないとき、JAN コードで製品を調べてよいか（有料のことがある。既定は調べる） */
  allowPaidLookups?: boolean;
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
    excludeProducts: routine.badProducts,
  };
}

/**
 * 1つの製品の分析から（分析カードの「同じ種類で原因成分を含まない商品を探す」）。サーバーで分析をやり直し、
 * そのカードと同じ成分を避ける。種類が分からなければ探さない
 */
export function alternativeRequestFromProduct(product: Product): AlternativeRequest {
  const analysis = analyzeProduct(product);
  const avoid = alternativeAvoidItems(analysis.ingredients);
  const known: KnownIngredient[] = [];
  for (const a of avoid) {
    const k = findMatchingKnownIngredient(a.nameJa) ?? (a.nameEn ? findMatchingKnownIngredient(a.nameEn) : undefined);
    if (k && k.riskLevel !== 'safe' && !known.some((x) => x.id === k.id)) known.push(k);
  }
  const category = productCategory(product);
  return {
    avoid,
    known,
    category,
    ...(!category && { unknownKind: true }),
    excludeIds: [product.id],
    excludeProducts: [product],
  };
}

/** お店の検索語に足す決まった語（お店の商品名によく書かれる語だけ。多すぎると結果が減る） */
function shopTerms(req: AlternativeRequest): string[] {
  const terms = new Set<string>();
  for (const k of req.known) {
    if (k.category === 'fragrance' || k.category === 'essential_oil') terms.add('無香料');
    else if (k.id === 'ethanol' || k.category === 'drying_alcohol') terms.add('アルコールフリー');
    else if (k.category === 'uv_filter') terms.add('ノンケミカル');
  }
  return [...terms].slice(0, 2);
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
  /** Web で探した（キャッシュ済みの候補とお店の商品だけでは足りなかった） */
  researched: boolean;
  /** お店の商品を出すときに表示するクレジット */
  credits: PriceApiCredit[];
}

/**
 * 代わりの商品を探す。キャッシュ済みの確認済み製品から探し、足りなければお店の商品検索で探す
 * （docs/plans/alternative-recommendations.md の step 3）。それでも足りなければ（お店のキーが無い・失敗した・
 * 確かめられる商品が少ない）、Web で候補を探してから同じ確認（避ける成分・強い刺激成分を含まない、全成分が
 * 確認済み、同じ種類）をやり直す
 */
export async function findAlternatives(req: AlternativeRequest, limit = DEFAULT_LIMIT): Promise<AlternativeResult> {
  if (req.unknownKind) return { products: [], researched: false, credits: [] };
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
  if (local.length >= limit) return { products: local, researched: false, credits: [] };

  let shopProducts: Product[] = [];
  let credits: PriceApiCredit[] = [];
  if (req.category) {
    const shop = await findShopAlternatives({
      category: req.category,
      avoid: req.avoid,
      terms: shopTerms(req),
      exclude: [...(req.excludeProducts ?? []), ...local, ...req.excludeIds.map((id) => ({ id, name: '' }))],
      limit: limit - local.length,
      allowPaidLookups: req.allowPaidLookups ?? true,
    });
    shopProducts = shop.products;
    credits = shop.credits;
    if (local.length + shopProducts.length >= limit) return { products: [...local, ...shopProducts], researched: false, credits };
  }

  // お店で足りない（キーが無い・失敗した・確かめられる商品が少ない）ときは、Web で候補を探してから確かめ直す。
  // 保存済みの製品（Web で見つけた製品を含む）を先に、お店の商品を後に並べる（同じ製品は1つだけ）
  const target = `敏感肌向けの${req.category ? CATEGORY_LABELS_JA[req.category] : 'スキンケア製品'}`;
  await researchAlternativeCandidates(buildAlternativeQuery(req), target);
  const checked = check();
  const keys = new Set(checked.map((p) => productIdentityKey(p.brand, p.name)));
  const extra = shopProducts.filter((p) => !checked.some((c) => c.id === p.id) && !keys.has(productIdentityKey(p.brand, p.name)));
  const products = [...checked, ...extra].slice(0, limit);
  // クレジットは、表示するお店の商品があるときだけ
  return { products, researched: true, credits: products.some((p) => extra.includes(p)) ? credits : [] };
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
  if (fromRoutine) {
    const category = fromText?.category ?? fromRoutine.category;
    return { ...fromRoutine, category, ...(!category && { unknownKind: true }) };
  }
  return fromText;
}

/** 代わりの商品の返答（定型文。Gemini は使わない） */
export function summarizeAlternatives(req: AlternativeRequest, products: Product[]): string {
  const names = avoidedNames(req);
  if (req.unknownKind) {
    return '肌荒れしたコスメの種類が分からないため、代わりの商品を探せませんでした。「化粧水で代わりを探して」のように、種類を添えてお送りください。';
  }
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
