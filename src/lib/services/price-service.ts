import 'server-only';
import { ListingVariant, PriceApiCredit, PriceOffer, PriceResult } from '../types';
import { buildAmazonAffiliateUrl } from './amazon-affiliate';
import { rakutenOffers, ShopOfferCandidate, yahooOffers } from './shop-apis';
import { ShopId, shopLink, shopOfUrl, SHOPS } from './shops';
import { toProductSearchQuery } from './page-search';
import { isPlainLabelText } from '../utils/safe-text';
import { listingVariant, notSingleItem, variantLabel } from '../search/listing-name';

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
/** 1つのお店の結果だけで埋まらないように（種類ごと） */
const MAX_OFFERS_PER_MARKETPLACE = 2;
/** 出す種類（本体の容量違い・詰替用）の数。多ければ、出品の多い種類 */
const MAX_VARIANTS = 3;
/** 同じ商品ページの結果はこの数まで */
const MAX_OFFERS_PER_PAGE = 3;
const MAX_SHOP_LENGTH = 60;
const MAX_PRODUCT_NAME_LENGTH = 150;

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

  const offers: Candidate[] = [];
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
      if (notSingleItem(name, false)) continue;
      if (!offerMatchesQuery(c.brand, name, productQuery)) continue;
      const variant = listingVariant(name);
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
        variant,
        credit,
      });
    }
  }

  offers.sort((a, b) => comparablePrice(a) - comparablePrice(b));
  for (const { credit, ...offer } of pickByVariant(offers)) {
    result.offers.push(offer);
    if (credit && !result.credits.includes(credit)) result.credits.push(credit);
  }
  if (result.offers.length === 0 && someFailed) result.status = 'unavailable';
  return result;
}

/** 確かめた出品（種類は必ずある） */
type Candidate = PriceOffer & { credit?: PriceApiCredit; variant: ListingVariant };

/**
 * 出す出品を選ぶ。本体・詰替用・容量の違いは同じ製品（成分が同じ）なので一緒に出すが、安い詰替用だけで埋まって本体の価格が
 * 出なくならないように、種類ごとに安い順で1件ずつ順番に取る（最大 MAX_OFFERS 件。1つのモールは種類ごとに
 * MAX_OFFERS_PER_MARKETPLACE 件まで）。並びは本体が先、種類ごとに安い順。offers は安い順であること
 */
function pickByVariant(offers: Candidate[]): (PriceOffer & { credit?: PriceApiCredit })[] {
  // 容量の書かれていない出品は、同じ本体・詰替用で容量が1つだけなら、その容量とみなす
  const sizes = (refill: boolean) => new Set(offers.flatMap((o) => (o.variant.refill === refill && o.variant.size ? [o.variant.size] : [])));
  const groups = new Map<string, Candidate[]>();
  for (const offer of offers) {
    const known = sizes(offer.variant.refill);
    const variant = offer.variant.size || known.size !== 1 ? offer.variant : { ...offer.variant, size: [...known][0] };
    const key = variantLabel(variant);
    groups.set(key, [...(groups.get(key) ?? []), { ...offer, variant }]);
  }
  // 出品の多い種類から MAX_VARIANTS まで。ただし本体と詰替用は、あれば1つずつ必ず残す（詰替用の容量違いだけで埋めない）
  const bySize = [...groups.values()].sort((a, b) => b.length - a.length);
  const keep = new Set<Candidate[]>();
  for (const refill of [false, true]) {
    const largest = bySize.find((g) => g[0].variant.refill === refill);
    if (largest) keep.add(largest);
  }
  for (const g of bySize) if (keep.size < MAX_VARIANTS) keep.add(g);
  const chosen = bySize
    .filter((g) => keep.has(g))
    .sort((a, b) => Number(a[0].variant.refill) - Number(b[0].variant.refill) || comparablePrice(a[0]) - comparablePrice(b[0]));

  const picked = chosen.map((): Candidate[] => []);
  const next = chosen.map(() => 0);
  let total = 0;
  for (let progress = true; progress && total < MAX_OFFERS; ) {
    progress = false;
    for (let g = 0; g < chosen.length && total < MAX_OFFERS; g++) {
      while (next[g] < chosen[g].length) {
        const offer = chosen[g][next[g]++];
        if (picked[g].filter((p) => p.marketplace === offer.marketplace).length >= MAX_OFFERS_PER_MARKETPLACE) continue;
        picked[g].push(offer);
        total++;
        progress = true;
        break;
      }
    }
  }
  // 本体だけで容量も1つなら、種類は書かない（「本体」とだけ出しても分からない）。詰替用だけなら書く
  const labelled = chosen.length > 1 || chosen.some((g) => g[0].variant.refill);
  return picked.flat().map((o) => (labelled ? o : { ...o, variant: undefined }));
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
  const found = `「${q}」の販売価格を${result.offers.length}件確認しました（${time}時点）。`;
  const note = '容量や送料はお店によって違います。価格や在庫は変わることがあるため、購入前に販売ページでご確認ください。';
  // 本体・詰替用などの種類ごとに、いちばん安い出品（offers は種類ごとに安い順）
  const cheapestPerVariant = new Map<string, PriceOffer>();
  for (const offer of result.offers) {
    const label = offer.variant ? variantLabel(offer.variant) : '';
    if (!cheapestPerVariant.has(label)) cheapestPerVariant.set(label, offer);
  }
  if (cheapestPerVariant.size > 1) {
    const each = [...cheapestPerVariant].map(([label, offer]) => `${label}は${sellerLabel(offer)}の${yenText(offer)}`);
    return [`${found}今回確認できた中で最も安いのは、${each.join('、')}です。`, note].join('\n\n');
  }
  const label = cheapest.variant ? variantLabel(cheapest.variant) : undefined;
  return [`${found}今回確認できた中では、${sellerLabel(cheapest)}の「${cheapest.productName}」が最も安く、${yenText(cheapest, label)}です。`, note].join('\n\n');
}

/** 「770円（税込）」「638円（税込・詰替用 150mL）」 */
function yenText(offer: PriceOffer, label?: string): string {
  const tax = offer.taxIncluded === true ? '税込' : offer.taxIncluded === false ? '税抜' : undefined;
  const notes = [tax, label].filter(Boolean);
  return `${offer.priceYen.toLocaleString('ja-JP')}円${notes.length ? `（${notes.join('・')}）` : ''}`;
}
