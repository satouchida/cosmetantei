import 'server-only';
import { CulpritIngredient, KnownIngredient, PriceApiCredit, Product, UserRoutineState } from '../types';
import { analyzeProduct } from '../analyzer/ingredient-analyzer';
import { findMatchingKnownIngredient } from '../analyzer/ingredient-match';
import { alternativeAvoidItems, findSafeAlternatives } from '../analyzer/alternative-gate';
import { performDifferentialAnalysis } from '../analyzer/differential-analysis';
import {
  AlternativeCategory,
  CATEGORY_LABELS_JA,
  categoryFromText,
  mostCommonCategory,
  mostCommonSubKind,
  productCategory,
  productSubKind,
  SubKind,
  subKindFromText,
} from '../analyzer/product-category';
import { FormProfile, formProfile, mostCommonForm } from '../analyzer/product-form';
import { findShopAlternatives, shopFormWord, ShopAlternativeResult, ShopSearchCounts } from './shop-alternatives';
import { findIngredientsInText } from './chat-replies';
import { researchAlternativeCandidates } from './web-research';
import { isSameProduct, productIdentityKey, ProductIdentity, registeredMatcher } from '../search/product-identity';

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
  /** 種類の中の下位の種類（クレンジング・乳液・ハンドクリーム等）。名前・文章の語から。無ければ今までどおり */
  subKind?: SubKind;
  /** 形・使う場所（ミスト・顔用・SPF 等。名前・文章の語から。並べ替えとお店の検索語に使う。名前そのものは持たない） */
  profile?: FormProfile;
  /** 比較リストから作ったが、肌荒れしたコスメの種類が分からない（同数・不明）。別の種類を勧めないよう探さない */
  unknownKind?: boolean;
  /** 候補から除く製品の ID（分析した製品・比較リストに登録した製品） */
  excludeIds: string[];
  /**
   * 候補から除く製品。別の表記で保存された同じ製品（JAN コード・ブランドと名前）も除き、お店の商品は同じシリーズも除く
   */
  excludeProducts?: ProductIdentity[];
  /** お店で足りないとき、JAN コードで製品を調べてよいか（有料のことがある。既定は調べる） */
  allowPaidLookups?: boolean;
}

/** 文や句の切れ目（読点・句点・改行と、理由や逆接でつなぐ語） */
const CLAUSE_BREAK = /[、。,.!?！？\n]|ので|けど|けれど|から(?!だ)|のに/;

/** 文章のうち、その種類の語がある部分（無ければ空）。同じ種類の語が続けて出るときは最後の部分（頼みごとは後ろに来る） */
function clauseNaming(text: string, category: AlternativeCategory | undefined): string {
  if (!category) return '';
  const clauses = text.normalize('NFKC').split(CLAUSE_BREAK);
  return clauses.findLast((c) => categoryFromText(c) === category) ?? '';
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
  // 下位の種類と形は、探す種類を書いた部分だけから読む（「ボディミルクで荒れたので化粧水を探して」の
  // 「ボディ」で、からだ用の化粧水だけを探さない）
  const clause = clauseNaming(text, category);
  const subKind = subKindFromText(category, clause);
  return {
    avoid: known.map((k) => ({ nameJa: k.nameJa, nameEn: k.nameEn })),
    known,
    category,
    ...(subKind && { subKind }),
    profile: formProfile(clause, category),
    excludeIds: [],
  };
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
  const registered = [...routine.badProducts, ...(routine.safeProducts ?? []), ...(routine.currentlyUsing ?? [])];
  const known: KnownIngredient[] = [];
  for (const c of diff.culprits) {
    if (c.riskLevel === 'safe') continue;
    const k = findMatchingKnownIngredient(c.nameJa) ?? findMatchingKnownIngredient(c.nameEn);
    if (k && k.riskLevel !== 'safe' && !known.some((x) => x.id === k.id)) known.push(k);
  }
  const category = mostCommonCategory(routine.badProducts);
  const subKind = mostCommonSubKind(routine.badProducts, category);
  // 形は肌荒れしたコスメに多い形だけ（使う場所・SPF は比べない）
  const form = mostCommonForm(routine.badProducts, category);
  return {
    avoid: diff.culprits,
    known,
    category,
    ...(subKind && { subKind }),
    ...(form && { profile: { form } }),
    // 登録した製品（肌荒れした・使えるコスメ）は勧めない
    excludeIds: registered.map((p) => p.id),
    excludeProducts: registered,
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
  const subKind = productSubKind(product);
  return {
    avoid,
    known,
    category,
    ...(subKind && { subKind }),
    profile: formProfile(product.name, category),
    ...(!category && { unknownKind: true }),
    excludeIds: [product.id],
    excludeProducts: [product],
  };
}

/**
 * お店の検索語に足す決まった語（お店の商品名によく書かれる語だけ。多すぎると結果が減る）。
 * scripts/eval-alternatives.mts も、本番と同じ語で測るためにこれを使う
 */
export function shopTerms(req: Pick<AlternativeRequest, 'known'>): string[] {
  const terms = new Set<string>();
  for (const k of req.known) {
    if (k.category === 'fragrance' || k.category === 'essential_oil') terms.add('無香料');
    else if (k.id === 'ethanol' || k.category === 'drying_alcohol') terms.add('アルコールフリー');
    else if (k.category === 'uv_filter') terms.add('ノンケミカル');
  }
  return [...terms].slice(0, 2);
}

/**
 * お店に送る決まった語。成分の語（shopTerms）と、形の語（日焼け止め・洗顔料・クリームで、検索の名前に形が無いとき）。
 * 合わせて2つまでで、形の語は成分の語の2つ目と入れ替える
 */
function shopWordsFor(req: AlternativeRequest): string[] {
  const terms = shopTerms(req);
  const form = req.category && shopFormWord(req.category, req.subKind, req.profile?.form);
  return form ? [...terms.slice(0, 1), form] : terms;
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
  /** お店で確かめた数の要約（返答で、少ししか出せなかった理由を言うため）。お店に聞かなかったときは null（ログの shop と同じ） */
  shopCheck: ShopCheckSummary | null;
}

/**
 * お店で確かめた数の要約（docs/plans/alternative-search-improvements.md「Path 8」）。数だけで、商品名・ブランド・JAN コード・
 * お店の文は入れない。ShopSearchCounts から作る（新しい呼び出しは無い）
 */
export interface ShopCheckSummary {
  /** 成分を確かめに進んだ候補の数（counts.checked） */
  checked: number;
  /**
   * そのうち、全成分表示を読めた数（checked − dropped.noList）。noList は確かめた後にだけ数え、checked は確かめた後に落とした数・
   * shown・notShown の合計なので、これは noList 以外で確かめた後に落とした数・shown・notShown の合計になる。
   * 見つけた製品と同じ JAN コードの出品（duplicate。その出品の説明は読まない）も入る（同じ製品の全成分は読めている）
   */
  readable: number;
  /**
   * 読めた一覧に、避ける成分（suspect）・強い刺激成分（irritant）・化粧品基準でこの種類に配合できない成分（standard）があった数。
   * unrated（評価できた成分が少ないだけ）・duplicate・excluded・otherKind は成分で外したのではないので数えない
   */
  rejected: number;
}

export function shopCheckSummary(counts: ShopSearchCounts): ShopCheckSummary {
  const { noList, suspect, irritant, standard } = counts.dropped;
  return { checked: counts.checked, readable: counts.checked - noList, rejected: suspect + irritant + standard };
}

/**
 * 代わりの商品を探す。キャッシュ済みの確認済み製品から探し、足りなければお店の商品検索で探す
 * （docs/plans/alternative-recommendations.md の step 3）。それでも足りなければ（お店のキーが無い・失敗した・
 * 確かめられる商品が少ない）、Web で候補を探してから同じ確認（避ける成分・強い刺激成分を含まない、全成分が
 * 確認済み、同じ種類）をやり直す
 */
export async function findAlternatives(req: AlternativeRequest, limit = DEFAULT_LIMIT): Promise<AlternativeResult> {
  const terms = shopWordsFor(req);
  let saved = 0;
  let shopLog: AlternativesLog['shop'] = null;
  // shopCheck はログの shop と同じときに null（お店に聞かなかった）
  const done = (result: Omit<AlternativeResult, 'shopCheck'>, answeredBy: AlternativesLog['answeredBy']): AlternativeResult => {
    logAlternatives({
      kind: req.unknownKind ? 'unknown' : (req.category ?? 'any'),
      subKind: req.subKind ?? null,
      // 確認で避けない成分（低刺激と判定済み）は数えない
      avoid: req.avoid.filter((a) => !('riskLevel' in a) || a.riskLevel !== 'safe').length,
      terms,
      saved,
      answeredBy,
      shown: result.products.length,
      shop: shopLog,
    });
    return { ...result, shopCheck: shopLog && shopCheckSummary(shopLog) };
  };
  if (req.unknownKind) return done({ products: [], researched: false, credits: [] }, 'none');
  // 同じ製品がブランド表記違い・カタカナと英字の書き分けで重複して登録されていることがあるため、多めに取って1件にまとめる
  const check = () => {
    const unique: Product[] = [];
    const seen = new Set<string>();
    const options = { category: req.category, subKind: req.subKind, profile: req.profile };
    for (const p of findSafeAlternatives(req.avoid, [...req.excludeIds, ...(req.excludeProducts ?? [])], limit * 4, options)) {
      const key = productIdentityKey(p.brand, p.name);
      if (seen.has(key) || unique.some((u) => isSameProduct(u, p))) continue;
      seen.add(key);
      unique.push(p);
    }
    return unique.slice(0, limit);
  };
  const local = check();
  saved = local.length;
  if (local.length >= limit) return done({ products: local, researched: false, credits: [] }, 'saved');

  let shopProducts: Product[] = [];
  let credits: PriceApiCredit[] = [];
  if (req.category) {
    const shop = await findShopAlternatives({
      category: req.category,
      subKind: req.subKind,
      profile: req.profile,
      avoid: req.avoid,
      terms,
      exclude: [...(req.excludeProducts ?? []), ...local, ...req.excludeIds.map((id) => ({ id, name: '' }))],
      limit: limit - local.length,
      allowPaidLookups: req.allowPaidLookups ?? true,
    });
    // お店の商品は名前の系列と JAN コードで除いてあるが、登録した製品と同じ製品（ブランドと名前）もここで除く
    const isRegistered = registeredMatcher(req.excludeProducts ?? []);
    shopProducts = shop.products.filter((p) => !isRegistered(p));
    credits = shop.credits;
    shopLog = { status: shop.status, ...shop.counts };
    if (local.length + shopProducts.length >= limit) return done({ products: [...local, ...shopProducts], researched: false, credits }, 'shop');
  }

  // お店で足りない（キーが無い・失敗した・確かめられる商品が少ない）ときは、Web で候補を探してから確かめ直す。
  // 保存済みの製品（Web で見つけた製品を含む）を先に、お店の商品を後に並べる（同じ製品は1つだけ）
  const target = `敏感肌向けの${req.category ? CATEGORY_LABELS_JA[req.category] : 'スキンケア製品'}`;
  await researchAlternativeCandidates(buildAlternativeQuery(req), target);
  const checked = check();
  const keys = new Set(checked.map((p) => productIdentityKey(p.brand, p.name)));
  const extra = shopProducts.filter((p) => !keys.has(productIdentityKey(p.brand, p.name)) && !checked.some((c) => isSameProduct(c, p)));
  const products = [...checked, ...extra].slice(0, limit);
  const fromShop = products.some((p) => extra.includes(p));
  // 答えたのは、表示した製品を足した最後の段（Web で保存された製品 → お店 → もとから保存済み）
  const answeredBy = products.some((p) => !extra.includes(p) && !local.some((l) => l.id === p.id))
    ? 'web'
    : fromShop
      ? 'shop'
      : products.length > 0
        ? 'saved'
        : 'none';
  // クレジットは、表示するお店の商品があるときだけ
  return done({ products, researched: true, credits: fromShop ? credits : [] }, answeredBy);
}

/**
 * 1回の代わりの商品探しのログ（[alternatives]）。種類ごとに、どこで候補が減ったかを数えるため
 * （docs/plans/alternative-search-improvements.md「Path 0」）。数と決まった語だけで、商品名・ブランド・JAN コード・
 * URL・お店の文・利用者の文は出さない
 */
interface AlternativesLog {
  /** unknown: 種類が分からず探さなかった / any: 種類を決めずに探した */
  kind: AlternativeCategory | 'unknown' | 'any';
  /** 下位の種類（決まった語）。無ければ null */
  subKind: SubKind | null;
  /** 避ける成分の数 */
  avoid: number;
  /** お店の検索語に足す決まった語（成分の語と形の語。依頼から決まる。お店に聞かなかったときも出す） */
  terms: string[];
  /** 保存済みの製品から見つかった数 */
  saved: number;
  answeredBy: 'saved' | 'shop' | 'web' | 'none';
  shown: number;
  /** お店に聞かなかったときは null。shop.shown は、登録した製品を除く前の数 */
  shop: ({ status: ShopAlternativeResult['status'] } & ShopSearchCounts) | null;
}

function logAlternatives(line: AlternativesLog): void {
  console.log(`[alternatives] ${JSON.stringify(line)}`);
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
    // 文章で種類を指定されたら、下位の種類も文章から（「ハンドクリームで探して」）
    const { category, subKind, profile } = fromText?.category ? fromText : fromRoutine;
    return { ...fromRoutine, category, subKind, profile, ...(!category && { unknownKind: true }) };
  }
  return fromText;
}

/** 成分表示の入力を開くボタン（ブラウザ側で処理する。quick-replies.ts） */
const LABEL_INPUT_REPLY = '📝 成分表示を入力する';

/**
 * 少ししか出せなかった理由（お店で確かめた数）を返答に書くか。limit 件そろった・お店に聞かなかった・確かめた候補が無いときは書かない
 * （種類が分からず探さなかったときは、お店に聞かないので shopCheck は null）
 */
export function explainsShortfall(shown: number, shopCheck: ShopCheckSummary | null | undefined): shopCheck is ShopCheckSummary {
  return shown < DEFAULT_LIMIT && !!shopCheck && shopCheck.checked > 0;
}

/** 少ししか出せなかった理由と、次にできること（数だけ。商品名やお店の文は書かない。どの商品も安全とは言わない） */
function shortfallParagraphs({ checked, readable, rejected }: ShopCheckSummary): string[] {
  const read =
    readable === checked
      ? `お店の商品${checked}件の全成分表示を確かめました。`
      : `お店の商品${checked}件を確かめましたが、全成分表示を読めたのは${readable}件でした。`;
  return [
    `${read}${rejected > 0 ? `そのうち${rejected}件は、避けたい成分か刺激になりやすい成分を含んでいました。` : ''}`,
    `気になる商品があれば、「${LABEL_INPUT_REPLY}」からパッケージの全成分表示を入力すると、原因候補の成分が入っていないかを確かめられます。`,
  ];
}

/** 代わりの商品の返答のボタン。少ししか出せなかった理由を書いたときは、成分表示の入力を先に（気になる商品を確かめられる） */
export function alternativeQuickReplies(products: readonly Product[], shopCheck: ShopCheckSummary | null | undefined): string[] {
  return [...(explainsShortfall(products.length, shopCheck) ? [LABEL_INPUT_REPLY] : []), '🔍 別のコスメを調べる', '📸 バーコードをスキャンする'];
}

/**
 * 代わりの商品の返答（定型文。Gemini は使わない）。shopCheck があり、limit 件に足りないときは、お店で確かめた数で理由を言う
 * （docs/plans/alternative-search-improvements.md「Path 8」）
 */
export function summarizeAlternatives(req: AlternativeRequest, products: Product[], shopCheck?: ShopCheckSummary | null): string {
  const names = avoidedNames(req);
  if (req.unknownKind) {
    return '肌荒れしたコスメの種類が分からないため、代わりの商品を探せませんでした。「化粧水で代わりを探して」のように、種類を添えてお送りください。';
  }
  const kind = req.category ? CATEGORY_LABELS_JA[req.category] : 'コスメ';
  const subject = names.length > 0 ? `「${names.join('、')}」を含まない${kind}` : `刺激になりやすい成分を含まない${kind}`;
  const shortfall = explainsShortfall(products.length, shopCheck) ? shortfallParagraphs(shopCheck) : [];
  if (products.length === 0) {
    return [
      `${subject}は、全成分を確認できた商品の中からは見つかりませんでした。`,
      ...shortfall,
      names.length > 0
        ? `商品を選ぶときは、パッケージの全成分表示に「${names.join('」「')}」が無いかをご確認ください。`
        : '商品を選ぶときは、パッケージの全成分表示をご確認ください。',
    ].join('\n\n');
  }
  return [
    `${subject}を${products.length}件見つけました。全成分を確認でき、${names.length > 0 ? 'これらの成分や' : ''}強い刺激になりやすい成分が入っていない商品だけを表示しています。`,
    ...shortfall,
    '肌に合うかは人によって違います。初めて使うときは少量から試してください。',
  ].join('\n\n');
}
