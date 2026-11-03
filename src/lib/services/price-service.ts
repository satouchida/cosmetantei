import 'server-only';
import { PriceApiCredit, PriceOffer, PriceResult } from '../types';
import { buildAmazonAffiliateUrl } from './amazon-affiliate';
import { rakutenOffers, ShopOfferCandidate, yahooOffers } from './shop-apis';
import { ShopId, shopLink, shopOfUrl, SHOPS } from './shops';
import { toProductSearchQuery } from './web-research';
import { isPlainLabelText } from '../utils/safe-text';

/**
 * 販売価格の確認（T4）。手順: docs/plans/gemini-role-redesign.md「Phases 3 and 4」、docs/plans/shop-prices.md
 * - 価格は無料の API があるお店（楽天市場・楽天24・Yahoo!ショッピング）のものだけ。商品ページの読み取り
 *   （Web 検索と Gemini で費用がかかる）はしない（オーナーの判断 2026-11-03）。API のキーが無いお店は調べない
 * - 検索語は商品名だけ（toProductSearchQuery を通す）
 * - 価格は出典・範囲・商品名をコードで確かめる
 * - API の結果・返答は保存しない（API の規約。docs/plans/shop-prices.md）
 */

const MIN_PRICE_YEN = 100;
const MAX_PRICE_YEN = 100_000;
const MAX_OFFERS = 6;
/** 1つのお店の結果だけで埋まらないように */
const MAX_OFFERS_PER_MARKETPLACE = 2;
/** 同じ商品ページの結果はこの数まで */
const MAX_OFFERS_PER_PAGE = 3;
const MAX_SHOP_LENGTH = 60;
const MAX_PRODUCT_NAME_LENGTH = 150;
/** 商品名にある、まとめ売り・中古・ふるさと納税の返礼品など、1個の店頭の価格ではないもの */
export const NOT_SINGLE_ITEM =
  /\d+\s*(?:個|本|点|箱|袋|パック)\s*(?:セット|組|パック)|[x×]\s*\d+\s*(?:個|本|点|箱|袋|セット)|まとめ買い|まとめ売り|セット品|福袋|中古|訳あり|サンプル|試供品|ふるさと納税|返礼品/i;

/** 価格を尋ねる言い回し。商品名の前後から取り除いてから toProductSearchQuery に渡す */
const PRICE_WORDS =
  '最安値?|一番安い(?:店|お店|ところ)?|安く買える(?:店|お店|ところ)?|安く買(?:いたい|えます|う方法)|安い(?:店|お店)|価格比較|価格|値段|定価|いくら|どこで(?:買える|買えます|買う|売ってる|売っている|売っています)|どこに(?:売ってる|売っている|売っています|ある|あります)';
const PRICE_SUFFIX = new RegExp(
  `\\s*(?:の|は|を|って|、)?\\s*(?:${PRICE_WORDS})(?:を|は|が|って)?(?:教えて(?:ください|下さい)?|知りたい(?:です)?|調べて(?:ください|下さい)?|ですか|でしょうか|か)?[。．.!！?？\\s]*$`
);
const PRICE_PREFIX = new RegExp(`^(?:${PRICE_WORDS})\\s*[:：]?\\s*`);

/**
 * 価格の質問から、検索に使ってよい商品名だけを取り出す。商品名と言えなければ null（検索しない）
 */
export function toPriceSearchQuery(text: string): string | null {
  let q = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) {
    const next = q.replace(PRICE_SUFFIX, '').replace(PRICE_PREFIX, '').trim();
    if (next === q) break;
    q = next;
  }
  // 「このクリーム」「その化粧水」は商品名ではない（有料の検索をしない）
  if (/^(この|その|あの|これ|それ|あれ)/.test(q)) return null;
  return toProductSearchQuery(q);
}

/** 比較用に、空白・記号を除いて小文字にする */
function compact(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[\s・･.,、。()（）\[\]【】「」'"’/／-]/g, '');
}

/** ページの商品が、調べた商品名の語をすべて含むか（別の商品の価格を出さない） */
export function offerMatchesQuery(brand: string, productName: string, query: string): boolean {
  const haystack = compact(`${brand}${productName}`);
  const tokens = query.split(' ').map(compact).filter(Boolean);
  // 比べる語が無ければ、どの商品も同じ商品とはみなさない
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
}

/** 並べ替え用の価格。税抜と書かれた価格は消費税 10% を足して比べる */
function comparablePrice(offer: PriceOffer): number {
  return offer.taxIncluded === false ? Math.floor(offer.priceYen * 1.1) : offer.priceYen;
}

interface SourceOutcome {
  /** null: 調べられなかった */
  offers: ShopOfferCandidate[] | null;
  credit?: PriceApiCredit;
}

/** 価格を調べるお店（無料の API があるお店だけ） */
const PRICE_SHOPS: readonly ShopId[] = ['rakuten', 'yahoo'];

/** API のキーがあるお店だけを API で調べる */
async function collectOffers(productQuery: string): Promise<SourceOutcome[]> {
  const [rakuten, yahoo] = await Promise.all([rakutenOffers(productQuery), yahooOffers(productQuery)]);
  const outcomes: SourceOutcome[] = [];
  if (rakuten === undefined && yahoo === undefined) console.error('Price lookup skipped: no shop API key configured');
  if (rakuten !== undefined) outcomes.push({ offers: rakuten, credit: 'rakuten' });
  if (yahoo !== undefined) outcomes.push({ offers: yahoo, credit: 'yahoo' });
  return outcomes;
}

/**
 * 決まったお店で商品を探し、確かめた価格を安い順に返す。
 * productQuery は toProductSearchQuery / toPriceSearchQuery を通した商品名であること
 */
export async function researchPrices(productQuery: string): Promise<PriceResult> {
  const result: PriceResult = {
    productQuery,
    status: 'unavailable',
    offers: [],
    checkedAt: new Date().toISOString(),
    amazonUrl: buildAmazonAffiliateUrl('', productQuery),
    credits: [],
  };
  const outcomes = await collectOffers(productQuery);
  if (outcomes.length === 0 || outcomes.every((o) => o.offers === null)) return result;
  result.status = 'ok';
  // 一方のお店を調べられなかったときは、見つからなくても「どちらにも無い」とは言わない
  const someFailed = outcomes.some((o) => o.offers === null);

  const offers: (PriceOffer & { credit?: PriceApiCredit })[] = [];
  const perPage = new Map<string, number>();
  const seen = new Set<string>();
  for (const { offers: candidates, credit } of outcomes) {
    for (const c of candidates ?? []) {
      // 対象のお店の商品ページだけ（API の結果も確かめる）
      if (shopOfUrl(c.sourceUrl) !== c.shopId) continue;
      const { priceYen } = c;
      // API の内容は信頼できない入力。ありえない金額・別の商品は使わない
      if (typeof priceYen !== 'number' || !Number.isInteger(priceYen)) continue;
      if (priceYen < MIN_PRICE_YEN || priceYen > MAX_PRICE_YEN) continue;
      let name = c.productName;
      if (!name) continue;
      // API の文で、リンク・書式・見えない文字を表示に入れさせない
      if (!isPlainLabelText(name) || (c.shop && !isPlainLabelText(c.shop))) continue;
      if (NOT_SINGLE_ITEM.test(name.normalize('NFKC'))) continue;
      if (!offerMatchesQuery(c.brand, name, productQuery)) continue;
      // API の商品名は宣伝文句で長いことがある。確かめたあとで表示用に短くする
      if (name.length > MAX_PRODUCT_NAME_LENGTH) name = `${name.slice(0, MAX_PRODUCT_NAME_LENGTH - 1)}…`;
      const count = perPage.get(c.sourceUrl) ?? 0;
      if (count >= MAX_OFFERS_PER_PAGE) continue;
      const marketplace = SHOPS[c.shopId].label;
      const shop = c.shop && c.shop.length <= MAX_SHOP_LENGTH ? c.shop : marketplace;
      // 同じ店の同じ商品・同じ価格が複数のページにあれば1件にする
      const key = `${compact(shop)}|${compact(name)}|${priceYen}`;
      if (seen.has(key)) continue;
      seen.add(key);
      perPage.set(c.sourceUrl, count + 1);
      offers.push({
        shop,
        marketplace,
        productName: name,
        priceYen,
        taxIncluded: c.taxIncluded,
        sourceUrl: c.sourceUrl,
        ...shopLink(c.shopId, c.sourceUrl),
        credit,
      });
    }
  }

  offers.sort((a, b) => comparablePrice(a) - comparablePrice(b));
  const perMarketplace = new Map<string, number>();
  for (const { credit, ...offer } of offers) {
    const n = perMarketplace.get(offer.marketplace) ?? 0;
    if (n >= MAX_OFFERS_PER_MARKETPLACE) continue;
    perMarketplace.set(offer.marketplace, n + 1);
    result.offers.push(offer);
    if (credit && !result.credits.includes(credit)) result.credits.push(credit);
    if (result.offers.length >= MAX_OFFERS) break;
  }
  if (result.offers.length === 0 && someFailed) result.status = 'unavailable';
  return result;
}

/** 「楽天市場の〇〇ストア」。店の名前がモールの名前と同じなら1回だけ */
function sellerLabel(offer: PriceOffer): string {
  return offer.shop === offer.marketplace ? offer.shop : `${offer.marketplace}の${offer.shop}`;
}

/** 価格の返答（定型文。Gemini は使わない） */
export function summarizePriceResult(result: PriceResult): string {
  const q = result.productQuery;
  const [cheapest] = result.offers;
  if (!cheapest && result.status === 'unavailable') {
    return `ただいま「${q}」の販売価格を確認できませんでした。時間をおいてもう一度お試しください。`;
  }
  if (!cheapest) {
    return `「${q}」の販売価格は、${PRICE_SHOPS.map((id) => SHOPS[id].label).join('・')}で確認できませんでした。Amazon の検索結果へのリンクを表示しています。`;
  }
  const time = new Date(result.checkedAt).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const tax = cheapest.taxIncluded === true ? '（税込）' : cheapest.taxIncluded === false ? '（税抜）' : '';
  return [
    `「${q}」の販売価格を${result.offers.length}件確認しました（${time}時点）。今回確認できた中では、${sellerLabel(cheapest)}の「${cheapest.productName}」が最も安く、${cheapest.priceYen.toLocaleString('ja-JP')}円${tax}です。`,
    '容量や送料はお店によって違います。価格や在庫は変わることがあるため、購入前に販売ページでご確認ください。',
  ].join('\n\n');
}
