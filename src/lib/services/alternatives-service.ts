import 'server-only';
import { CulpritIngredient, KnownIngredient, PriceApiCredit, Product, UserRoutineState } from '../types';
import { analyzeProduct } from '../analyzer/ingredient-analyzer';
import { findMatchingKnownIngredient, labelIngredients } from '../analyzer/ingredient-match';
import { alternativeAvoidItems, avoidedIngredients, findSafeAlternatives, fitsKind, hasVerifiedIngredients } from '../analyzer/alternative-gate';
import { performDifferentialAnalysis } from '../analyzer/differential-analysis';
import {
  AlternativeCategory,
  candidateSubKind,
  categoryFromText,
  kindLabel,
  mostCommonCategory,
  mostCommonSubKind,
  productCategory,
  productSubKind,
  SubKind,
  subKindFit,
  subKindFromText,
} from '../analyzer/product-category';
import { FORM_LABELS_JA, formFromText, FormProfile, formProfile, mostCommonForm, ProductForm } from '../analyzer/product-form';
import { findShopAlternatives, shopFormWord, shopSearchLabel, ShopAlternativeResult, ShopSearchCounts } from './shop-alternatives';
import { coveredIngredientGroups, findIngredientsInText, inIngredientGroup, INGREDIENT_GROUP_WORDS, standaloneGroupWord } from './chat-replies';
import { researchAlternativeCandidates } from './web-research';
import { mineralOilJudge } from './mineral-oil-judge';
import { avoidedWordJudge } from './avoided-word-judge';
import { kindWordJudge } from './kind-word-judge';
import { classifyWords } from './word-class-judge';
import { fitsKindWord, kindWordName } from '../analyzer/kind-word';
import { isGeminiConfigured } from './gemini-client';
import { isSameProduct, ProductIdentity, registeredMatcher } from '../search/product-identity';
import { buildBrandIndex, SEED_INDEX, textHasBrand } from './brand-suggest';
import { COSMETICS_DATABASE } from '../data/cosmetics-db';

/**
 * 原因成分を含まない代わりの商品探し（T3）。手順: docs/plans/gemini-role-redesign.md「Phases 3 and 4」
 * - 検索語は成分DBの名前と決まった語だけで作る（利用者の文章・商品名は送らない）
 * - 候補は必ずコードで確かめる（findSafeAlternatives）。確かめられなければ代わりの商品を出さない
 */

/** 検索語に使う成分の上限（長い検索語は結果が減る） */
const MAX_QUERY_INGREDIENTS = 3;
/** 成分DBに無い語を避けるとき、保存済みの製品のうち AI に聞く候補の数（limit の何倍か） */
const WORD_JUDGE_POOL = 8;
/** アプリの種類に無い種類の語で探すとき、保存済みの製品のうち、その種類かを AI に聞く候補の数と、聞く回数 */
const KIND_JUDGE_POOL = 300;
const SAVED_KIND_CALLS = 2;

/** AI に判定させる成分名。確認（alternativeGateReason）が見る成分と同じ（医薬部外品の有効成分も） */
function judgedNames(product: Product): string[] {
  return labelIngredients(product).map(({ raw }) => raw);
}
const DEFAULT_LIMIT = 3;

export interface AlternativeRequest {
  /** 含まないことを確かめる成分。比較の候補成分は、成分DBに無い名前も含む */
  avoid: (CulpritIngredient | { nameJa: string; nameEn?: string })[];
  /** 検索語に使う成分（成分DBの項目だけ） */
  known: KnownIngredient[];
  category?: AlternativeCategory;
  /** 種類の中の下位の種類（クレンジング・乳液・ハンドクリーム等）。名前・文章の語から。無ければ今までどおり */
  subKind?: SubKind;
  /** 形・使う場所（ミスト・顔用・SPF 等。名前・文章の語から。並べ替え・お店の検索語・お店に聞くか（fitsRequest）に使う。名前そのものは持たない） */
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
  /**
   * 避けたいと書かれたが、成分DBに無い語（「シリコン不使用」のシリコン）。ほかの成分と同じく避ける（成分名が当たるかは AI が判定。
   * analyzer/avoided-word.ts）。お店と Web の検索語に「〇〇フリー」として入れる。ログには数だけ
   */
  unknownAvoid?: string[];
  /**
   * 頼まれた物の語のうち、アプリの種類に無い語（「シリコン不使用の下地」の下地）。まだ確かめていない。resolveUnknownWords で
   * 化粧品の種類と判定されたら kindWord になり、そうでなければ使わない
   */
  askedItem?: string;
  /** アプリの種類に無い、頼まれた種類の語（AI が化粧品の種類と判定した語）。その種類の商品かは、商品ごとに AI が判定する */
  kindWord?: string;
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
 * 文章（「香料が入っていない化粧水」等）から。成分DBの成分も種類も、成分DBに無い避けたい語も無ければ null
 * 文章そのものは検索に使わない
 */
export function alternativeRequestFromText(text: string): AlternativeRequest | null {
  const mentioned = findIngredientsInText(text, { includeNegated: true });
  // 「セラミド配合で香料フリー」のように、避けたいと書かれた成分があれば、それだけを避ける
  const negated = mentioned.filter((k) => isNegatedInText(k, text));
  const known = negated.length > 0 ? negated : mentioned;
  const category = categoryFromText(text);
  // 成分DBに無い語だけの頼み（「シリコンフリー」）も、種類を問わず、その語に当たる成分と強い刺激成分を含まない物を探す
  const unknownAvoid = unknownAvoidWords(text);
  // 種類が分からなければ、頼まれた物の語（「下地」）を取っておく（化粧品の種類かは resolveUnknownWords で AI が判定）
  const askedItem = category ? undefined : askedItemWord(text, unknownAvoid);
  if (known.length === 0 && !category && unknownAvoid.length === 0 && !askedItem) return null;
  // 下位の種類と形は、探す種類を書いた部分だけから読む（「ボディミルクで荒れたので化粧水を探して」の
  // 「ボディ」で、からだ用の化粧水だけを探さない）
  const clause = clauseNaming(text, category);
  const subKind = subKindFromText(category, clause);
  return {
    avoid: known.map((k) => ({ nameJa: k.nameJa, nameEn: k.nameEn })),
    known,
    category,
    ...(subKind && { subKind }),
    ...(unknownAvoid.length > 0 && { unknownAvoid }),
    ...(askedItem && { askedItem }),
    profile: formProfile(clause, category),
    excludeIds: [],
  };
}

const NEGATION = /入っていない|入ってない|入らない|含まない|含まれていない|不使用|フリー|free|なし|無し|ゼロ|抜き/;
const POSITIVE = /配合|入り|入っている|入ってる|含む|使用/;
/** 名前のあとを見る範囲（「エタノールとパラベンが入っていない」のように並べた成分にも届く長さ） */
const NEGATION_WINDOW = 20;

/**
 * 避けたいと書かれた語（「○○フリー」「○○不使用」「○○が入っていない」「無○○」の○○）。語はカタカナ・漢字・英数字の続きだけ
 * （「の」などで切れる）。「無香料無着色」は「無」で区切る
 */
const AVOID_PHRASE =
  /([ァ-ヶー一-龠a-z0-9]{2,15})(?:が|を|は)?(?:フリー|free|不使用|入っていない|入ってない|含まない|含まれていない|無添加|なし|無し|抜き)|無((?:(?!無)[ァ-ヶー一-龠]){2,10})/g;
/** 成分ではない語（「無添加」の添加、「刺激なし」の刺激） */
const NOT_AN_INGREDIENT_WORD = /^(添加|刺激)/;
/** 「無」の後で成分ではない語（「無料」「無理」「無難」「無限」「無駄」「無効」「無事」「無償」「無数」「無線」「無人」「無意識」「無印良品」） */
const NOT_AN_INGREDIENT_AFTER_MU = /^(料|理|難|限|駄|効|事|償|数|線|人|意識|印)/;
/** 返事で言う、成分DBに無い語の数の上限 */
const MAX_UNKNOWN_AVOID = 2;

/** 避けたいと書かれたが、成分DBの成分でも、まとまりの語（アルコール・紫外線吸収剤等）でもない語（「シリコン不使用」のシリコン） */
export function unknownAvoidWords(text: string): string[] {
  const t = text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  const words = new Set<string>();
  for (const m of t.matchAll(AVOID_PHRASE)) {
    const word = m[1] ?? m[2];
    if (NOT_AN_INGREDIENT_WORD.test(word) || (m[1] === undefined && NOT_AN_INGREDIENT_AFTER_MU.test(word))) continue;
    const known = findIngredientsInText(word, { includeNegated: true }).length > 0 || INGREDIENT_GROUP_WORDS.some((g) => g.word === word);
    if (!known) words.add(word);
  }
  return [...words].slice(0, MAX_UNKNOWN_AVOID);
}

/** 頼まれた物の語の候補（カタカナ・漢字の続き） */
const ITEM_RUN = /[ァ-ヶー一-龠]{2,15}/g;
/** 頼まれた物ではない語（頼み方・肌の言い方・「化粧品」のような種類を言わない語） */
const NOT_AN_ITEM = /^(探|教|検索|紹介|購入|使用|使|敏感肌|乾燥肌|脂性肌|混合肌|普通肌|肌|商品|製品|化粧品|コスメ|アイテム|スキンケア|代|候補|成分|刺激|添加|低刺激|無添加)/;
/** 避けたいと書いた句（「アルコールは避けたい」）。頼まれた物の語にしない */
const AVOID_WISH = /[ァ-ヶー一-龠a-z0-9]{2,15}(?:は|を|が)?(?:避け|控え|苦手|ダメ|だめ|NG|ng)/g;

/**
 * 種類が分からない頼みで、頼まれた物の語（「シリコン不使用の下地」「下地を探して」の下地）。避けたい語の句・成分DBの成分の名前・
 * 頼み方の語は除き、最後の語（頼みごとは後ろに来る）。無ければ undefined
 */
export function askedItemWord(text: string, avoidWords: readonly string[]): string | undefined {
  const t = text.normalize('NFKC').toLowerCase().replace(/\s+/g, '').replace(AVOID_PHRASE, '、').replace(AVOID_WISH, '、');
  const words = [...t.matchAll(ITEM_RUN)]
    .map((m) => m[0])
    .filter((w) => !NOT_AN_ITEM.test(w) && !avoidWords.includes(w) && findIngredientsInText(w, { includeNegated: true }).length === 0);
  return words.at(-1);
}

/**
 * アプリが知らない語を、AI（Decisions API）で確かめてから使う（owner 2026-11-25）:
 * - 避けたい語（「シリコン」）：成分（成分のまとまりを含む）と判定されたか、分からなければ避ける。成分ではないと判定されたら使わない
 * - 頼まれた物の語（「下地」）：化粧品の種類と判定されたら、その種類を探す（商品ごとに AI が種類を確かめる）。そうでなければ使わない
 * 探すものが何も残らなければ null（今までどおり、成分か種類を書くように返事する）
 */
export async function resolveUnknownWords(req: AlternativeRequest): Promise<AlternativeRequest | null> {
  const avoidWords = req.unknownAvoid ?? [];
  const item = req.askedItem;
  if (avoidWords.length === 0 && !item) return req;
  const classes = await classifyWords([
    ...avoidWords.map((word) => ({ word, ask: 'ingredient' as const })),
    ...(item ? [{ word: item, ask: 'kind' as const }] : []),
  ]);
  const kept = avoidWords.filter((word) => classes.get(word)?.ingredient !== 'no');
  const kindWord = item && classes.get(item)?.kind === 'yes' ? item : undefined;
  const resolved: AlternativeRequest = kindWord
    ? { ...req, category: undefined, subKind: undefined, profile: undefined, unknownKind: undefined, kindWord }
    : { ...req };
  delete resolved.askedItem;
  delete resolved.unknownAvoid;
  if (kept.length > 0) resolved.unknownAvoid = kept;
  const nothingToSearch = resolved.avoid.length === 0 && !resolved.category && !resolved.kindWord && kept.length === 0 && !resolved.unknownKind;
  return nothingToSearch ? null : resolved;
}

/**
 * 「香料が入っていない」「エタノールとパラベン不使用」「無香料」のように、含まないことを求めているか。
 * 「セラミド配合で香料フリー」のセラミドは、否定の前に「配合」があるので求めていない
 */
export function isNegatedInText(item: KnownIngredient, text: string): boolean {
  const t = text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  // まとまりの言い方（「アルコールフリー」のアルコール）も、その成分の名前として見る
  const groupWords = INGREDIENT_GROUP_WORDS.filter((g) => inIngredientGroup(g, item)).map((g) => g.word);
  const names = [...item.nameJa.split(/[（(/／)）]/), ...item.aliases, ...groupWords]
    .map((n) => n.normalize('NFKC').toLowerCase().replace(/\s+/g, ''))
    .filter((n) => n.length >= 2);
  return names.some((n) => {
    const isGroupWord = groupWords.includes(n);
    for (let i = t.indexOf(n); i >= 0; i = t.indexOf(n, i + 1)) {
      if (isGroupWord) {
        // まとまりの言い方は、1つの語のときだけ（「セチルアルコールフリー」はエタノールを避けるという意味ではない）
        const found = standaloneGroupWord(t, i, i + n.length);
        if (!found) continue;
        if (found.negated) return true;
      }
      if (t[i - 1] === '無') return true;
      const after = t.slice(i + n.length, i + n.length + NEGATION_WINDOW);
      const neg = NEGATION.exec(after);
      if (neg && !POSITIVE.test(after.slice(0, neg.index))) return true;
    }
    return false;
  });
}

/**
 * 比較リストに登録した製品（肌荒れした・使える・今使っているコスメ）。代わりの商品に出さない。
 * 今使っているコスメは使えるコスメにも入っているので、同じ ID は1つだけ
 */
export function registeredProducts(routine: UserRoutineState | undefined): Product[] {
  if (!routine) return [];
  const byId = new Map<string, Product>();
  for (const p of [...routine.badProducts, ...(routine.safeProducts ?? []), ...(routine.currentlyUsing ?? [])]) {
    if (!byId.has(p.id)) byId.set(p.id, p);
  }
  return [...byId.values()];
}

/**
 * 比較リストから。サーバーで比較をやり直し、その候補成分を避ける。肌荒れしたコスメが無ければ null
 */
export function alternativeRequestFromRoutine(routine: UserRoutineState | undefined): AlternativeRequest | null {
  if (!routine || routine.badProducts.length === 0) return null;
  const diff = performDifferentialAnalysis(routine.badProducts, routine.safeProducts ?? []);
  const registered = registeredProducts(routine);
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
export function shopTerms(req: Pick<AlternativeRequest, 'known' | 'unknownAvoid'>): string[] {
  const terms = new Set<string>();
  // 成分DBに無い語（「シリコン」）は、書かれた語に「フリー」（お店の商品名に多い言い方）。書かれた語を先に
  for (const word of req.unknownAvoid ?? []) terms.add(`${word}フリー`);
  for (const k of req.known) {
    if (k.category === 'fragrance' || k.category === 'essential_oil') terms.add('無香料');
    else if (k.id === 'ethanol' || k.category === 'drying_alcohol') terms.add('アルコールフリー');
    // 酸化亜鉛・酸化チタンを避けるときも「ノンケミカル」。外すとエタノールの多いスプレーばかりになり、確かめられる商品が減った
    // （docs/plans/mineral-filter-terms-and-list-dedupe.md「Step 3」）
    else if (k.category === 'uv_filter') terms.add('ノンケミカル');
    // お店の商品名に多い言い方（docs/plans/mineral-oil-avoid-request.md「Step 2」）
    else if (k.id === 'mineral_oil') terms.add('鉱物油フリー');
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

/**
 * 検索語（成分DBの名前と決まった語だけ）。種類の語と形の語は、お店の検索と同じ（下位の種類の名前で確かめた語だけ使い、
 * 「顔用日焼け止め」のように狭めすぎない。「クレンジング」「乳液」「ボディソープ」はその名前）
 */
export function buildAlternativeQuery(req: AlternativeRequest): string {
  const terms = [...new Set([...(req.unknownAvoid ?? []).map((word) => `${word}フリー`), ...req.known.map(queryTerm)])].slice(0, MAX_QUERY_INGREDIENTS);
  const kind = req.category
    ? [shopSearchLabel(req.category, req.subKind), shopFormWord(req.category, req.subKind, req.profile?.form)]
    : [req.kindWord ?? 'スキンケア'];
  return ['敏感肌', ...kind.filter((w): w is string => !!w), ...terms, '全成分'].join(' ');
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
  /** 読めた一覧のうち、商品名から探している種類と確かめられなかった数（counts.otherKindAfterRead） */
  otherKind: number;
  /** 読めた一覧のうち、評価できた成分が少なかった数（dropped.unrated。確かめた後にだけ数える） */
  unrated: number;
  /**
   * 読めた一覧のうち、見つけた商品（一緒に出す保存済みの製品を含む）と同じ製品の別の出品だった数（dropped.duplicate。別のお店・
   * 容量違い・同じ JAN コード・名前の書き方違い）。
   * 返答で、読めた数と出した数の差を言うため（docs/plans/shop-names-and-cleansing-genre.md「Step 4」）
   */
  duplicate: number;
}

export function shopCheckSummary(counts: ShopSearchCounts): ShopCheckSummary {
  const { noList, suspect, irritant, standard, unrated, duplicate } = counts.dropped;
  return {
    checked: counts.checked,
    readable: counts.checked - noList,
    rejected: suspect + irritant + standard,
    otherKind: counts.otherKindAfterRead,
    unrated,
    duplicate,
  };
}

/**
 * 頼まれた物にそのまま合う製品か：下位の種類を頼まれたら同じ下位の種類、形を頼まれたら同じ形
 * （docs/plans/shop-search-reach.md「Step 1」）。どちらも無ければ、どの製品も合う。
 * 合わない保存済みの製品（バームを頼まれたときのクレンジングオイル）は、お店に聞く前の「足りた」に数えない
 */
function fitsRequest(product: Pick<Product, 'name'>, req: Pick<AlternativeRequest, 'category' | 'subKind' | 'profile'>): boolean {
  const { category, subKind } = req;
  const form = req.profile?.form;
  if (subKind && category && subKindFit(subKind, candidateSubKind(subKind, category, product.name), category) !== 'same') return false;
  return !form || formProfile(product.name, category).form === form;
}

/**
 * 頼まれた物に合わなくても、足りない分を埋めてよい製品か：下位の種類を頼まれたら、名前がその下位の種類を言う製品だけ
 * （形が違うのはよい：バームを頼まれたときのクレンジングオイル。オールインワンジェルにワセリンは出さない。
 * docs/plans/alternatives-live-review-2026-11-23.md「Step 2」）。下位の種類を頼まれていなければ、どの製品も
 */
function fillsRequest(product: Pick<Product, 'name'>, req: Pick<AlternativeRequest, 'category' | 'subKind'>): boolean {
  const { category, subKind } = req;
  return !subKind || !category || subKindFit(subKind, candidateSubKind(subKind, category, product.name), category) === 'same';
}

/** カードに注意を書く成分（香料・精油・アルコール。analyzer/alternative-gate.ts の alternativeCautions）の無い製品か */
const withoutCautions = (p: Product) => !p.cautionIngredients?.length;

/**
 * 合う物を先に（保存済み → お店）、次に埋めてよい合わない物（保存済み → お店）。注意を書く製品は、注意の無い製品の後に
 * （その中では同じ順）。limit 件まで
 */
function fittingFirst(saved: Product[], shop: Product[], req: AlternativeRequest, limit: number): Product[] {
  const fits = (p: Product) => fitsRequest(p, req);
  const fills = (p: Product) => !fits(p) && fillsRequest(p, req);
  const ordered = [...saved.filter(fits), ...shop.filter(fits), ...saved.filter(fills), ...shop.filter(fills)];
  return [...ordered.filter(withoutCautions), ...ordered.filter((p) => !withoutCautions(p))].slice(0, limit);
}

/**
 * 代わりの商品を探す。キャッシュ済みの確認済み製品から探し、頼まれた物に合う製品（fitsRequest）が足りなければお店の
 * 商品検索で探す（docs/plans/alternative-recommendations.md の step 3）。それでも足りなければ（お店のキーが無い・失敗した・
 * 確かめられる商品が少ない）、Web で候補を探してから同じ確認（避ける成分・強い刺激成分を含まない、全成分が
 * 確認済み、同じ種類）をやり直す。合わない保存済みの製品は、足りない分を埋めるのに使う（そのために Web では探さない）
 */
export async function findAlternatives(req: AlternativeRequest, limit = DEFAULT_LIMIT): Promise<AlternativeResult> {
  const terms = shopWordsFor(req);
  let saved = 0;
  let fitting = 0;
  let shopLog: AlternativesLog['shop'] = null;
  // shopCheck はログの shop と同じときに null（お店に聞かなかった）
  const done = (result: Omit<AlternativeResult, 'shopCheck'>, answeredBy: AlternativesLog['answeredBy']): AlternativeResult => {
    logAlternatives({
      // 種類の語（利用者の語）はログに残さない
      kind: req.unknownKind ? 'unknown' : (req.category ?? (kindWord ? 'word' : 'any')),
      subKind: req.subKind ?? null,
      // 確認で避けない成分（低刺激と判定済み）は数えない
      avoid: req.avoid.filter((a) => !('riskLevel' in a) || a.riskLevel !== 'safe').length,
      unknownAvoid: req.unknownAvoid?.length ?? 0,
      // 書かれた語（「シリコン」）はログに残さない
      terms: terms.map((t) => (req.unknownAvoid?.some((word) => t === `${word}フリー`) ? '〇〇フリー' : t)),
      saved,
      fitting,
      answeredBy,
      shown: result.products.length,
      shop: shopLog,
    });
    return { ...result, shopCheck: shopLog && shopCheckSummary(shopLog) };
  };
  if (req.unknownKind) return done({ products: [], researched: false, credits: [] }, 'none');
  // 鉱物油を避けるとき、名前で決まらない炭化水素（イソパラフィン等）の AI の判定を、確かめる前に取ってくる
  // （確認は判定が「鉱物油でない」名前だけを通す。docs/plans/mineral-oil-avoid-request.md「Step 4」）
  const oilJudge = avoidedIngredients(req.avoid).ids.has('mineral_oil') ? mineralOilJudge() : undefined;
  // 成分DBに無い避けたい語（「シリコン」）は、成分名ごとに AI が判定する（判定が「当たらない」名前だけを通す）
  const words = req.unknownAvoid ?? [];
  const wordJudge = words.length > 0 ? avoidedWordJudge(words) : undefined;
  // アプリの種類に無い種類の語（「下地」）は、商品ごとに AI がその種類かを判定する（判定が「当たる」商品だけを出す）
  const kindWord = req.kindWord;
  // 保存済みの製品とお店の商品で、聞く回数を別に持つ（保存済みの製品の判定で、お店の商品の判定を使い切らない）
  const savedKindJudge = kindWord ? kindWordJudge(kindWord, { maxCalls: SAVED_KIND_CALLS }) : undefined;
  const kindJudge = kindWord ? kindWordJudge(kindWord) : undefined;
  const fitsWord = (p: Product) => !kindWord || fitsKindWord(kindWord, p.name);
  const excludes = [...req.excludeIds, ...(req.excludeProducts ?? [])];
  const options = { category: req.category, subKind: req.subKind, profile: req.profile, avoidWords: words, kindWord };
  let judgedPool: Product[] | undefined;
  const judgeSaved = async () => {
    // 種類の語で探すときは、その種類と判定された候補だけを、下で鉱物油の判定にかける
    if (oilJudge && !kindWord) {
      // 出せる製品だけ（除く製品・全成分を確かめていない製品・利用者の成分表示の製品の名前に、聞く回数を使わない）
      const excluded = new Set(req.excludeIds);
      const isRegistered = registeredMatcher(req.excludeProducts ?? []);
      const showable = COSMETICS_DATABASE.filter(
        (p) =>
          !excluded.has(p.id) &&
          hasVerifiedIngredients(p) &&
          p.ingredientSource !== 'user_label' &&
          (!req.category || fitsKind(p, req.category, req.subKind)) &&
          !isRegistered(p)
      );
      await oilJudge(showable.flatMap(judgedNames));
    }
    // 語・種類の語の判定は、ほかの確認を通る製品のうち、出す候補になる数だけ（聞く数を絞る）。確かめ直すのも、その候補だけ
    // （保存済みの製品をもう一度すべて見ない）。
    // 種類の語（「下地」）は、名前にその語が無い製品（「プライマー」）も AI が同じ種類か判定する。名前にその語がある製品を先に
    if (wordJudge || savedKindJudge) {
      // 種類の語で探すときは、鉱物油の判定がまだ無いので、候補を選ぶ確認では鉱物油を避けない（出す前の確認で避ける）
      const avoidForPool = kindWord ? req.avoid.filter((a) => !avoidedIngredients([a]).ids.has('mineral_oil')) : req.avoid;
      const poolOptions = { ...options, avoidWords: [], kindWord: undefined };
      let pool: Product[];
      if (kindWord && savedKindJudge) {
        // 通るものをすべて並べてから、名前にその語がある製品を先にして切る（切った後で並べると、その語のある製品が落ちる）
        const word = kindWordName(kindWord);
        const named: Product[] = [];
        const others: Product[] = [];
        for (const p of findSafeAlternatives(avoidForPool, excludes, Infinity, poolOptions)) {
          (kindWordName(p.name).includes(word) ? named : others).push(p);
        }
        pool = [...named, ...others].slice(0, KIND_JUDGE_POOL);
        await savedKindJudge(pool);
        pool = pool.filter(fitsWord).slice(0, limit * WORD_JUDGE_POOL);
        await oilJudge?.(pool.flatMap(judgedNames));
      } else {
        pool = findSafeAlternatives(avoidForPool, excludes, limit * WORD_JUDGE_POOL, poolOptions);
      }
      await wordJudge?.(pool.flatMap(judgedNames));
      judgedPool = pool;
    }
  };
  const judgeShop = oilJudge || wordJudge || kindJudge
    ? async (products: Product[]) => {
        // 種類を先に（その種類でない商品の成分は聞かない）
        await kindJudge?.(products);
        const ingredients = products.filter(fitsWord).flatMap(judgedNames);
        await oilJudge?.(ingredients);
        await wordJudge?.(ingredients);
      }
    : undefined;
  // 同じ製品がブランド表記違い・カタカナと英字の書き分けで重複して登録されていることがあるため、多めに取って1件にまとめる
  const check = () => {
    const unique: Product[] = [];
    for (const p of findSafeAlternatives(req.avoid, excludes, limit * 4, { ...options, ...(judgedPool && { pool: judgedPool }) })) {
      // 名前のキーだけでは比べない（キーはブランドを除くので、別のブランドの「ハンドクリーム」が1つになる）
      if (unique.some((u) => isSameProduct(u, p))) continue;
      unique.push(p);
    }
    return unique.slice(0, limit);
  };
  await judgeSaved();
  const local = check();
  saved = local.length;
  // 注意を書く製品（香料・精油・アルコール）は足りた数に数えない（お店・Web で注意の無い商品を探し、無ければ後ろに出す）
  fitting = local.filter((p) => fitsRequest(p, req) && withoutCautions(p)).length;
  // 合う製品だけで足りれば、お店に聞かない（合わない製品は、お店で足りないときに埋める）
  if (fitting >= limit) return done({ products: fittingFirst(local, [], req, limit), researched: false, credits: [] }, 'saved');

  let shopProducts: Product[] = [];
  let credits: PriceApiCredit[] = [];
  if (req.category || kindWord) {
    // 一緒に出せる保存済みの製品（合う製品と、頼まれた下位の種類で埋めてよい製品）
    const shownSaved = fittingFirst(local, [], req, limit);
    const shop = await findShopAlternatives({
      category: req.category,
      kindWord,
      subKind: req.subKind,
      profile: req.profile,
      avoid: req.avoid,
      avoidWords: words,
      terms,
      exclude: [...(req.excludeProducts ?? []), ...local, ...req.excludeIds.map((id) => ({ id, name: '' }))],
      // 一緒に出す保存済みの製品と同じお店の出品は、お店の検索の中で外して、ほかの出品で埋める（出さない保存済みの製品は含めない）。
      // 合う製品は必ず出る。埋める製品は、お店の合う商品が先に入って出ないことがある（その同じ出品を外しても、ほかの出品で探し続けるだけ）
      shownSaved,
      limit: limit - fitting,
      // 保存済みの製品で埋めれば足りる（合わない物で）ときは、有料の JAN コードの調べものはしない（お店の検索は無料）。
      // 数えるのは出せる製品だけ（別の下位の種類の製品は埋めない。docs/plans/shop-paid-lookups-and-keyword-names.md「Step 1」）
      allowPaidLookups: (req.allowPaidLookups ?? true) && shownSaved.filter(withoutCautions).length < limit,
      ...(judgeShop && { prepareCheck: judgeShop }),
    });
    // お店の商品は名前の系列と JAN コードで除いてあるが、登録した製品と同じ製品（ブランドと名前）もここで除く
    const isRegistered = registeredMatcher(req.excludeProducts ?? []);
    // 保存済みの製品と同じ製品は、お店の検索の中で外してある（shownSaved。docs/plans/shop-dedupe-and-yahoo-link-log.md）
    shopProducts = shop.products.filter((p) => !isRegistered(p));
    credits = shop.credits;
    shopLog = { status: shop.status, ...shop.counts };
    // 合わない保存済みの製品で埋めて足りれば、Web では探さない（今までどおり、有料の調べものを増やさない）。
    // 埋めてよくない製品（頼まれた下位の種類でない）は出さないので、limit 件より少ないことがある
    if (local.filter(withoutCautions).length + shopProducts.filter(withoutCautions).length >= limit) {
      const products = fittingFirst(local, shopProducts, req, limit);
      const shown = shopProducts.filter((p) => products.includes(p));
      return done({ products, researched: false, credits: shown.length > 0 ? credits : [] }, shown.length > 0 ? 'shop' : 'saved');
    }
  }

  // お店で足りない（キーが無い・失敗した・確かめられる商品が少ない）ときは、Web で候補を探してから確かめ直す。
  // 合う製品を先に、保存済みの製品（Web で見つけた製品を含む）をお店の商品より先に並べる（同じ製品は1つだけ）
  const target = `敏感肌向けの${req.category ? kindLabel(req.category, req.subKind) : (kindWord ?? 'スキンケア製品')}`;
  await researchAlternativeCandidates(buildAlternativeQuery(req), target);
  await judgeSaved();
  const checked = check();
  const extra = shopProducts.filter((p) => !checked.some((c) => isSameProduct(c, p)));
  const products = fittingFirst(checked, extra, req, limit);
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
  /** unknown: 種類が分からず探さなかった / any: 種類を決めずに探した / word: アプリの種類に無い種類の語で探した */
  kind: AlternativeCategory | 'unknown' | 'any' | 'word';
  /** 下位の種類（決まった語）。無ければ null */
  subKind: SubKind | null;
  /** 避ける成分の数 */
  avoid: number;
  /** 避けたいと書かれたが成分DBに無い語の数（語そのものは残さない） */
  unknownAvoid: number;
  /** お店の検索語に足す決まった語（成分の語と形の語。依頼から決まる。お店に聞かなかったときも出す） */
  terms: string[];
  /** 保存済みの製品から見つかった数 */
  saved: number;
  /** そのうち、頼まれた下位の種類・形に合い、注意を書く成分（香料・精油・アルコール）の無い数（fitsRequest。これが足りないとお店に聞く） */
  fitting: number;
  answeredBy: 'saved' | 'shop' | 'web' | 'none';
  shown: number;
  /** お店に聞かなかったときは null。shop.shown は、登録した製品を除く前の数 */
  shop: ({ status: ShopAlternativeResult['status'] } & ShopSearchCounts) | null;
}

function logAlternatives(line: AlternativesLog): void {
  console.log(`[alternatives] ${JSON.stringify(line)}`);
}

/**
 * 返答で見せる、避けた成分の名前（最大3つ）。名前のあるまとまりの成分をすべて避けるときは、成分を並べずにまとまりの名前
 * （「ノンケミカル」：10の紫外線吸収剤のうち3つを並べず「紫外線吸収剤」）
 */
export function avoidedNames(req: AlternativeRequest): string[] {
  const groups = coveredIngredientGroups(req.known.map((k) => k.id));
  const inGroup = new Set(groups.flatMap((g) => g.members));
  // 比較リストの候補成分は表示の書き方（「オキシベンゾン」）のことがあるので、成分DBの名前で比べる
  const memberOfGroup = (a: { nameJa: string; nameEn?: string }) =>
    inGroup.has(a.nameJa) ||
    inGroup.has((findMatchingKnownIngredient(a.nameJa) ?? (a.nameEn ? findMatchingKnownIngredient(a.nameEn) : undefined))?.nameJa ?? '');
  const names = req.avoid
    .filter((a) => (!('riskLevel' in a) || a.riskLevel !== 'safe') && !memberOfGroup(a))
    .map((a) => a.nameJa.split(/[（(]/)[0].trim().slice(0, 30))
    .filter(Boolean);
  return [...new Set([...groups.map((g) => g.label), ...names, ...(req.unknownAvoid ?? [])])].slice(0, 3);
}

/**
 * 依頼の内容を決める。文章に成分DBの成分があればそれを避ける。無ければ比較リストの候補成分を避け、
 * 種類は文章で指定されていればそれを使う。どちらも無くても、成分DBに無い避けたい語（「シリコンフリー」）があれば、
 * 種類を問わない依頼にする（その語も避ける）。成分も種類も避けたい語も無ければ null。
 * どの決め方でも、比較リストに登録した製品は勧めない（文章で成分を書いたときも、使えるコスメだけのときも）
 */
export function alternativeRequest(text: string, routine: UserRoutineState | undefined): AlternativeRequest | null {
  const req = requestFromTextOrRoutine(text, routine);
  return req && excludingRegistered(req, registeredProducts(routine));
}

/** 種類で探す依頼として読む文章の長さの上限（商品名を並べた長い名前・長い文は、種類で探す依頼ではない） */
const MAX_TYPE_SEARCH_LENGTH = 30;

/**
 * 種類で探す依頼（「美容液ファンデ」「クッションファンデ」「ファンデーションを探して」「エタノール無添加の化粧水」）。
 * 種類が分かり、ブランド（一覧のブランドと、保存した製品のブランド）を書いていない短い文章だけ。名前で探して見つからなかった
 * ときに、その種類の、強い刺激成分（と、書いた成分・登録した肌荒れしたコスメの原因候補の成分）を含まない商品を探すのに使う。
 * ブランドのある文章は、ブランドの製品を探しているので使わない
 */
export function typeSearchRequest(text: string, routine: UserRoutineState | undefined): AlternativeRequest | null {
  if (text.normalize('NFKC').trim().length > MAX_TYPE_SEARCH_LENGTH) return null;
  if (!alternativeRequestFromText(text)?.category) return null;
  if (SEED_INDEX.some((b) => textHasBrand(text, b))) return null;
  if (buildBrandIndex(COSMETICS_DATABASE).some((b) => textHasBrand(text, b))) return null;
  return alternativeRequest(text, routine);
}

/**
 * 種類で探す依頼（typeSearchRequest）に合う製品か。名前で見つかった製品のうち、その種類・下位の種類の物だけを答えにする
 * （「クッションファンデ」に、名前の「ファンデ」で見つかったリキッドファンデを出さない）
 */
export function fitsRequestedKind(req: AlternativeRequest, product: Pick<Product, 'category' | 'name'>): boolean {
  return !req.category || fitsKind(product, req.category, req.subKind);
}

function requestFromTextOrRoutine(text: string, routine: UserRoutineState | undefined): AlternativeRequest | null {
  const fromText = alternativeRequestFromText(text);
  if (fromText && fromText.known.length > 0) return fromText;
  const fromRoutine = alternativeRequestFromRoutine(routine);
  if (fromRoutine) {
    // 文章で種類を指定されたら、下位の種類も文章から（「ハンドクリームで探して」）
    const { category, subKind, profile } = fromText?.category ? fromText : fromRoutine;
    // 成分DBに無い語・アプリの種類に無い頼まれた物の語は、登録したコスメの候補成分で探すときも使う（resolveUnknownWords）
    const unknownAvoid = fromText?.unknownAvoid;
    const askedItem = fromText?.askedItem;
    return {
      ...fromRoutine,
      category,
      subKind,
      profile,
      ...(unknownAvoid && { unknownAvoid }),
      ...(askedItem && { askedItem }),
      ...(!category && { unknownKind: true }),
    };
  }
  return fromText;
}

/**
 * 登録した製品を候補から除く製品に足す（同じ ID は1つだけ）。ID だけでなく製品そのものも足す
 * （同じ製品が別の ID・別の書き方で保存されていても除けるように）
 */
function excludingRegistered(req: AlternativeRequest, registered: Product[]): AlternativeRequest {
  if (registered.length === 0) return req;
  const products = req.excludeProducts ?? [];
  const productIds = new Set(products.map((p) => p.id));
  return {
    ...req,
    excludeIds: [...new Set([...req.excludeIds, ...registered.map((p) => p.id)])],
    excludeProducts: [...products, ...registered.filter((p) => !productIds.has(p.id))],
  };
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
function shortfallParagraphs({ checked, readable, rejected, otherKind, unrated, duplicate }: ShopCheckSummary, kind: string): string[] {
  const read =
    readable === checked
      ? `お店の商品${checked}件の全成分表示を確かめました。`
      : `お店の商品${checked}件を確かめましたが、全成分表示を読めたのは${readable}件でした。`;
  // 読めたのに出さなかった商品は、理由もそれぞれ書く（成分の理由だけ書くと、残りの件数が分からない）
  const why = [
    rejected > 0 && `${rejected}件は、避けたい成分か刺激になりやすい成分を含んでいました`,
    otherKind > 0 && `${otherKind}件は、商品名から${kind}と確かめられませんでした`,
    unrated > 0 && `${unrated}件は、確かめられない成分が多く含まれていました`,
    duplicate > 0 && `${duplicate}件は、見つけた商品と同じ製品の別の出品でした`,
  ].filter(Boolean);
  return [
    `${read}${why.length > 0 ? `そのうち${why.join('。')}。` : ''}`,
    `気になる商品があれば、「${LABEL_INPUT_REPLY}」からパッケージの全成分表示を入力すると、原因候補の成分が入っていないかを確かめられます。`,
  ];
}

/** 代わりの商品の返答のボタン。少ししか出せなかった理由を書いたときは、成分表示の入力を先に（気になる商品を確かめられる） */
export function alternativeQuickReplies(products: readonly Product[], shopCheck: ShopCheckSummary | null | undefined): string[] {
  return [...(explainsShortfall(products.length, shopCheck) ? [LABEL_INPUT_REPLY] : []), '🔍 別のコスメを調べる', '📸 バーコードをスキャンする'];
}

/** からだ用のクリームの形ごとの名前（「ボディミルク」「ボディジェル」。お店でもこの名前で売っている） */
const BODY_FORM_NAMES: Partial<Record<ProductForm, string>> = {
  milk: 'ボディミルク',
  gel: 'ボディジェル',
  oil: 'ボディオイル',
  balm: 'ボディバーム',
  cream: 'ボディクリーム',
};

/** からだ用のクリームで、出した物の形が混ざっているときの名前（「ボディクリーム」と言わない） */
const MIXED_BODY_LABEL = 'ボディケア用品';

/** 返答で言う、探した物の名前。からだ用のクリームは頼まれた形の名前（形が無ければ kindLabel） */
function requestedKindLabel(category: AlternativeCategory, subKind: SubKind | undefined, form: ProductForm | undefined): string {
  return (category === 'cream' && subKind === 'body' && form && BODY_FORM_NAMES[form]) || kindLabel(category, subKind);
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
  const form = req.profile?.form;
  const hasForm = (p: Product) => formProfile(p.name, req.category).form === form;
  const formShown = !!form && products.some(hasForm);
  // 出した物がすべて頼まれた形（または何も無かった）ときは、頼まれた名前で言う（「ボディミルク」を「ボディクリーム」と言わない。
  // 一部だけなら、ほかの形も入っているので種類の名前）
  const allOfForm = !!form && products.every(hasForm);
  // 頼まれた形が1つも無く、出した物がすべて同じ形なら、その形の名前で言う（「ボディクリーム」を頼まれて「ボディミルク」だけを
  // 出したら「ボディミルク」。docs/plans/alternatives-live-review-2026-11-23.md「Step 3」）
  const shownForms = new Set(products.map((p) => formProfile(p.name, req.category).form));
  const onlyShownForm = form && !formShown && shownForms.size === 1 ? [...shownForms][0] : undefined;
  // からだ用のクリームで、頼まれた形が無く、出した物の形が混ざっている（または名前の無い形の）ときは、形を言わない名前
  const bodyForms = req.category === 'cream' && req.subKind === 'body' && !!form && !!BODY_FORM_NAMES[form];
  const mixedBody = bodyForms && !formShown && products.length > 0 && !(onlyShownForm && BODY_FORM_NAMES[onlyShownForm]);
  const kind = mixedBody
    ? MIXED_BODY_LABEL
    : req.category
      ? requestedKindLabel(req.category, req.subKind, allOfForm ? form : onlyShownForm)
      : (req.kindWord ?? 'コスメ');
  // 頼まれた物の名前（からだ用のクリームは頼まれた形の名前）
  const asked = req.category && form ? requestedKindLabel(req.category, req.subKind, form) : kind;
  // 香料・精油・アルコールを含む商品（避けると言われていない種類）は、注意を付けて出す。そのときは「刺激になりやすい成分を
  // 含まない」とは言わない
  const anyCautions = products.some((p) => !withoutCautions(p));
  const subject =
    names.length > 0 ? `「${names.join('、')}」を含まない${kind}` : anyCautions ? kind : `刺激になりやすい成分を含まない${kind}`;
  const shortfall = explainsShortfall(products.length, shopCheck) ? shortfallParagraphs(shopCheck, kind) : [];
  // 鉱物油の、名前で決まらない炭化水素（docs/plans/mineral-oil-avoid-request.md）と、成分DBに無い語に当たる成分は AI の判定
  const unknown = req.unknownAvoid ?? [];
  const judgedBy = [
    ...(avoidedIngredients(req.avoid).ids.has('mineral_oil') ? ['鉱物油かどうかが成分名だけでは分からない成分（イソパラフィンなど）は、AI が判定しています。'] : []),
    ...(unknown.length > 0 ? [`「${unknown.join('」「')}」に当たる成分かどうかは、AI が成分ごとに判定しています。`] : []),
  ];
  const aiJudged = judgedBy.length > 0 && isGeminiConfigured() ? [`${judgedBy.join('')}AI の判定には誤りが含まれることがあります。`] : [];
  if (products.length === 0) {
    return [
      `${subject}は、全成分を確認できた商品の中からは見つかりませんでした。`,
      ...shortfall,
      names.length > 0
        ? `商品を選ぶときは、パッケージの全成分表示に「${names.join('」「')}」が無いかをご確認ください。`
        : '商品を選ぶときは、パッケージの全成分表示をご確認ください。',
    ].join('\n\n');
  }
  // 形（オイル・ジェル等）は並べ替えにだけ使い、候補を外さない。頼まれた形が1つも無ければ、そう言う
  // （「乳液」のように名前が頼まれた形を言う物は、その名前の物を出しているので言わない）
  // 頼まれた名前と出した物の名前が違えば（「ボディクリーム」と「ボディミルク」）、その2つで言う
  const otherForms =
    !form || formShown
      ? []
      : mixedBody
        ? [`${asked}は見つからなかったため、ほかのタイプの${kind}を表示しています。`]
        : asked !== kind
        ? [`${asked}は見つからなかったため、${kind}を表示しています。`]
        : formFromText(kind) !== form
          ? [`${FORM_LABELS_JA[form]}タイプは見つからなかったため、ほかのタイプの${kind}を表示しています。`]
          : [];
  return [
    anyCautions
      ? `${subject}を${products.length}件見つけました。全成分を確認でき、${names.length > 0 ? 'これらの成分や' : ''}強い刺激になりやすい成分が入っていない商品を表示しています。ただし、香料・精油・アルコールを含む商品は外さず、カードに注意を書いて後に並べています（敏感肌には刺激になることがあります）。`
      : `${subject}を${products.length}件見つけました。全成分を確認でき、${names.length > 0 ? 'これらの成分や' : ''}強い刺激になりやすい成分が入っていない商品だけを表示しています。`,
    ...aiJudged,
    ...otherForms,
    ...shortfall,
    '肌に合うかは人によって違います。初めて使うときは少量から試してください。',
  ].join('\n\n');
}
