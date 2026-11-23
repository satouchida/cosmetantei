import 'server-only';
import { CulpritIngredient, PriceApiCredit, Product } from '../types';
import { COSMETICS_DATABASE, isShareable } from '../data/cosmetics-db';
import { AlternativeGateReason, alternativeGateReason } from '../analyzer/alternative-gate';
import { AlternativeCategory, CATEGORY_LABELS_JA, candidateSubKind, categoryFromText, SubKind, subKindFit, subKindFromText } from '../analyzer/product-category';
import { bestFormSimilarity, FORM_LABELS_JA, FormProfile, formFromText, formProfile, formSimilarity, hasFormProfile, ProductForm } from '../analyzer/product-form';
import { CATEGORY_SYNONYMS, searchKey } from '../search/product-match';
import { isSameProduct, normalJan, ProductIdentity } from '../search/product-identity';
import { buildBrandIndex, IndexedBrand, textHasBrand } from './brand-suggest';
import { findSavedByBarcode, lookupByBarcode } from './search-barcode-service';
import { API_INTERVAL_MS, isRakutenApiConfigured, isYahooApiConfigured, rakutenItemSearch, ShopItem, yahooItemSearch } from './shop-apis';
import { ingredientListKey, ingredientsFromCaption, janFromCaption, shopListingProduct } from './shop-ingredients';
import { brandTagInListingName, listingVariant, LOOSE_NOISE, makerInListingName, notSingleItem, withoutListingNoise, withoutSearchTags } from '../search/listing-name';
import { shopLink } from './shops';

/**
 * 代わりの商品を、楽天市場・Yahoo!ショッピングの商品検索から探す（docs/plans/alternative-recommendations.md の step 3）
 * - 検索語は種類（下位の種類）の名前と決まった語（「無香料」「ノンケミカル」など）だけ。利用者が入力した文・成分表示は
 *   送らない。種類はお店のジャンル（step 2 で確かめた ID）でも絞る。確かめた ID の無い下位の種類は絞らない
 * - 成分は安い順に確かめる（1 と 2 の候補を、お店の関連順のまま先に。どちらも無い候補は、足りないときだけ 3 へ）：
 *   1. Yahoo! の JAN コードで、保存済みの確かめた製品（費用なし）
 *   2. 楽天の商品説明の全成分（shop-ingredients.ts。その返答にだけ使う。楽天の規約 第10条 (9)）
 *   2b. まだ確かめられない Yahoo! の商品の JAN コードで楽天を探し、同じ商品の出品の説明の全成分（費用なし。数回まで）
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
 * （乳液は 2026-10-18、クレンジングは 2026-11-22）。確かめた ID の無いものはジャンルで絞らず、名前の語で確かめる（ID を推測しない）。
 * ここに無い下位の種類（洗顔料・顔のクリーム・顔用や下地の日焼け止め・口紅・洗い流すパック）は、
 * 種類の名前と種類のジャンルで探す（その種類のジャンルに入っている）
 * 自分の ID が無くても、種類のジャンルの一部なら種類のジャンルで絞る（ジャンル無しでは別の種類ばかり返る。実測 2026-11-18）：
 * からだ用の日焼け止め（日焼け止めのジャンル）・シートマスク（パックのジャンル）。種類のジャンルに入っているか分からない
 * ものは絞らない：ボディソープ・ボディローション・ハンド・からだ用・目元のクリーム・オールインワン（お店ではボディケア等の
 * 別のジャンル）、保湿ジェル（クリームのジャンルか分からない）、リップクリーム（リップのジャンルが口紅側か分からない。
 * ジャンル無しで見つかっている）、拭き取り化粧水（化粧水のジャンルに入るか確かめていない。名前の語で探し、種類は名前で確かめる）
 */
const SUB_KIND_SEARCH: Partial<Record<AlternativeCategory, Partial<Record<SubKind, { label: string; genre?: ShopGenre }>>>> = {
  cleanser: {
    // 楽天は「クレンジング」（210450。バーム・オイル・ジェル・ミルク等を含む）。405100 は「クレンジングジェル」で、
    // バーム・オイルが見つからなかった（2026-11-22 に楽天の検索ページで確かめた。docs/plans/shop-names-and-cleansing-genre.md）。
    // Yahoo! の 48902 は「クレンジング」
    makeup_remover: { label: 'クレンジング', genre: { rakuten: 210450, yahoo: 48902 } },
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
  toner: { body_lotion: { label: 'ボディローション' }, wipe_off: { label: '拭き取り化粧水' } },
  // ファンデーションのジャンルの中で、形の名前で探す。BB・CC クリームはファンデーションのジャンルに入るか確かめていない
  foundation: {
    cushion: { label: 'クッションファンデーション', genre: GENRES.foundation },
    serum_foundation: { label: '美容液ファンデーション', genre: GENRES.foundation },
    powder: { label: 'パウダーファンデーション', genre: GENRES.foundation },
    bb_cc: { label: 'BBクリーム' },
  },
};

/** お店で探す種類の語（Web で探す検索語も同じ語にする） */
export function shopSearchLabel(category: AlternativeCategory, subKind: SubKind | undefined): string {
  return shopSearchFor(category, subKind).label;
}

/** お店で探す語とジャンル。下位の種類の決まった検索語があればそれ、無ければ種類の名前とジャンル */
function shopSearchFor(category: AlternativeCategory, subKind: SubKind | undefined): { label: string; genre?: ShopGenre } {
  const bySubKind = subKind && SUB_KIND_SEARCH[category]?.[subKind];
  return bySubKind ?? { label: CATEGORY_LABELS_JA[category], genre: GENRES[category] };
}

/** 出品者が商品名に形を書く種類（docs/plans/alternative-search-improvements.md「Path 2」） */
const FORM_SEARCH_KINDS: ReadonlySet<AlternativeCategory> = new Set(['sunscreen', 'cleanser', 'cream']);

/**
 * お店の検索語に足す形の語。形を書く種類で、探す名前（「乳液」「ハンドクリーム」等）がまだ形を言っていないときだけ
 * （「乳液 クリーム」のように食い違う語で結果を減らさない）
 */
export function shopFormWord(category: AlternativeCategory, subKind: SubKind | undefined, form: ProductForm | undefined): string | undefined {
  if (!form || !FORM_SEARCH_KINDS.has(category)) return undefined;
  return formFromText(shopSearchFor(category, subKind).label) ? undefined : FORM_LABELS_JA[form];
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
/**
 * Yahoo! の JAN コードで楽天を探す回数の上限（1回の押下で）。ボタン1回で出すのは3件なので、3件そろえるのに足りる数。
 * 楽天は1秒に1回までなので順番に呼び、待ち時間は約3秒まで増える。楽天の呼び出しは全員で1分50回まで（spend-cap.ts）なので、
 * 1回の押下で最初の検索と合わせて4回まで（それ以上は、待ち時間と全員の枠を使いすぎる）
 */
const MAX_RAKUTEN_JAN_LOOKUPS = 3;
/** JAN コードで楽天を探す手順に使ってよい時間（ふつうは3回で約3秒。遅いときはここで止める） */
const JAN_STEP_BUDGET_MS = 6_000;
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
  /**
   * 一緒に出す保存済みの製品。全成分を読んだ後、同じ製品のお店の出品は duplicate として外し、ほかの出品で探し続ける
   * （docs/plans/shop-dedupe-and-yahoo-link-log.md「Step 1」）
   */
  shownSaved?: ProductIdentity[];
  limit: number;
  /**
   * 足りないときに JAN コードで製品を調べてよいか（有料のことがある）。サーバーが持っている製品から探すときだけ。
   * ブラウザから送られただけの製品（入力した成分表示・お店の説明から読んだ製品）では調べない
   */
  allowPaidLookups?: boolean;
  /** お店の API を続けて呼ぶ間隔（ミリ秒）。既定は API_INTERVAL_MS（1秒に1回まで）。変えるのは評価のスクリプト・テストだけ */
  shopCallIntervalMs?: number;
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
 * duplicate: 同じ製品がもう候補にある（一緒に出す保存済みの製品を含む）
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
 * 同じ JAN コードの楽天の出品を使わなかった理由（確かめる順）。set: セット・まとめ売り / name: 名前が合わない（sameJanListing） /
 * variant: 型・版の語や数が違う（variantMarks） / noCaption: 説明が無い / noList: 説明から全成分を読めない
 */
export const JAN_MISS_REASONS = ['set', 'name', 'variant', 'noCaption', 'noList'] as const;
export type JanMissReason = (typeof JAN_MISS_REASONS)[number];

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
  /**
   * Yahoo! の JAN コードで楽天の同じ商品を探した数。tried: 楽天を呼んだ回数（失敗・回数の上限で断られた1回も） /
   * sameJan: 同じ JAN コードの出品があった /
   * found: 名前も合い、全成分を読めた（確認に回した。その結果は dropped・shown などに数える） /
   * why: 同じ JAN コードの出品があったのに使わなかった理由（JanMissReason。1件を1つにだけ数える） /
   * 使わなかった理由は、Yahoo! の商品ごとに、同じ JAN コードの出品のうちいちばん先の確かめまで進んだものの理由なので、いつも
   *   tried = (tried - sameJan) + why.set + why.name + why.variant + why.noCaption + why.noList + found
   * になる（テスト 175 で確かめる）
   */
  janToRakuten: { tried: number; sameJan: number; found: number; why: Record<JanMissReason, number> };
  /** JAN コードで調べた数（有料のことがある） */
  paidLookups: number;
  shown: number;
  /**
   * 確認は通ったが、下位の種類・形のより近い候補が limit 件あったので出さなかった数（近い候補を探して確かめ続けたとき）。
   * checked は、確かめた後に落とした数・shown・これの合計になる
   */
  notShown: number;
  /**
   * dropped.otherKind のうち、全成分を読んだ後の確認（alternativeGateReason の kind）で外した数。返答で、読めた商品を
   * 出さなかった理由を書く
   */
  otherKindAfterRead: number;
  /**
   * 楽天の出品を出したカードの、同じ商品の Yahoo! の出品へのリンク（yahooTwin）。rakutenShown: 楽天の出品を出したカードの数 /
   * linked: リンクを付けた数 / why: 付けなかったカードの、いちばん先まで進んだ確かめの理由（YahooLinkMiss）。いつも
   * rakutenShown = linked + why の合計（docs/plans/shop-dedupe-and-yahoo-link-log.md「Step 2」）
   */
  yahooLink: { rakutenShown: number; linked: number; why: Record<YahooLinkMiss, number> };
}

/**
 * 楽天のカードに Yahoo! のリンクを付けなかった理由（確かめる順）。noJan: 楽天の出品が JAN コードを書いていない /
 * noYahoo: 同じ検索の Yahoo! の商品に、その JAN コードのものが無い / set: セット・まとめ売り / name: 名前が合わない /
 * variant: 型・版の語が違う
 */
export const YAHOO_LINK_MISSES = ['noJan', 'noYahoo', 'set', 'name', 'variant'] as const;
export type YahooLinkMiss = (typeof YAHOO_LINK_MISSES)[number];

function emptyCounts(): ShopSearchCounts {
  return {
    fetched: { rakuten: 0, yahoo: 0 },
    dropped: { otherKind: 0, notSingle: 0, excluded: 0, noList: 0, suspect: 0, irritant: 0, standard: 0, unrated: 0, duplicate: 0 },
    noListByShop: { rakuten: 0, yahoo: 0 },
    checked: 0,
    notChecked: 0,
    janToRakuten: { tried: 0, sameJan: 0, found: 0, why: { set: 0, name: 0, variant: 0, noCaption: 0, noList: 0 } },
    paidLookups: 0,
    shown: 0,
    notShown: 0,
    otherKindAfterRead: 0,
    yahooLink: { rakutenShown: 0, linked: 0, why: { noJan: 0, noYahoo: 0, set: 0, name: 0, variant: 0 } },
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

/**
 * お店の商品のブランド名。Yahoo! はブランドの欄。楽天は商品名の先頭の「〇〇化粧品」か、【】の中にも書いた先頭の語
 * （一覧のブランドならその名前。種類の語「【化粧水】」は除く）、無ければ商品名にある一覧のブランド
 * （先頭の会社名のほうが、後ろの「〇〇対応」などの語より確か）
 */
export function brandOf(item: ShopItem, brands: IndexedBrand[]): string {
  if (item.brands[0]) return item.brands[0];
  const tagged = brandTagInListingName(item.name);
  const maker = makerInListingName(item.name) || (tagged && !categoryFromText(tagged) ? tagged : '');
  const listed = (text: string) => brands.find((b) => textHasBrand(text, b))?.entry.name;
  return maker ? (listed(maker) ?? maker) : (listed(item.name) ?? '');
}

/** 表示用に、お店の写真・価格・リンクを付ける（その返答にだけ使う。保存しない） */
function withShopInfo(product: Product, item: ShopItem): Product {
  const link = shopLink(item.shopId, item.url);
  return {
    ...product,
    ...(!product.imageUrl && item.imageUrl && { imageUrl: item.imageUrl }),
    ...(item.priceYen && { shopPrice: { yen: item.priceYen, taxIncluded: item.taxIncluded, variant: listingVariant(item.name) } }),
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

/**
 * 楽天の出品が、この JAN コード（normalJan の形）を書いているか。説明に JAN コードがあればそれで決める（説明が別の JAN コードを
 * 書いていれば、名前に数字があってもセット・別の型の出品なので使わない）。説明に無いときだけ、名前の数字の並びを見る
 */
function listingCarriesJan(listing: ShopItem, jan: string): boolean {
  // どの JAN コードを書いているかは rakutenJans だけで決める（Yahoo! のリンクの確かめと食い違わないように）
  return jan !== '' && rakutenJans(listing).includes(jan);
}

/**
 * 同じ系列の別の型を分ける語（I・II・III、しっとり・さっぱり等、SPF・PA の値、無香料）。系列のキーは片方がもう片方に含まれれば
 * 合うので、「キュレル 化粧水」が「キュレル 化粧水 III とてもしっとり」にも合ってしまう。JAN コードで見つけた楽天の出品は、
 * 出品者が別の型の JAN コードを書いていることがあるので、この語が両方で同じときだけ同じ商品とする
 */
const VARIANT_WORDS = ['とてもしっとり', 'しっとり', 'さっぱり', 'しっかり', 'みずみずしい', 'リッチ', 'モイスト', 'ライト', '無香料'];
// SPF の値は下の数（NUMBER_MARK）で比べる（「SPF50+」と「50+」を同じに、「SPF50+」と「SPF50」を別に）
const VARIANT_MARK = new RegExp(`(?<![A-Za-z])(?:I{1,3}|IV|V)(?![A-Za-z])|[Ⅰ-Ⅹ]|${VARIANT_WORDS.join('|')}|PA\\s*\\++`, 'gi');
/** 照合用のキー（searchKey の形）の中の型の語（nameWords で、ブランドを外した後に外す。「ヨミV」の V を型にしない） */
const VARIANT_KEY = new RegExp(`(?<![a-z])(?:i{1,3}|iv|v)(?![a-z])|${VARIANT_WORDS.map(searchKey).join('|')}|spf\\d+|pa\\++`, 'g');

/**
 * 同じ系列の別の版を分ける語（男性用・赤ちゃん用・限定・お試し・ミニ・上位版・香り）。片方の名前にだけあれば別の商品
 * （「極潤」と「極潤プレミアム」、「ローズ」と「ラベンダー」）。型の語と同じく variantMarks で比べ、nameWords の語からは外す。
 * 「赤ちゃんにも使える」は版ではないので数えない。薬用は入れない（同じ医薬部外品を、出品者が書かないことが多い）
 */
const VERSION_GROUPS: Record<string, string> = {
  men: `(?:メンズ|男性|(?<![A-Za-z])MEN(?:['’]?S)?(?![A-Za-z]))(?!にも|も|から)`,
  baby: `(?:ベビー|赤ちゃん)(?!にも|も|から)`,
  kids: `キッズ(?!にも|も|から)`,
  // 「期間限定ポイント10倍」「お試し価格」は売り方の宣伝なので数えない
  limited: '(?<!期間)限定(?!価格|特価|セール|クーポン|ポイント)',
  collab: 'コラボ',
  trial: '(?:トライアル|お試し)(?!価格)',
  mini: 'ミニ(?!マ|ウム)',
  premium: 'プレミアム',
  rose: 'ローズ(?!マリー|ヒップ)',
  lavender: 'ラベンダー',
  citrus: 'シトラス',
  floral: 'フローラル',
  musk: 'ムスク',
  savon: 'サボン|せっけんの香り|石けんの香り',
  jasmine: 'ジャスミン',
};
const VERSION_MARK = new RegExp(
  Object.entries(VERSION_GROUPS)
    .map(([mark, pattern]) => `(?<${mark}>${pattern})`)
    .join('|'),
  'gi'
);
/**
 * 容量を外した後に残る数（「化粧水 1」と「化粧水 2」、「SPF50+」「50+」と「35」）。後に単位・語が続く数（10倍・1位・3種）は
 * 宣伝や成分の言い方なので数えない。8桁以上は JAN コード
 */
const NUMBER_MARK = /(?<!\d|\d\.)\d+(?:\.\d+)?\+?(?=$|[\s/|｜・,、:：)\]）】」』!！])/g;

export function variantMarks(name: string): string {
  const text = name.normalize('NFKC');
  // 「とてもしっとり」は「しっとり」も含むので、長い語を先に取った結果だけを使う
  const marks = (text.match(VARIANT_MARK) ?? []).map((m) => m.replace(/\s+/g, '').toUpperCase());
  for (const m of text.matchAll(VERSION_MARK)) marks.push(Object.keys(m.groups ?? {}).find((k) => m.groups?.[k]) ?? '');
  for (const [n] of text.replace(SIZE, ' ').replace(/SPF\s*|PA\s*\++/gi, ' ').matchAll(NUMBER_MARK)) {
    if (n.replace(/\D/g, '').length < 8) marks.push(`#${n}`);
  }
  return [...new Set(marks)].sort().join('|');
}

type CaptionLabel = NonNullable<Awaited<ReturnType<typeof ingredientsFromCaption>>>;

/**
 * 語に分ける前に外す飾り。withoutListingNoise が外さない括弧（LOOSE_NOISE）と、
 * 先頭の「店名 / 」「店名|」（2026-11-18 の4回目の測定で、名前で外れた 17 件のうち 3 件はこれだけの違い）
 */
const SHOP_PREFIX = /^[^/|]{1,30}(?:\||\s\/\s)\s*(?=\S)/;
const looseName = (name: string) => withoutListingNoise(name).replace(LOOSE_NOISE, ' ').replace(SHOP_PREFIX, '');

/**
 * どの商品の名前にも付く語（効能の宣伝・肌の種類・容器）。製品を分けないので、語の比べから外す。詰め替え・本体・ボトルは
 * 成分が同じなので分けない（product-identity.ts で容量・つめかえ用を分けないのと同じ）
 */
const GENERIC_WORDS: ReadonlySet<string> = new Set(
  [
    '医薬部外品', '国内正規品', '化粧品', '基礎化粧品', 'コスメ', 'スキンケア', '保湿', '敏感肌', '敏感肌用', '乾燥肌', '乾燥肌用',
    '単品', '本体', 'ボトル', '大容量', '詰め替え', '詰め替え用', '詰替', '詰替用', 'つめかえ', 'つめかえ用', 'レフィル', 'リフィル',
    '新品', 'JAN', 'JANコード',
  ].map(searchKey)
);
const ASCII_WORD = /^[a-z0-9]+$/;
/** 名前を語に分ける区切り（空白・記号）。区切りの無い日本語の続きは、ブランド・種類の語のところでさらに切る */
const WORD_BREAK = /[\s/|｜・,、:：]+/;

/**
 * 名前の語（照合用のキー）。飾り・容量・版の語を外して区切りで分け、ブランド・型の語・種類の語のところで切る
 * （「キュレル潤浸保湿化粧水III」→「潤浸保湿」。型・版の語は variantMarks で別に比べるので、二重に数えない）。
 * 英字のブランドは語の途中を切らない（続く語をつなげた形は外す）。1文字の語・数字だけの語（JAN コード等）・どの商品にも
 * 付く語は入れない
 */
function nameWords(name: string, brandKeys: readonly string[]): string[] {
  const text = looseName(name).normalize('NFKC').replace(SIZE, ' ').replace(VERSION_MARK, ' ');
  const tokens = text.split(WORD_BREAK).map(searchKey).filter(Boolean);
  const asciiBrands = brandKeys.filter((k) => ASCII_WORD.test(k));
  const otherBrands = brandKeys.filter((k) => !ASCII_WORD.test(k));
  const dropped = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    let joined = '';
    for (let j = i; j < tokens.length && ASCII_WORD.test(tokens[j]); j++) {
      joined += tokens[j];
      if (asciiBrands.includes(joined)) for (let d = i; d <= j; d++) dropped.add(d);
    }
  }
  const words: string[] = [];
  tokens.forEach((token, i) => {
    if (dropped.has(i)) return;
    let rest = token;
    for (const k of otherBrands) rest = rest.split(k).join(' ');
    rest = rest.replace(VARIANT_KEY, ' ');
    for (const k of CATEGORY_KEYS) rest = rest.split(k).join(' ');
    for (const w of rest.split(' ')) if (w.length >= 2 && !/^[0-9]+$/.test(w) && !GENERIC_WORDS.has(w)) words.push(w);
  });
  return words;
}

/** 長い語から外すための、どの商品にも付く語 */
const GENERIC_LONGEST_FIRST = [...GENERIC_WORDS].sort((a, b) => b.length - a.length);

/** 文字列が、これらの語とどの商品にも付く語だけでできているか（何も残らない） */
function madeOf(text: string, words: readonly string[]): boolean {
  let rest = text;
  for (const w of [...words].sort((a, b) => b.length - a.length).concat(GENERIC_LONGEST_FIRST)) rest = rest.split(w).join(' ');
  return rest.trim() === '';
}

/**
 * 語が、もう一方の名前の語にあるか（区切り方の違い「潤浸 保湿」「潤浸保湿」は問わない。英字の語は英字の途中に合わせない）。
 * もう一方の長い語の一部に当たるときは、はみ出した部分がこちらの語・どの商品にも付く語のときだけ（「潤浸保湿」は
 * 「潤浸保湿エイジングケア」の一部だが、こちらに「エイジングケア」が無ければ別の製品）。逆に、この語がもう一方の語とどの商品にも付く語
 * だけでできていても合う（「潤浸保湿」と「潤浸」。保湿は語に数えない）
 */
function wordAppears(word: string, own: readonly string[], others: readonly string[]): boolean {
  if (ASCII_WORD.test(word)) {
    const whole = new RegExp(`(?<![a-z0-9])${word}(?![a-z0-9])`);
    return others.some((o) => whole.test(o));
  }
  if (others.includes(word)) return true;
  const joined = others.join('');
  const starts = others.map((_, i) => others.slice(0, i).join('').length);
  for (let at = joined.indexOf(word); at >= 0; at = joined.indexOf(word, at + 1)) {
    const end = at + word.length;
    const first = starts.findLastIndex((s) => s <= at);
    const last = starts.findLastIndex((s) => s < end);
    if (madeOf(joined.slice(starts[first], at), own) && madeOf(joined.slice(end, starts[last] + others[last].length), own)) return true;
  }
  return madeOf(word, others);
}

/** 語の少ない方の語のうち、これだけの割合がもう一方にあれば「語の大半が同じ」（理由は sameJanListing のコメント） */
const SHARED_WORD_SHARE = 0.7;
/** 語の少ない方の語がこれより短い（文字の合計）と、どの製品かを比べられない */
const MIN_WORD_CHARS = 3;

/** ブランドの欄（Yahoo!）の文字列そのものが一覧のブランドならそれ（語の一部では探さない） */
function listedBrandOf(field: string, brands: IndexedBrand[]): IndexedBrand | undefined {
  const key = searchKey(field);
  return key ? brands.find((b) => b.keys.includes(key)) : undefined;
}

/** 名前を語に分ける区切り（ブランドの短いキーが語の頭にあるかを見る） */
const NAME_TOKEN_BREAK = /[\s/|｜・,，、:：()（）[\]［］【】「」『』〈〉《》≪≫]+/;

/**
 * 名前がこのブランドのものか（textHasBrand）。ただし会社名でないブランドの2文字以下の日本語のキーは、語の頭にあるときだけ
 * （「ペア」が「リペア」に当たらないように。textHasBrand はほかでも使うので、ここだけ厳しくする）
 */
function nameHasBrand(name: string, brand: IndexedBrand): boolean {
  if (brand.entry.maker) return textHasBrand(name, brand);
  const short = (k: string) => k.length <= 2 && !ASCII_WORD.test(k);
  const longKeys = brand.keys.filter((k) => !short(k));
  if (longKeys.length > 0 && textHasBrand(name, { ...brand, keys: longKeys })) return true;
  const shortKeys = brand.keys.filter(short);
  // 語の頭にあり、textHasBrand でも当たるもの（カタカナのキーは後ろに続くカタカナがない：「ダヴ」が「ダブル洗顔」に当たらない）
  return (
    shortKeys.length > 0 &&
    name.split(NAME_TOKEN_BREAK).some((t) => shortKeys.some((k) => searchKey(t).startsWith(k) && textHasBrand(t, { ...brand, keys: [k] })))
  );
}

/**
 * 2つの名前のブランドが同じか。same: 同じ（外すブランドのキー） / different: 別のブランド / unknown: 片方でも分からない、
 * または片方にだけ会社名でないブランドがある（どちらとも言えない）
 */
function brandAgreement(
  yahooItem: ShopItem,
  listing: ShopItem,
  brands: IndexedBrand[]
): { verdict: 'same'; keys: string[] } | { verdict: 'different' | 'unknown' } {
  const yahooName = withoutListingNoise(yahooItem.name);
  const listingName = withoutListingNoise(listing.name);
  const ofYahoo = new Set(brands.filter((b) => nameHasBrand(yahooName, b)));
  const ofListing = new Set(brands.filter((b) => nameHasBrand(listingName, b)));
  const field = yahooItem.brands[0] ?? '';
  const listed = listedBrandOf(field, brands);
  if (listed) ofYahoo.add(listed);
  else if (ofYahoo.size === 0 && searchKey(field).length >= 2) {
    // 一覧に無いブランドの欄は、楽天の名前がそれを含むかで比べる
    const own: IndexedBrand = { entry: { name: field }, keys: [searchKey(field)] };
    ofYahoo.add(own);
    if (nameHasBrand(listingName, own)) ofListing.add(own);
  }
  if (ofYahoo.size === 0 || ofListing.size === 0) return { verdict: 'unknown' };
  const both = [...ofYahoo].filter((b) => ofListing.has(b));
  if (both.length === 0) return { verdict: 'different' };
  const onlyOne = [...ofYahoo, ...ofListing].filter((b) => !both.includes(b));
  if (onlyOne.some((b) => !b.entry.maker)) return { verdict: 'unknown' };
  const keys = [...new Set([...ofYahoo, ...ofListing].flatMap((b) => b.keys))].sort((a, b) => b.length - a.length);
  return { verdict: 'same', keys };
}

/** 種類・下位の種類・形が食い違わないか（両方の名前が言うときだけ比べる。言わない方は合うとする） */
function kindsAgree(a: string, b: string): boolean {
  const differ = <T>(x: T | undefined, y: T | undefined) => x !== undefined && y !== undefined && x !== y;
  const kindA = categoryFromText(a);
  const kindB = categoryFromText(b);
  if (differ(kindA, kindB)) return false;
  const kind = kindA ?? kindB;
  return !differ(subKindFromText(kind, a), subKindFromText(kind, b)) && !differ(formFromText(a), formFromText(b));
}

/**
 * 2b（Yahoo! の JAN コードで見つけた楽天の出品）だけの名前の確かめ。3 の有料の調べもの・保存済みの製品は sameListing のまま。
 * 2人の出品者が同じ JAN コードを書いているのは強い手がかりなので、「一方の名前がもう一方を含む」までは求めない
 * （4回目の測定で、同じ JAN コードの 30 件のうち 17 件が名前で外れ、飾りだけの違いは 3 件。残りは語順・シリーズ名の有無）。
 * 次のすべてで同じ商品とする：
 * - 同じブランド：両方の名前が一覧（buildBrandIndex）の同じブランドに当たる。Yahoo! のブランドの欄も Yahoo! 側に数え、一覧に
 *   無いブランドの欄は楽天の名前がそれを含めばよい。片方にだけあってよいのは会社名（花王・資生堂など）だけ
 * - 同じ種類・下位の種類・形（両方の名前が言うときだけ。「化粧水」と「乳液」、「クリーム」と「ジェル」は同じ系列の別の商品）
 * - 語の大半が同じ：nameWords の語の少ない方の 7 割以上が、もう一方にある（順番は問わない）。7 割だと、3語までは全部、4〜6語は
 *   1語、7語からは2語まで違ってよい（宣伝の語が1つ混じっても落とさず、短い名前で製品名の語が違うものは別の商品とする）。
 *   もう一方の長い語の一部に当たるだけの語は、はみ出した部分がこちらに無ければ数えない（wordAppears）
 * - 語の少ない方の語が短すぎる（合わせて3文字未満）のに、もう一方にほかの語がある：どの製品か比べられない（両方とも語が無い・
 *   同じ短い語だけなら、ブランドと種類だけの同じ名前なので合う）
 * どちらかのブランドが分からないときは、語だけでは決めず、今までの sameListing（一方がもう一方を含む）。
 * 型・版の語と数（variantMarks。男性用・限定・ミニ・香り・名前の数など、片方にだけあれば別の商品）・セットの確かめは、
 * これとは別に続ける（listingMiss）
 */
export function sameJanListing(yahooItem: ShopItem, listing: ShopItem, brands: IndexedBrand[]): boolean {
  const brand = brandAgreement(yahooItem, listing, brands);
  if (brand.verdict !== 'same') return brand.verdict === 'unknown' && sameListing(yahooItem, listing);
  if (!kindsAgree(withoutListingNoise(yahooItem.name), withoutListingNoise(listing.name))) return false;
  const [fewer, more] = [nameWords(yahooItem.name, brand.keys), nameWords(listing.name, brand.keys)].sort(
    (a, b) => a.length - b.length || a.join('').length - b.join('').length
  );
  // 短すぎる名前は、もう一方の語がすべてこちらにもある（同じことしか言っていない）ときだけ
  if (fewer.join('').length < MIN_WORD_CHARS) return more.every((w) => wordAppears(w, more, fewer));
  return fewer.filter((w) => wordAppears(w, fewer, more)).length / fewer.length >= SHARED_WORD_SHARE;
}

/**
 * 同じ JAN コードの楽天の出品を、説明を読む前に使えないと分かる理由（JAN_MISS_REASONS の順に確かめる）。使えそうなら null。
 * どの理由も単なる条件なので、順番を変えても使う出品は変わらない（数えるために、最初に外れた理由を返す）
 */
function listingMiss(yahooItem: ShopItem, listing: ShopItem, sheet: boolean, brands: IndexedBrand[]): Exclude<JanMissReason, 'noList'> | null {
  if (notSingleItem(listing.name, sheet)) return 'set';
  if (!sameJanListing(yahooItem, listing, brands)) return 'name';
  if (variantMarks(listing.name) !== variantMarks(yahooItem.name)) return 'variant';
  if (!listing.caption) return 'noCaption';
  return null;
}

/**
 * Yahoo! の商品と同じ商品の楽天の出品と、その説明の全成分。JAN コードも名前も出品者が書いた値なので、両方が合うものだけ
 * （JAN コードが同じで、sameJanListing で名前も合う）。セット・まとめ売りの出品は使わない。
 * sameJan・miss は数えるためだけ。miss は、同じ JAN コードの出品のうちいちばん先の確かめまで進んだものの理由
 * （1件を1つの理由にだけ数え、合計が sameJan - found になるように）
 */
async function sameItemOnRakuten(
  yahooItem: ShopItem,
  listings: ShopItem[],
  sheet: boolean,
  brands: IndexedBrand[]
): Promise<{ sameJan: boolean; match: { listing: ShopItem; label: CaptionLabel } | null; miss: JanMissReason | null }> {
  const jan = normalJan(yahooItem.janCode);
  let sameJan = false;
  let furthest = -1;
  for (const listing of listings) {
    if (listing.shopId !== 'rakuten' || !listingCarriesJan(listing, jan)) continue;
    sameJan = true;
    let miss: JanMissReason | null = listingMiss(yahooItem, listing, sheet, brands);
    if (!miss) {
      const label = await ingredientsFromCaption(listing.caption!);
      if (label) return { sameJan, match: { listing, label }, miss: null };
      miss = 'noList';
    }
    furthest = Math.max(furthest, JAN_MISS_REASONS.indexOf(miss));
  }
  return { sameJan, match: null, miss: furthest >= 0 ? JAN_MISS_REASONS[furthest] : null };
}

/** 楽天の出品が書いている JAN コード（説明にあればそれだけ。無ければ名前の8〜14桁）。2b（listingCarriesJan）と Yahoo! のリンクで使う */
function rakutenJans(listing: ShopItem): string[] {
  const inCaption = listing.caption ? janFromCaption(listing.caption) : null;
  if (inCaption) return [normalJan(inCaption)].filter(Boolean);
  return (listing.name.normalize('NFKC').match(/(?<!\d)\d{8,14}(?!\d)/g) ?? []).map(normalJan).filter(Boolean);
}

/**
 * 楽天の出品（shown）を出す商品の、同じ商品の Yahoo! の出品。楽天の JAN コードの確かめ（2b）と同じ強さで確かめる：
 * - 2b で見つけた商品（item が Yahoo! の商品で、出すのは楽天の出品）は、その Yahoo! の商品
 * - 同じ検索の Yahoo! の商品で、その JAN コードを楽天の出品も書いていて（説明か名前）、1個の商品で、名前が合い（sameJanListing）、
 *   型・版の語が同じ（variantMarks）もの
 * 楽天の出品でなければ null。無ければ、いちばん先まで進んだ確かめの理由（数えるため。別の型・セットへのリンクは出さない）
 */
function yahooTwin(
  item: ShopItem,
  shownListing: ShopItem,
  yahooItems: readonly ShopItem[],
  sheet: boolean,
  brands: IndexedBrand[]
): { twin: ShopItem } | { twin?: undefined; why: YahooLinkMiss } | null {
  if (shownListing.shopId !== 'rakuten') return null;
  if (item.shopId === 'yahoo') return { twin: item };
  const jans = rakutenJans(shownListing);
  if (jans.length === 0) return { why: 'noJan' };
  const sameJan = yahooItems.filter((y) => jans.includes(normalJan(y.janCode)));
  if (sameJan.length === 0) return { why: 'noYahoo' };
  let furthest = -1;
  for (const y of sameJan) {
    const miss: YahooLinkMiss | null = notSingleItem(y.name, sheet)
      ? 'set'
      : !sameJanListing(y, shownListing, brands)
        ? 'name'
        : variantMarks(y.name) !== variantMarks(shownListing.name)
          ? 'variant'
          : null;
    if (!miss) return { twin: y };
    furthest = Math.max(furthest, YAHOO_LINK_MISSES.indexOf(miss));
  }
  return { why: YAHOO_LINK_MISSES[furthest] };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  // 楽天を続けて呼ぶとき（下の 2b）に、前の呼び出しから間をあけるため
  let rakutenCalledAt = Date.now();
  const [rakuten, yahoo] = await Promise.all([
    // 終わった時刻から数える（429 で一度やり直したときも、次の呼び出しを続けて送らない）
    rakutenItemSearch(keyword, { caption: true, genreId: genre?.rakuten }).finally(() => {
      rakutenCalledAt = Date.now();
    }),
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
      if (notSingleItem(item.name, sheet)) {
        drop('notSingle', item);
        continue;
      }
      // 別の種類（ジャンルが広い・名前が別の種類を言う）・別の下位の種類（クレンジングに洗顔料）と、勧めない製品
      // （同じ製品・同じシリーズ）は除く
      const kind = categoryFromText(name);
      if ((kind && kind !== input.category) || subKindFit(input.subKind, candidateSubKind(input.subKind, input.category, name), input.category) === 'other') {
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
  // item: お店が返した候補（数・順位・関連順はこれで）。listing: 表示する別の出品（Yahoo! の商品を JAN コードで楽天に見つけたとき）
  const found: { product: Product; item: ShopItem; listing?: ShopItem; listKey: string }[] = [];
  // 同じ製品は1つだけ（別のお店・別の容量・先頭の 0 の違う JAN コード）。確かめた後で比べる
  // （確かめられない同じ製品の出品が先にあっても、確かめられる出品を落とさない）
  // 名前の後のお店の分類・管理の語（「ボディローション・ジェル」「ヴァセリン ヴアセリンアドバンスムコウ400」）も外して比べる
  const listingKey = (item: ShopItem) => searchKey(withoutSearchTags(withoutListingNoise(item.name)).replace(SIZE, ''));
  const add = (product: Product, item: ShopItem, listing?: ShopItem) => {
    // 全成分の比べる形（空の一覧どうしは同じにしない）
    const list = ingredientListKey(product.ingredients);
    const key = listingKey(item);
    // 楽天で見つけた商品は、表示する楽天の出品の名前でも比べる（無料の確かめで見つけた楽天の出品と同じ商品）
    const shownKey = listingKey(listing ?? item);
    const jan = normalJan(item.janCode);
    const duplicate = found.some(
      (f) =>
        f.product.id === product.id ||
        (list !== '' && f.listKey === list) ||
        listingKey(f.item) === key ||
        listingKey(f.listing ?? f.item) === shownKey ||
        (jan !== '' && normalJan(f.item.janCode) === jan)
    );
    if (duplicate) drop('duplicate', item);
    else found.push({ product, item, ...(listing && { listing }), listKey: list });
  };
  const shownSaved = input.shownSaved ?? [];
  const consider = (product: Product, item: ShopItem, listing?: ShopItem) => {
    const reason = rejection(product);
    if (reason === 'otherKind') counts.otherKindAfterRead++;
    if (reason) drop(reason, item);
    // 一緒に出す保存済みの製品と同じ製品は出さず、ほかの出品で探し続ける（名前の書き方が違い、読む前の名前の系列では外れなかったもの）
    else if (shownSaved.some((saved) => isSameProduct(saved, product))) drop('duplicate', item);
    else add(product, item, listing);
  };
  // 並べ替えの順位：同じ下位の種類が先（名前で分からない候補は後）、次に形・使う場所の近さ（product-form.ts）
  const profile = hasFormProfile(input.profile) ? input.profile : undefined;
  const rank = ({ item }: { item: ShopItem }) => {
    const name = withoutListingNoise(item.name);
    const sameSubKind = subKindFit(input.subKind, candidateSubKind(input.subKind, input.category, name), input.category) === 'same';
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
  // まだ確かめられない JAN コードの商品を、もとの関連順に（2b の楽天、3 の有料の調べものの順）
  unchecked.sort((a, b) => position.get(a)! - position.get(b)!);
  // もう見つけた製品と同じ JAN コード・同じ JAN コードの別の出品は調べない（楽天・有料の調べものを重複に使わない）
  const foundJans = new Set(found.map((f) => normalJan(f.item.janCode)).filter(Boolean));
  const seenJans = new Set(foundJans);
  const lookable: ShopItem[] = [];
  for (const item of unchecked) {
    const jan = normalJan(item.janCode);
    if (jan && seenJans.has(jan)) {
      // 見つけた製品と同じ JAN コードだけが重複（返答で「見つけた商品と同じ製品の別の出品」と言う）。まだ確かめていない商品と
      // 同じなら、その説明は読んでいないので成分表示なし（先の商品が見つからなくても、見つけたとは言わない）
      drop(foundJans.has(jan) ? 'duplicate' : 'noList', item);
      continue;
    }
    if (jan) seenJans.add(jan);
    lookable.push(item);
  }
  // 2b. Yahoo! の説明には全成分がほとんど無いが、JAN コードはある。同じ JAN コードの楽天の出品の説明から全成分を読む（無料）。
  //     足りない間だけ、関連順に MAX_RAKUTEN_JAN_LOOKUPS 回まで、1秒に1回の決まりに合わせて順番に呼ぶ（有料の調べものより先）。
  //     楽天に送るのは JAN コード（数字）だけ。読んだ説明はこの返答にだけ使う。楽天で見つけた商品は有料の調べものに回さない
  const viaRakuten = new Set<ShopItem>();
  // 最初の楽天の検索が失敗した（回数の上限・障害）なら、続けて呼ばない
  if (isRakutenApiConfigured() && rakuten !== null) {
    const interval = input.shopCallIntervalMs ?? API_INTERVAL_MS;
    const startedAt = Date.now();
    for (const item of lookable) {
      if (found.length >= input.limit || counts.janToRakuten.tried >= MAX_RAKUTEN_JAN_LOOKUPS) break;
      // この手順全体の時間の上限（遅い応答が続いても、ボタンを押してからの待ち時間を延ばしすぎない）
      if (Date.now() - startedAt > JAN_STEP_BUDGET_MS) break;
      const jan = item.janCode ?? '';
      if (item.shopId !== 'yahoo' || !/^[0-9]{8,14}$/.test(jan) || !normalJan(jan)) continue;
      const since = Date.now() - rakutenCalledAt;
      if (since < interval) await wait(interval - since);
      counts.janToRakuten.tried++;
      const listings = await rakutenItemSearch(jan, { caption: true });
      rakutenCalledAt = Date.now();
      // 失敗（通信・回数の上限）なら、続けて呼ばない
      if (!listings) break;
      const { sameJan, match, miss } = await sameItemOnRakuten(item, listings, sheet, brands);
      if (sameJan) counts.janToRakuten.sameJan++;
      if (miss) counts.janToRakuten.why[miss]++;
      if (!match) continue;
      counts.janToRakuten.found++;
      viaRakuten.add(item);
      // 確認・数え方はほかのお店の候補と同じ（数えるのは Yahoo! の候補として。表示は楽天の出品）
      consider(shopListingProduct(match.listing, brandOf(match.listing, brands), match.label), item, match.listing);
    }
  }
  // 3. まだ足りなければ、上位の JAN コードの商品を調べる（有料のことがある。必要な数だけ、並べて、時間の上限つき）。
  //    もとの関連順で上から。全員で共有してよい製品（信頼するサイト等）で、名前がお店の商品と合うものだけ
  const payable = lookable.filter((item) => !viaRakuten.has(item));
  const toLookup = input.allowPaidLookups
    ? payable.slice(0, Math.max(0, Math.min(MAX_BARCODE_LOOKUPS, input.limit - found.length)))
    : [];
  counts.paidLookups = toLookup.length;
  // 調べない JAN コードの商品は、成分を確かめられなかった
  for (const item of payable.slice(toLookup.length)) drop('noList', item);
  const looked = await Promise.all(toLookup.map((item) => withDeadline(lookupByBarcode(item.janCode!).catch(() => null))));
  looked.forEach((product, i) => {
    if (product && isShareable(product) && sameListing(product, toLookup[i])) consider(product, toLookup[i]);
    else drop('noList', toLookup[i]);
  });

  // 近い順に。同じ近さなら、確かめた順ではなくお店の関連順（交互の並び）。limit 件より後は出さない
  const shown = found.sort((a, b) => rank(b) - rank(a) || position.get(a.item)! - position.get(b.item)!).slice(0, input.limit);
  // 楽天の出品を出す商品に、同じ商品の Yahoo! の出品も付ける（docs/plans/alternatives-live-review-2026-11-23.md「Step 6」）
  const twinChecks = shown.map(({ item, listing }) => yahooTwin(item, listing ?? item, yahoo ?? [], sheet, brands));
  const twins = twinChecks.map((c) => c?.twin);
  for (const c of twinChecks) {
    if (!c) continue;
    counts.yahooLink.rakutenShown++;
    if (c.twin) counts.yahooLink.linked++;
    else counts.yahooLink.why[c.why]++;
  }
  // 楽天で見つけた Yahoo! の商品は、楽天の出品の写真・価格・リンク（表示する価格・写真は楽天のデータだけ）
  const products = shown.map(({ product, item, listing }, i) => {
    const twin = twins[i];
    return { ...withShopInfo(product, listing ?? item), ...(twin && { yahooLink: shopLink('yahoo', twin.url) }) };
  });
  // クレジットは使ったお店（Yahoo! のリンクを付けたら Yahoo! も）
  const used = [...shown.map(({ item, listing }) => (listing ?? item).shopId), ...(twins.some(Boolean) ? (['yahoo'] as const) : [])];
  const credits: PriceApiCredit[] = (['rakuten', 'yahoo'] as const).filter((s) => used.includes(s));
  counts.notChecked = items.length - counts.checked;
  counts.shown = products.length;
  counts.notShown = found.length - shown.length;
  return { status: 'ok', products, credits, counts };
}
