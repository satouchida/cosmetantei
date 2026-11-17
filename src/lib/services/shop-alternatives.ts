import 'server-only';
import { CulpritIngredient, PriceApiCredit, Product } from '../types';
import { COSMETICS_DATABASE, isShareable } from '../data/cosmetics-db';
import { AlternativeGateReason, alternativeGateReason } from '../analyzer/alternative-gate';
import { AlternativeCategory, CATEGORY_LABELS_JA, categoryFromText, SubKind, subKindFit, subKindFromText } from '../analyzer/product-category';
import { bestFormSimilarity, FormProfile, formFromText, formProfile, formSimilarity, hasFormProfile, ProductForm } from '../analyzer/product-form';
import { CATEGORY_SYNONYMS, searchKey } from '../search/product-match';
import { normalJan } from '../search/product-identity';
import { buildBrandIndex, IndexedBrand, textHasBrand } from './brand-suggest';
import { NOT_SINGLE_ITEM } from './price-service';
import { findSavedByBarcode, lookupByBarcode } from './search-barcode-service';
import { isRakutenApiConfigured, isYahooApiConfigured, rakutenItemSearch, ShopItem, yahooItemSearch } from './shop-apis';
import { ingredientsFromCaption, shopListingProduct } from './shop-ingredients';
import { withoutListingNoise } from '../search/listing-name';
import { shopLink } from './shops';

/**
 * 代わりの商品を、楽天市場・Yahoo!ショッピングの商品検索から探す（docs/plans/alternative-recommendations.md の step 3）
 * - 検索語は種類（下位の種類）の名前と決まった語（「無香料」「ノンケミカル」など）だけ。利用者が入力した文・成分表示は
 *   送らない。種類はお店のジャンル（step 2 で確かめた ID）でも絞る。確かめた ID の無い下位の種類は絞らない
 * - 成分は安い順に確かめる（1 と 2 の候補を、お店の関連順のまま先に。どちらも無い候補は、足りないときだけ 3 へ）：
 *   1. Yahoo! の JAN コードで、保存済みの確かめた製品（費用なし）
 *   2. 楽天の商品説明の全成分（shop-ingredients.ts。その返答にだけ使う。楽天の規約 第10条 (9)）
 *   3. まだ確かめられない上位の Yahoo! の商品だけ、JAN コードで製品を調べる（Open Beauty Facts、無ければ Web。
 *      有料の調べものは1回の要求の予算の範囲で。見つけた製品は今までどおり保存される）
 * - 確かめるのは今までと同じ（含まない・強い刺激成分を含まない・同じ種類）。お店の説明から読んだ一覧は、
 *   8割以上の成分を評価できたものだけ（読めない名前が多い一覧は「原因成分フリー」の根拠にならない）
 * - 結果は保存しない（共有のキャッシュに入れない）。商品名は API が返したまま。リンクはアフィリエイトのリンク
 */

interface ShopGenre {
  rakuten: number;
  yahoo: number;
}

/** 種類ごとのお店のジャンル（2026-10-18 に確かめた、結果の多い ID。ファンデーションは 2026-11-03） */
const GENRES: Record<AlternativeCategory, ShopGenre> = {
  sunscreen: { rakuten: 503054, yahoo: 46427 },
  toner: { rakuten: 216307, yahoo: 1764 },
  serum: { rakuten: 216348, yahoo: 1769 },
  cream: { rakuten: 216424, yahoo: 1753 },
  cleanser: { rakuten: 405130, yahoo: 48903 },
  mask: { rakuten: 503020, yahoo: 1767 },
  lip: { rakuten: 405206, yahoo: 5005 },
  foundation: { rakuten: 210457, yahoo: 46351 },
};

/**
 * 下位の種類ごとの検索語とジャンル（docs/plans/alternative-search-improvements.md「Path 1」）。ジャンルは確かめた ID だけ
 * （乳液・クレンジングは 2026-10-18）。確かめた ID の無いものはジャンルで絞らず、名前の語で確かめる（ID を推測しない）。
 * ここに無い下位の種類（洗顔料・顔のクリーム・顔用や下地の日焼け止め・口紅・洗い流すパック・拭き取り化粧水）は、
 * 種類の名前と種類のジャンルで探す（その種類のジャンルに入っている）
 * 自分の ID が無くても、種類のジャンルの一部なら種類のジャンルで絞る（ジャンル無しでは別の種類ばかり返る。実測 2026-11-18）：
 * からだ用の日焼け止め（日焼け止めのジャンル）・シートマスク（パックのジャンル）。種類のジャンルに入っているか分からない
 * ものは絞らない：ボディソープ・ボディローション・ハンド・からだ用・目元のクリーム・オールインワン（お店ではボディケア等の
 * 別のジャンル）、保湿ジェル（クリームのジャンルか分からない）、リップクリーム（リップのジャンルが口紅側か分からない。
 * ジャンル無しで見つかっている）
 */
const SUB_KIND_SEARCH: Partial<Record<AlternativeCategory, Partial<Record<SubKind, { label: string; genre?: ShopGenre }>>>> = {
  cleanser: {
    makeup_remover: { label: 'クレンジング', genre: { rakuten: 405100, yahoo: 48902 } },
    body_wash: { label: 'ボディソープ' },
  },
  cream: {
    milk: { label: '乳液', genre: { rakuten: 216387, yahoo: 1766 } },
    // 「クリーム」で探すと、ほとんどが顔のクリームで外れるので、それぞれの名前で探す
    gel: { label: '保湿ジェル' },
    all_in_one: { label: 'オールインワンジェル' },
    eye: { label: 'アイクリーム' },
    hand: { label: 'ハンドクリーム' },
    body: { label: 'ボディクリーム' },
  },
  sunscreen: { body: { label: '日焼け止め ボディ', genre: GENRES.sunscreen } },
  lip: { lip_care: { label: 'リップクリーム' } },
  mask: { sheet: { label: 'シートマスク', genre: GENRES.mask } },
  toner: { body_lotion: { label: 'ボディローション' } },
};

/** お店で探す語とジャンル。下位の種類の決まった検索語があればそれ、無ければ種類の名前とジャンル */
function shopSearchFor(category: AlternativeCategory, subKind: SubKind | undefined): { label: string; genre?: ShopGenre } {
  const bySubKind = subKind && SUB_KIND_SEARCH[category]?.[subKind];
  return bySubKind ?? { label: CATEGORY_LABELS_JA[category], genre: GENRES[category] };
}

/** 検索語に足す形の語（お店の商品名によく書かれる言い方） */
const FORM_SEARCH_WORDS: Record<ProductForm, string> = {
  mist: 'ミスト',
  sheet: 'シート',
  stick: 'スティック',
  foam: '泡',
  balm: 'バーム',
  oil: 'オイル',
  gel: 'ジェル',
  milk: 'ミルク',
  cream: 'クリーム',
  powder: 'パウダー',
  water: 'ウォーター',
};
/** 出品者が商品名に形を書く種類（docs/plans/alternative-search-improvements.md「Path 2」） */
const FORM_SEARCH_KINDS: ReadonlySet<AlternativeCategory> = new Set(['sunscreen', 'cleanser', 'cream']);

/**
 * お店の検索語に足す形の語。形を書く種類で、探す名前（「乳液」「ハンドクリーム」等）がまだ形を言っていないときだけ
 * （「乳液 クリーム」のように食い違う語で結果を減らさない）
 */
export function shopFormWord(category: AlternativeCategory, subKind: SubKind | undefined, form: ProductForm | undefined): string | undefined {
  if (!form || !FORM_SEARCH_KINDS.has(category)) return undefined;
  return formFromText(shopSearchFor(category, subKind).label) ? undefined : FORM_SEARCH_WORDS[form];
}

/**
 * 無料で確かめる候補（保存済みの製品・楽天の説明）の数の上限。保存済みの製品を KV で読むのも、JAN コードのある商品の
 * 先頭からこの数まで（今までの上限と同じ。Yahoo! の1ページは30件なので、ふつうは全部）。
 * 上げずに、無料で確かめられる候補を先に並べる：お店の1ページは30件なので、名前で落ちなかった楽天の説明はほぼすべてこの中で
 * 読める。超えるのは保存済みの製品に合う Yahoo! の商品が多いときだけ（まれ）。説明を読むのは1件ずつの CPU の仕事なので、
 * 1回の押下の仕事は今までどおり30件まで
 */
const MAX_CANDIDATES = 30;
/** JAN コードで製品を調べる（有料のことがある）候補の数 */
const MAX_BARCODE_LOOKUPS = 2;
/** お店の説明から読んだ一覧で、評価できた成分の割合の下限 */
const MIN_RATED_SHARE = 0.8;

export interface ShopAlternativeInput {
  category: AlternativeCategory;
  /** 分析した製品の下位の種類（無ければ今までどおり。ハンド・からだ用などの候補は外す） */
  subKind?: SubKind;
  /** 分析した製品の形・使う場所（並べ替えにだけ使う。形で候補を外さない） */
  profile?: FormProfile;
  avoid: (CulpritIngredient | { nameJa: string; nameEn?: string })[];
  /** 検索語に足す決まった語（「無香料」「アルコールフリー」「ノンケミカル」など） */
  terms: string[];
  /** 勧めない製品（分析した製品・肌荒れしたコスメ） */
  exclude: (Pick<Product, 'id' | 'name'> & Partial<Pick<Product, 'barcode'>>)[];
  limit: number;
  /**
   * 足りないときに JAN コードで製品を調べてよいか（有料のことがある）。サーバーが持っている製品から探すときだけ。
   * ブラウザから送られただけの製品（入力した成分表示・お店の説明から読んだ製品）では調べない
   */
  allowPaidLookups?: boolean;
}

export interface ShopAlternativeResult {
  /** unavailable: お店のキーが無い・両方のお店の検索が失敗した（呼び出し側は Web で探す） */
  status: 'ok' | 'unavailable';
  products: Product[];
  /** 表示するクレジット（使った API） */
  credits: PriceApiCredit[];
  /** どこで候補が減ったかの数（ログ [alternatives] と scripts/eval-alternatives.mts。表示には使わない） */
  counts: ShopSearchCounts;
}

/**
 * お店の候補が外れた理由。otherKind: 別の種類・別の下位の種類 / notSingle: セット・まとめ売り・中古・試供品など / excluded: 勧めない製品 /
 * noList: 読める成分表示も保存済みの製品も無い / suspect・irritant・standard・unrated: 確認（alternativeGateReason）/
 * duplicate: 同じ製品がもう候補にある
 */
export type ShopDropReason =
  | 'otherKind'
  | 'notSingle'
  | 'excluded'
  | 'noList'
  | 'suspect'
  | 'irritant'
  | 'standard'
  | 'unrated'
  | 'duplicate';

/**
 * 数と決まった語だけ（商品名・ブランド・JAN コード・URL・お店の文は入れない）。どの候補も1つにだけ数えるので、いつも
 *   fetched.rakuten + fetched.yahoo = dropped の合計（9つの理由）+ shown + notShown + notChecked
 *   dropped.noList = noListByShop.rakuten + noListByShop.yahoo
 * になる（テスト 170 で確かめる）
 */
export interface ShopSearchCounts {
  /** お店が返した商品の数 */
  fetched: { rakuten: number; yahoo: number };
  dropped: Record<ShopDropReason, number>;
  /** dropped.noList のお店ごとの内訳（Yahoo! は説明を取らないので、どちらのお店で成分が読めないのかを測る） */
  noListByShop: { rakuten: number; yahoo: number };
  /**
   * 成分を確かめに進んだ候補の数（無料の確かめ・有料の調べものの候補に回したもの・無料の手段も JAN コードも無いと分かったもの）
   */
  checked: number;
  /**
   * 確かめなかった候補の数（必要な数がそろった後・無料の確かめの上限を超えた）。fetched は、確かめる前に落とした数（otherKind・notSingle・
   * excluded）・checked・これの合計になる
   */
  notChecked: number;
  /** JAN コードで調べた数（有料のことがある） */
  paidLookups: number;
  shown: number;
  /**
   * 確認は通ったが、下位の種類・形のより近い候補が limit 件あったので出さなかった数（近い候補を探して確かめ続けたとき）。
   * checked は、確かめた後に落とした数・shown・これの合計になる
   */
  notShown: number;
}

function emptyCounts(): ShopSearchCounts {
  return {
    fetched: { rakuten: 0, yahoo: 0 },
    dropped: { otherKind: 0, notSingle: 0, excluded: 0, noList: 0, suspect: 0, irritant: 0, standard: 0, unrated: 0, duplicate: 0 },
    noListByShop: { rakuten: 0, yahoo: 0 },
    checked: 0,
    notChecked: 0,
    paidLookups: 0,
    shown: 0,
    notShown: 0,
  };
}

/** 確認で外れた理由を、ログの理由に。確かめた全成分が無い・利用者の成分表示は「読める成分表示が無い」に数える */
const GATE_DROP: Record<Exclude<AlternativeGateReason, 'ok'>, ShopDropReason> = {
  kind: 'otherKind',
  unverified: 'noList',
  userLabel: 'noList',
  standard: 'standard',
  suspect: 'suspect',
  irritant: 'irritant',
  unrated: 'unrated',
};

/** お店の商品のブランド名（Yahoo! はブランドの欄、楽天は商品名にある一覧のブランド） */
function brandOf(item: ShopItem, brands: IndexedBrand[]): string {
  return item.brands[0] ?? brands.find((b) => textHasBrand(item.name, b))?.entry.name ?? '';
}

/** 表示用に、お店の写真・価格・リンクを付ける（その返答にだけ使う。保存しない） */
function withShopInfo(product: Product, item: ShopItem): Product {
  const link = shopLink(item.shopId, item.url);
  return {
    ...product,
    ...(!product.imageUrl && item.imageUrl && { imageUrl: item.imageUrl }),
    ...(item.priceYen && { shopPrice: { yen: item.priceYen, taxIncluded: item.taxIncluded } }),
    // 楽天の商品ページへのリンクは、楽天アフィリエイトのリンクのときだけ
    ...((item.shopId !== 'rakuten' || link.sponsored) && { shopLink: link }),
  };
}

/** 容量・枚数（「150ml」「5枚」）。同じ製品の容量違いを1つにする */
const SIZE = /\d+(?:\.\d+)?\s*(?:ml|g|kg|l|枚|個|本)/gi;
/** 種類の語（「化粧水」「UV」など）。製品の系列のキーから外す */
const CATEGORY_KEYS = Object.values(CATEGORY_SYNONYMS)
  .flat()
  .map(searchKey)
  .filter((w) => w.length > 0)
  .sort((a, b) => b.length - a.length);
/**
 * シートマスクは枚数で売る。「7枚入り」「30枚」は NOT_SINGLE_ITEM に当たらない（枚を数えない）が、個包装を袋で数えた
 * 「1枚×5袋」「(1枚入)×10個」は「×数 個・袋・箱」に当たる。同じマスク1箱なので、シートマスクを探すときだけこの部分を外して見る
 * （「7枚入り×3袋」は3袋のまとめ買いなので外さない。「2個セット」「まとめ買い」「福袋」は残りに当たる）
 */
const ONE_SHEET_PACK = /(?<!\d)1\s*枚(?:入り?)?\)?\s*[x×]\s*\d+\s*(?:個|袋|箱|包)?/gi;
/**
 * 違うマスクの詰め合わせ（NOT_SINGLE_ITEM に無い）。1つの成分表示で確かめられないので、シートマスクでは外す。
 * 「3種のセラミド」は成分の言い方なので、「種」の後にセット・各などが続くときだけ。「3セット」のような数だけのまとめ買いも
 * ここで外す（「1枚×5袋 3セット」は、袋の部分を外すと NOT_SINGLE_ITEM に当たらなくなる）
 */
const SHEET_ASSORTMENT = /\d+\s*種類?\s*(?:セット|アソート|各|[x×])|アソート|詰め?合わ?せ|よりどり|選べる|(?<![x×]\s*)\d+\s*セット/i;

/** 1個の商品でない（セット・まとめ売り・中古・試供品など）。シートマスクを探すときだけ、袋で数えた1箱を1個とする */
function notSingleItem(name: string, sheet: boolean): boolean {
  if (!sheet) return NOT_SINGLE_ITEM.test(name);
  return NOT_SINGLE_ITEM.test(name.replace(ONE_SHEET_PACK, ' ')) || SHEET_ASSORTMENT.test(name);
}

/** 調べる製品の時間の上限（JAN コードでの調べもの。超えたら、その製品は使わない） */
const LOOKUP_DEADLINE_MS = 15_000;

/** 製品の系列のキー（飾り・容量・種類の語を外す。「化粧水」だけの名前が、すべての化粧水に合わないように） */
function seriesKey(name: string): string {
  let key = searchKey(withoutListingNoise(name).replace(SIZE, ''));
  for (const w of CATEGORY_KEYS) key = key.split(w).join('');
  return key;
}

/** JAN コードで見つけた製品が、お店の商品と同じものか（出品者の書いた JAN コードは間違えていることがある） */
function sameListing(product: Pick<Product, 'name'>, item: ShopItem): boolean {
  const itemKey = seriesKey(item.name);
  const nameKey = seriesKey(product.name);
  return nameKey.length >= 3 && itemKey.length >= 3 && (itemKey.includes(nameKey) || nameKey.includes(itemKey));
}

function withDeadline<T>(promise: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), LOOKUP_DEADLINE_MS);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export async function findShopAlternatives(input: ShopAlternativeInput): Promise<ShopAlternativeResult> {
  const counts = emptyCounts();
  if (!isRakutenApiConfigured() && !isYahooApiConfigured()) return { status: 'unavailable', products: [], credits: [], counts };
  const { label, genre } = shopSearchFor(input.category, input.subKind);
  // お店に送るのは種類（下位の種類）の名前と決まった語だけ
  const keyword = [label, ...input.terms].join(' ');
  const [rakuten, yahoo] = await Promise.all([
    rakutenItemSearch(keyword, { caption: true, genreId: genre?.rakuten }),
    yahooItemSearch(keyword, { genreCategoryId: genre?.yahoo }),
  ]);
  counts.fetched = { rakuten: rakuten?.length ?? 0, yahoo: yahoo?.length ?? 0 };
  if (!rakuten && !yahoo) return { status: 'unavailable', products: [], credits: [], counts };
  const drop = (reason: ShopDropReason, item: ShopItem) => {
    counts.dropped[reason]++;
    if (reason === 'noList') counts.noListByShop[item.shopId]++;
  };

  const brands = buildBrandIndex(COSMETICS_DATABASE);
  const excludedKeys = input.exclude.map((p) => seriesKey(p.name)).filter((k) => k.length >= 4);
  const excludedJans = new Set(input.exclude.map((p) => normalJan(p.barcode)).filter(Boolean));
  const sheet = input.category === 'mask' && input.subKind === 'sheet';
  // 楽天と Yahoo! を交互に並べる（お店ごとの関連順。同じ順位なら楽天が先）。確かめる順と、同じ近さの候補の出す順に使う
  const items: ShopItem[] = [];
  for (let i = 0; i < Math.max(rakuten?.length ?? 0, yahoo?.length ?? 0); i++) {
    for (const item of [rakuten?.[i], yahoo?.[i]]) {
      if (!item) continue;
      const name = withoutListingNoise(item.name);
      const jan = normalJan(item.janCode);
      if (notSingleItem(name, sheet)) {
        drop('notSingle', item);
        continue;
      }
      // 別の種類（ジャンルが広い・名前が別の種類を言う）・別の下位の種類（クレンジングに洗顔料）と、勧めない製品
      // （同じ製品・同じシリーズ）は除く
      const kind = categoryFromText(name);
      if ((kind && kind !== input.category) || subKindFit(input.subKind, subKindFromText(input.category, name), input.category) === 'other') {
        drop('otherKind', item);
        continue;
      }
      const series = seriesKey(item.name);
      if ((jan && excludedJans.has(jan)) || (series.length >= 4 && excludedKeys.some((k) => series.includes(k) || k.includes(series)))) {
        drop('excluded', item);
        continue;
      }
      items.push(item);
    }
  }

  const gateReason = alternativeGateReason(input.avoid);
  const excludeIds = new Set(input.exclude.map((p) => p.id));
  /** 勧めてよければ null、だめなら理由 */
  const rejection = (p: Product): ShopDropReason | null => {
    if (excludeIds.has(p.id) || excludedJans.has(normalJan(p.barcode))) return 'excluded';
    const reason = gateReason(p, { category: input.category, subKind: input.subKind, allowShopListing: true, minRatedShare: MIN_RATED_SHARE });
    return reason === 'ok' ? null : GATE_DROP[reason];
  };
  const found: { product: Product; item: ShopItem }[] = [];
  // 同じ製品は1つだけ（別のお店・別の容量・先頭の 0 の違う JAN コード）。確かめた後で比べる
  // （確かめられない同じ製品の出品が先にあっても、確かめられる出品を落とさない）
  const listingKey = (item: ShopItem) => searchKey(withoutListingNoise(item.name).replace(SIZE, ''));
  const add = (product: Product, item: ShopItem) => {
    const list = product.ingredients.join('|');
    const key = listingKey(item);
    const jan = normalJan(item.janCode);
    const duplicate = found.some(
      (f) =>
        f.product.id === product.id ||
        f.product.ingredients.join('|') === list ||
        listingKey(f.item) === key ||
        (jan !== '' && normalJan(f.item.janCode) === jan)
    );
    if (duplicate) drop('duplicate', item);
    else found.push({ product, item });
  };
  const consider = (product: Product, item: ShopItem) => {
    const reason = rejection(product);
    if (reason) drop(reason, item);
    else add(product, item);
  };
  // 並べ替えの順位：同じ下位の種類が先（名前で分からない候補は後）、次に形・使う場所の近さ（product-form.ts）
  const profile = hasFormProfile(input.profile) ? input.profile : undefined;
  const rank = ({ item }: { item: ShopItem }) => {
    const name = withoutListingNoise(item.name);
    const sameSubKind = subKindFit(input.subKind, subKindFromText(input.category, name), input.category) === 'same';
    return (sameSubKind ? 1000 : 0) + (profile ? formSimilarity(profile, formProfile(name, input.category)) : 0);
  };
  // 並べ替えるものが無ければ、今までどおり limit 件そろったら止める。あれば、いちばん近い候補が limit 件そろうまで、
  // 無料の確かめ（保存済みの製品・楽天の説明）を MAX_CANDIDATES まで続ける（有料の調べものは増やさない）
  const ranks = input.subKind !== undefined || profile !== undefined;
  const best = (input.subKind ? 1000 : 0) + (profile ? bestFormSimilarity(profile) : 0);
  const enough = () =>
    found.length >= input.limit && (!ranks || found.filter((f) => rank(f) === best).length >= input.limit);
  const position = new Map(items.map((item, i) => [item, i]));
  // 1. 保存済みの確かめた製品（JAN コード）。KV はまとめて、JAN コードのある商品の先頭 MAX_CANDIDATES 件だけ読む
  const withJan = items.filter((i) => i.janCode).slice(0, MAX_CANDIDATES);
  const savedList = await Promise.all(withJan.map((i) => findSavedByBarcode(i.janCode!).catch(() => null)));
  const savedFor = new Map<ShopItem, Product>();
  withJan.forEach((item, idx) => {
    const saved = savedList[idx];
    if (saved) savedFor.set(item, saved);
  });
  // 無料で確かめられる候補（保存済みの製品・楽天の説明）を先に確かめる（それぞれ関連順のまま）。交互のままだと、成分表示を
  // ほとんど持たない Yahoo! の商品が上限の半分を使い、上限より後の楽天の説明を読まなかった（実測 2026-11-18）
  const free = items.filter((i) => savedFor.has(i) || i.caption);
  const rest = items.filter((i) => !savedFor.has(i) && !i.caption);
  const unchecked: ShopItem[] = [];
  for (const item of free.slice(0, MAX_CANDIDATES)) {
    if (enough()) break;
    counts.checked++;
    const saved = savedFor.get(item);
    if (saved) {
      // 出品者の書いた JAN コードは間違えていることがある。保存済みの製品の名前と、お店の商品名が合うときだけ
      if (sameListing(saved, item)) consider(saved, item);
      else drop('noList', item);
      continue;
    }
    // 2. 楽天の商品説明の全成分
    const label = await ingredientsFromCaption(item.caption!);
    if (label) consider(shopListingProduct(item, brandOf(item, brands), label), item);
    else if (item.janCode) unchecked.push(item);
    else drop('noList', item);
  }
  // 無料の手段の無い候補は、足りないときだけ見る（仕事は無い。JAN コードがあれば有料の調べものの候補、無ければ成分表示なし）。
  // 無料の確かめの上限とは別に数えるので、上の確かめで上限まで使っても、Yahoo! の JAN コードの商品は有料の調べものに届く
  if (!enough()) {
    for (const item of rest) {
      counts.checked++;
      if (item.janCode) unchecked.push(item);
      else drop('noList', item);
    }
  }
  // 3. まだ足りなければ、上位の JAN コードの商品を調べる（有料のことがある。必要な数だけ、並べて、時間の上限つき）。
  //    もとの関連順で上から。全員で共有してよい製品（信頼するサイト等）で、名前がお店の商品と合うものだけ
  unchecked.sort((a, b) => position.get(a)! - position.get(b)!);
  // もう見つけた製品と同じ JAN コード・同じ JAN コードの別の出品は調べない（有料の調べものを重複に使わない）
  const seenJans = new Set(found.map((f) => normalJan(f.item.janCode)).filter(Boolean));
  const lookable: ShopItem[] = [];
  for (const item of unchecked) {
    const jan = normalJan(item.janCode);
    if (jan && seenJans.has(jan)) {
      drop('duplicate', item);
      continue;
    }
    if (jan) seenJans.add(jan);
    lookable.push(item);
  }
  const toLookup = input.allowPaidLookups
    ? lookable.slice(0, Math.max(0, Math.min(MAX_BARCODE_LOOKUPS, input.limit - found.length)))
    : [];
  counts.paidLookups = toLookup.length;
  // 調べない JAN コードの商品は、成分を確かめられなかった
  for (const item of lookable.slice(toLookup.length)) drop('noList', item);
  const looked = await Promise.all(toLookup.map((item) => withDeadline(lookupByBarcode(item.janCode!).catch(() => null))));
  looked.forEach((product, i) => {
    if (product && isShareable(product) && sameListing(product, toLookup[i])) consider(product, toLookup[i]);
    else drop('noList', toLookup[i]);
  });

  // 近い順に。同じ近さなら、確かめた順ではなくお店の関連順（交互の並び）。limit 件より後は出さない
  const shown = found.sort((a, b) => rank(b) - rank(a) || position.get(a.item)! - position.get(b.item)!).slice(0, input.limit);
  const products = shown.map(({ product, item }) => withShopInfo(product, item));
  const used = shown.map(({ item }) => item.shopId);
  const credits: PriceApiCredit[] = (['rakuten', 'yahoo'] as const).filter((s) => used.includes(s));
  counts.notChecked = items.length - counts.checked;
  counts.shown = products.length;
  counts.notShown = found.length - shown.length;
  return { status: 'ok', products, credits, counts };
}
