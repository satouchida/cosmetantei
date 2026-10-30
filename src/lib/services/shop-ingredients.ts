import 'server-only';
import { Product } from '../types';
import { COSMETICS_DATABASE, isVerifiedSource } from '../data/cosmetics-db';
import { LABEL_LIMITS, labelProductFields, parseIngredientLabel } from '../analyzer/label-parser';
import { findMatchingKnownIngredient } from '../analyzer/ingredient-analyzer';
import { CATEGORY_LABELS_JA, categoryFromText } from '../analyzer/product-category';
import { SHOP_TEXT_ID_PREFIX } from '../product-source';
import { searchKey } from '../search/product-match';
import { isPlainLabelText } from '../utils/safe-text';
import { buildBrandIndex, IndexedBrand, resolveBrand, textHasBrand } from './brand-suggest';
import { NOT_SINGLE_ITEM } from './price-service';
import { findSavedByBarcode, lookupByBarcode } from './search-barcode-service';
import { rakutenItemSearch, ShopItem, yahooItemSearch } from './shop-apis';
import { withoutListingNoise } from '../search/listing-name';
import { shopLink } from './shops';

/**
 * 製品の成分を、Web を調べる前に、お店の API から探す（docs/plans/shop-ingredients.md）
 * - お店に送る検索語は、一覧のブランド名（とアプリが決めた種類の語）だけ。利用者が入力した文は送らない。
 *   見つかった商品名と、入力の残り（ブランド名を除いた語）を、ここで照らし合わせる
 * - Yahoo!ショッピング: 商品の JAN コードで、保存済みの（確かめた成分の）製品を探す（費用なし）
 * - 楽天市場: 商品説明（itemCaption）の全成分の部分を読む（費用はほぼ無し）。楽天の規約（第10条 (9)）で保存できない
 *   ので、その返答にだけ使う（共有のキャッシュ・ブラウザの保存・書き出しに入れない。isShopListingProduct）。
 *   出品者が書いた文なので、2段で確かめる（読めないところがあれば一覧ごと使わない）：
 *   1. 切り出し（コード）：最後の「【変更後】」の後の、「全成分」「成分」の見出しから、次の見出し（使用方法・内容量・
 *      広告文責など）か終わりまで。全成分の見出しが2つ以上（セット商品・新旧の処方）なら使わない
 *   2. 読み取りと明らかな文の除去（コード）：parseIngredientLabel のあと、文・数字だけ・症状の語・宣伝の語を除く
 *   clef-flash で1つずつ確かめるのはやめた（2026-10-19 に楽天の実際の商品説明 20 件で試すと、一覧の中では
 *   トレオニン・TEA・PET・カンテンなど本物の成分を 9 件の一覧で除いた。含まれる成分を見落とすので使わない）
 *   成分が 8 個に満たない一覧は使わない（切り出しが早く終わると、含まれる成分を見落とすため）
 */

/** 商品説明を読む楽天の商品の数（1回の検索で） */
const MAX_RAKUTEN_ITEMS = 2;
/** 使う成分の一覧の最少の数 */
const MIN_SHOP_INGREDIENTS = 8;
/**
 * この長さ以上の商品説明で、次の見出しが無いまま終わりまで続く一覧は使わない（API の商品説明は長いと途中で
 * 切れていることがあり、終わりの成分（香料・防腐剤・エタノールが多い）を見落とすため）
 */
const CAPTION_MAY_BE_CUT_AT = 900;
/** お店の調べものにかける時間の上限。超えたら、お店では見つからなかったことにして Web を調べる */
const SHOP_LOOKUP_DEADLINE_MS = 10_000;

const STOP_WORDS =
  '(?:ご?使用方法|使い方|ご?使用上の(?:ご)?注意|お肌に異常|内容量|容量|商品区分|区分|広告文責|製造販売元|製造元|発売元|販売元|販売者|原産国|生産国|メーカー|JAN|注意事項|保管|お問い?合わせ|ブランド名?|商品説明|商品名|特徴|規格|配送|送料|サイズ|成分の特徴)';
/**
 * 成分の一覧の終わりの見出し：行頭・【】・■ などのあと、または改行なしで続く「 内容量：」のような見出し
 */
/** 成分名に出てこない語は、空白のあとなら（「…トコフェロール メーカー ファンケル」）見出しがなくても終わりとみなす */
const STRONG_STOP_AFTER_SPACE = '(?:メーカー|商品区分|区分|広告文責|製造販売元|製造元|発売元|販売元|原産国|生産国)';
/** 成分名に決して出てこない語は、どこにあっても終わり（「…その他の成分」注意事項肌に…」） */
const STRONG_STOP_ANYWHERE = '(?:注意事項|ご?使用上の(?:ご)?注意|広告文責|お問い?合わせ|〒)';
const STOP_HEADING = new RegExp(
  `(?:^|\\n|【|■|◆|●|◇|□|▼|≪|《|\\[)\\s*${STOP_WORDS}|\\s${STOP_WORDS}\\s*[:：】]|\\s${STRONG_STOP_AFTER_SPACE}|${STRONG_STOP_ANYWHERE}`
);
/**
 * 全成分の見出し。「全成分」、行頭・括弧のあとの「成分：」、または文の終わり・空白のすぐあとの「成分」に、
 * 区切り（、）の付いた名前が続くもの（「…ませます。成分アラントイン*、精製水、…」）
 */
const INGREDIENT_HEADING =
  /全成分|(?:^|\n|【|■|◆|●|◇|□|▼|≪|《|\[)\s*成分\s*(?:[:：】\]》≫]|\n)|(?<=[。\s])成分(?=[^\s、。:：(（「」]{1,30}[、,])/g;
/** 成分ではない語（症状・注意の文に出る） */
const SYMPTOM_WORD = /^(?:はれ|かゆみ|刺激|赤み|傷|湿しん|しっしん|かぶれ|ただれ|色素沈着|白斑)(?:等|など)?$/;
const SENTENCE = /[。！？!?]|ます|です|ください|ません|ること|場合/;
/** 説明・宣伝の語（成分名には出てこない） */
const MARKETING_WORD =
  /配合|フリー|済み|タイプ|成分$|^(?:無香料|無着色|無添加|無鉱物油|弱酸性|低刺激|(?:日本|国内|国|韓国|フランス|中国)製|国産)$|^\d+(?:\.\d+)?\s*(?:ml|g|kg|l|枚|個|本)$/i;

/** HTML の改行・タグ・文字参照を、文字にする */
function captionText(caption: string): string {
  return caption
    .replace(/<br\s*\/?>/gi, '\n')
    // タグの中に「<」は含めない（「<」が続き「>」が無い説明で、毎回最後まで読み直して時間がかからないように）
    .replace(/<\/?(?:p|div|li|tr|td|ul|ol|table|h\d)\b[^<>]*>/gi, '\n')
    // 文中のタグ（<b> など）は消すだけ（「ヒアルロン酸<b>Na</b>」を分けない）
    .replace(/<[^<>]*>/g, '')
    .replace(/&#(\d{1,6});/g, (_, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, n: string) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&quot;/g, '"')
    .replace(/&yen;/g, '¥')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // 長い空白・空行は1つにまとめる（見出しを探す正規表現が、長い空白で何度も読み直さないように）
    .replace(/\s{2,}/g, (w) => (w.includes('\n') ? '\n' : ' '))
    .normalize('NFKC');
}

/** 商品説明から、全成分の部分を切り出す。見つからない・2つ以上あるときは null */
export function cutIngredientBlock(caption: string): string | null {
  let text = captionText(caption);
  // 途中で切れているかもしれない長さは、説明の全体で見る（【変更後】で切った後ではなく）
  const fullLength = text.length;
  // 新旧の処方が並ぶ説明は、新しい方（最後の【変更後】の後）だけ。「変更前」だけなら、どれが今の処方か分からない
  const changed = text.lastIndexOf('変更後');
  if (changed >= 0) text = text.slice(changed + '変更後'.length);
  else if (text.includes('変更前')) return null;
  const headings = [...text.matchAll(INGREDIENT_HEADING)];
  if (headings.length !== 1) return null;
  const heading = headings[0];
  // 「全成分表示】」「全成分（2024年現在）：」のような見出しの続きも外す
  let block = text
    .slice(heading.index + heading[0].length)
    .replace(/^\s*(?:表示)?\s*(?:[（(][^）)]{0,20}[）)])?\s*[:：】\]》≫]?\s*/, '')
    // 「成分成分水、…」のように見出しが重なっていたら、もう1つも外す
    .replace(/^成分\s*[:：】]?\s*/, '');
  // 色・種類ごとの一覧（「【ホワイト】水、… 【ピンク】水、…」）は、どれがこの商品か分からない
  if (/^[\s/／]*【[^】]{1,15}】/.test(block)) return null;
  const stop = STOP_HEADING.exec(block);
  if (stop) block = block.slice(0, stop.index);
  // 次の見出しが無いまま、長い説明の終わりに着いた一覧は、途中で切れているかもしれない
  else if (fullLength >= CAPTION_MAY_BE_CUT_AT) return null;
  return block.trim() || null;
}

/** 読み取った項目から、明らかに成分ではないもの（文・数字だけ・症状の語）を除く */
export function dropObviousNonIngredients(items: string[]): string[] {
  return items
    .map((i) => i.trim())
    .filter(
      (i) =>
        i.length > 0 &&
        i.length <= 60 &&
        !/^[\d.,%\s]+$/.test(i) &&
        !SYMPTOM_WORD.test(i) &&
        !SENTENCE.test(i) &&
        !/変更前|変更後/.test(i) &&
        // 「*は「有効成分」」「無表示は「その他の成分」」のような注の説明
        !/[「」]|無表示/.test(i) &&
        // 宣伝・説明の語（「ヒアルロン酸配合」「無香料」「150ml」「日本製」「保湿成分」）。成分名にはならない
        !MARKETING_WORD.test(i) &&
        isPlainLabelText(i)
    );
}

/**
 * 配合量つきの書き方の分類の名前（「保湿成分:」「防腐剤:」「製品の酸化防止剤:」「基剤:」）。決まった機能の語のものだけ外す
 * （「グリセリン防腐剤:」のように成分名がくっついた形を、名前ごと消さない）
 */
const GROUP_LABEL_FUNCTION =
  '(?:油性エモリエント|エモリエント|保湿|油性|水性|増粘|防腐|殺菌|抗菌|酸化防止|キレート|界面活性|乳化|中和|pH調整|粘度調整|可溶化|安定化?|清涼|紫外線吸収|紫外線散乱|収れん|着色|被膜形成|皮膜形成|分散|整肌|美容|洗浄|起泡|基)';
const GROUP_LABEL = new RegExp(
  `(?:^|(?<=[、」:：]))\\s*(?:製品の|成分の)?${GROUP_LABEL_FUNCTION}(?:剤|成分)\\s*[:：]`,
  'g'
);

/**
 * お店の説明の書き方を、全成分表示の書き方にそろえる
 * - 「1、2-ヘキサンジオール」の読点は、名前の一部（「1,2-」）
 * - 配合量つきの書き方（「保湿成分:BG 4.48%、…」「基剤:水 全量を100%とする」）は、量と分類の名前を外す
 * - 「有効成分」「その他の成分」をかぎかっこで書いた医薬部外品は、「有効成分:」「その他の成分:」にする
 */
export function normalizeShopLabel(block: string): string {
  let b = block
    // 空白の連続は1つに（下の \s* が、長い空白の列を始める位置ごとに読み直さないように。読み取りの結果は変わらない）
    .replace(/\s{2,}/g, (w) => (/[\n\r]/.test(w) ? '\n' : ' '))
    .replace(/(\d)\s*、\s*(\d)\s*-/g, '$1,$2-')
    // 「有効成分」…「その他の成分」… の書き方は、読み取りが分かる「有効成分:」「その他の成分:」にする
    // グループの頭（行頭・区切り・量のあと）にあるときだけ。「*は「有効成分」」「*=「有効成分」」のような注の説明は、そのまま
    .replace(/(?<=^|[、\s%】:：])「(有効成分|その他の成分)」\s*/g, '$1:');
  // 数字の途中からは照合しない（長い数字の列で、始める位置ごとに読み直して遅くならないように）
  if (/(?<![\d.])\d+(?:\.\d+)?\s*%|適量/.test(b)) {
    b = b
      .replace(/全量を\s*100\s*%\s*とする/g, '')
      // 名前の数字（「ポリソルベート80」「ナイロン-12」）は量ではない：数字・ハイフンのすぐ後の数字は外さない
      .replace(/\s*(?<![\d.-])\d+(?:\.\d+)?\s*%/g, '、')
      .replace(/\s*適量\s*/g, '、')
      // 有効成分・その他の成分の見出しは残す（医薬部外品の2つのグループ）
      .replace(GROUP_LABEL, '、')
      .replace(/、(?:\s*、)+/g, '、')
      .replace(/^\s*、|、\s*$/g, '');
  }
  return b;
}

/** 注の続きの頭の語が成分名なら、成分に別の成分がくっついている（「BG*メチルパラベン」。外すと見落とす） */
function footnoteHidesName(name: string): boolean {
  // [^]* は行区切り（U+2028）も含む（.* だと行区切りの手前で止まり、「*」ごとに読み直して遅くなる）
  const tail = /[*＊](?![(（])([^]*)$/.exec(name)?.[1].trim();
  if (!tail) return false;
  const lead = tail.split(/[\s※＊*:：、]/)[0];
  return lead.length > 0 && !!findMatchingKnownIngredient(lead);
}

/** 除いた項目に、成分名らしい語で始まるものがあるか（成分に説明・住所がくっついている。除くと、その成分を見落とす） */
function hasGluedDrop(items: string[]): boolean {
  const kept = new Set(dropObviousNonIngredients(items));
  return items.some((raw) => {
    const item = raw.trim();
    if (!item || kept.has(item)) return false;
    // 宣伝の語だけの項目（「ヒアルロン酸配合」）は、成分の名前ではない。くっつきとは見ない
    if (!/\s/.test(item) && MARKETING_WORD.test(item)) return false;
    const lead = item.split(/[\s※＊*:：]/)[0];
    if (lead.length === 0) return false;
    // 頭の語が成分DBにある（「香料 本品は…」）か、空白で区切られて単独なら残る語（「水 メーカー…」。DB に無い成分もある）
    return !!findMatchingKnownIngredient(lead) || (lead !== item && /\s/.test(item) && dropObviousNonIngredients([lead]).length === 1);
  });
}

/** 名前の後ろに付いた「*」の注（「フェノキシエタノール*2種のヒアルロン酸」）を外す。「*(説明)」は「*」だけ外す */
function withoutFootnote(name: string): string {
  return name.replace(/[*＊](?![(（])[^]*$/, '').replace(/[*＊]/g, '').trim();
}

/** 商品説明から成分の一覧を読む。使えなければ null */
export async function ingredientsFromCaption(caption: string): Promise<ReturnType<typeof parseIngredientLabel> | null> {
  const block = cutIngredientBlock(caption);
  if (!block) return null;
  const normalized = normalizeShopLabel(block);
  // 量の書き方を読み切れなかった（% が残った）一覧は使わない
  if (/%/.test(normalized)) return null;
  const parsed = parseIngredientLabel(normalized);
  // 「*」の注の続きに成分名があれば、外すと見落とすので使わない
  if (parsed.ingredients.some(footnoteHidesName) || parsed.activeIngredients.some(footnoteHidesName)) return null;
  const label = { ...parsed, ingredients: parsed.ingredients.map(withoutFootnote), activeIngredients: parsed.activeIngredients.map(withoutFootnote) };
  const cleaned = dropObviousNonIngredients(label.ingredients);
  // 除く項目に成分名がくっついていたら使わない（有効成分も同じ）。多すぎる一覧も使わない（labelProductFields が空にするので、
  // ここで外さないと成分の無い「お店の成分表示」の製品ができる）
  if (
    hasGluedDrop(label.ingredients) ||
    hasGluedDrop(label.activeIngredients) ||
    cleaned.length < MIN_SHOP_INGREDIENTS ||
    cleaned.length > LABEL_LIMITS.ingredients
  ) {
    return null;
  }
  return { ...label, ingredients: cleaned, activeIngredients: dropObviousNonIngredients(label.activeIngredients) };
}

/** お店の商品名が、探している製品か（ブランドが合い、入力の残りの語がすべて名前にある。セット・詰め替えは除く） */
function itemMatches(item: ShopItem, brand: IndexedBrand, words: string[]): boolean {
  const name = withoutListingNoise(item.name);
  if (NOT_SINGLE_ITEM.test(name)) return false;
  if (!item.brands.some((b) => textHasBrand(b, brand)) && !textHasBrand(item.name, brand)) return false;
  const key = searchKey(name);
  return words.every((w) => hasWord(key, w));
}

/** 英数字だけの語（II・III・50 など）は、前後が英数字でない位置で合うときだけ（「II」で「III」に合わせない） */
function hasWord(key: string, word: string): boolean {
  if (!/^[a-z0-9]+$/.test(word)) return key.includes(word);
  return new RegExp(`(?<![a-z0-9])${word}(?![a-z0-9])`).test(key);
}

/** 楽天の商品説明から成分を読んだ製品（その返答にだけ使う。代わりの商品探しでも使う） */
export function shopListingProduct(item: ShopItem, brandName: string, label: NonNullable<Awaited<ReturnType<typeof ingredientsFromCaption>>>): Product {
  const link = shopLink('rakuten', item.url);
  return {
    id: `${SHOP_TEXT_ID_PREFIX}rakuten_${item.code}`.slice(0, 120),
    // 商品名は API が返したまま（楽天の規約 第10条 (7)）
    name: item.name,
    brand: brandName,
    country: 'JP',
    category: categoryFromText(withoutListingNoise(item.name)) ?? 'other',
    ...labelProductFields(label),
    ...(item.imageUrl && { imageUrl: item.imageUrl }),
    // 楽天の商品ページへのリンクは、楽天アフィリエイトのリンクのときだけ（第3条・第10条 (4)(5)）
    ...(link.sponsored && { shopLink: link }),
    ingredientSource: 'shop_listing',
    isEstimatedFromMarketplaces: false,
    sharedSource: false,
  };
}

/**
 * お店の API で、製品の成分を探す。productQuery は toProductSearchQuery() を通した商品名。
 * 見つからない・ブランドが分からない・キーが無ければ []
 */
export async function shopIngredientProducts(productQuery: string): Promise<Product[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Product[]>((resolve) => {
    timer = setTimeout(() => resolve([]), SHOP_LOOKUP_DEADLINE_MS);
  });
  try {
    return await Promise.race([lookupInShops(productQuery), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * お店の商品検索（送るのはブランド名と、アプリが決めた種類の語だけ）。どの製品か分からない入力（ブランド名だけ・
 * 種類の語だけ・一覧に無いブランド）なら null。caption: 楽天の商品説明も取る
 */
async function searchShops(productQuery: string, { caption, yahooCaption = false }: { caption: boolean; yahooCaption?: boolean }) {
  const resolved = resolveBrand(productQuery, buildBrandIndex(COSMETICS_DATABASE));
  if (!resolved) return null;
  const words = resolved.rest.split(' ').map(searchKey).filter((w) => w.length > 0);
  // ブランド名だけの入力は、どの製品か分からない
  if (words.length === 0) return null;
  const category = categoryFromText(productQuery);
  // 種類の語だけの入力（「キュレル 化粧水」）は、どの製品か分からない
  const categoryKey = category ? searchKey(CATEGORY_LABELS_JA[category]) : '';
  if (words.every((w) => w === categoryKey)) return null;
  // お店に送るのはブランド名と、アプリが決めた種類の語だけ
  const keyword = [resolved.brand.entry.name, category && CATEGORY_LABELS_JA[category]].filter(Boolean).join(' ');
  const [rakuten, yahoo] = await Promise.all([
    rakutenItemSearch(keyword, { caption }),
    yahooItemSearch(keyword, { caption: yahooCaption }),
  ]);
  return { brand: resolved.brand, words, rakuten: rakuten ?? [], yahoo: yahoo ?? [] };
}

async function lookupInShops(productQuery: string): Promise<Product[]> {
  const shops = await searchShops(productQuery, { caption: true });
  if (!shops) return [];
  const { brand, words, rakuten, yahoo } = shops;
  const found: Product[] = [];

  // Yahoo!: JAN コードで、保存済みの確かめた製品（費用なし。同じ JAN は1回だけ）
  const jans = [...new Set(yahoo.filter((i) => i.janCode && itemMatches(i, brand, words)).map((i) => i.janCode!))];
  for (const saved of await Promise.all(jans.map(findSavedByBarcode))) {
    if (!saved || !isVerifiedSource(saved) || saved.ingredients.length === 0 || found.some((p) => p.id === saved.id)) continue;
    // 出品者が書いた JAN コードは信頼しない。保存済みの製品の名前でも、入力の語がすべて合うものだけ
    const savedKey = searchKey(`${saved.brand}${saved.name}`);
    if (words.every((w) => hasWord(savedKey, w))) found.push(saved);
  }

  // 楽天：商品説明の全成分
  const items = rakuten.filter((i) => i.caption && itemMatches(i, brand, words)).slice(0, MAX_RAKUTEN_ITEMS);
  const labels = await Promise.all(items.map((item) => ingredientsFromCaption(item.caption!)));
  items.forEach((item, i) => {
    const label = labels[i];
    // 同じ成分の一覧（同じ商品の別のお店）は1つだけ
    if (!label || found.some((p) => p.ingredients.join('|') === label.ingredients.join('|'))) return;
    found.push(shopListingProduct(item, brand.entry.name, label));
  });
  return found;
}

/** JAN コードから製品を探す数の上限（1つの製品の自動の保存で。Open Beauty Facts への問い合わせを増やしすぎない） */
const MAX_SEED_BARCODES = 4;
/** 保存した製品に結び付ける Yahoo! の JAN コードの上限（同じ製品の容量違い） */
const MAX_LINKED_JANS = 3;

/** 楽天の商品説明に出品者が書いた JAN コード（その場の照合にだけ使い、保存しない） */
export function janFromCaption(caption: string): string | null {
  // 「JAN：」「【JANコード】」「JAN 」のあとの 13 桁か 8 桁
  const m = captionText(caption).match(/JAN(?:\s*コード)?[\s:：】\])）]*([0-9]{13}|[0-9]{8})(?![0-9])/i);
  return m ? m[1] : null;
}

/** 自動の保存で使う、お店の商品検索の結果のうち、探している製品に合う商品（セット・詰め替え・別の製品を除く） */
export interface ShopMatches {
  brandName: string;
  /** 入力からブランド名を除いた語（searchKey） */
  words: string[];
  /** 楽天：商品説明つき。説明は JAN コードを読むだけで、保存しない（第10条 (9)） */
  rakuten: ShopItem[];
  /** Yahoo!：商品説明（description）つき */
  yahoo: ShopItem[];
}

/**
 * お店の商品検索（楽天・Yahoo!、無料）で、探している製品に合う商品を集める（自動の保存：src/lib/services/seeding.ts）。
 * 送るのはブランド名と種類の語だけ。どの製品か分からない入力・キー未設定なら null
 */
export async function matchingShopItems(productQuery: string): Promise<ShopMatches | null> {
  const shops = await searchShops(productQuery, { caption: true, yahooCaption: true });
  if (!shops) return null;
  const { brand, words, rakuten, yahoo } = shops;
  return {
    brandName: brand.entry.name,
    words,
    rakuten: rakuten.filter((i) => itemMatches(i, brand, words)),
    yahoo: yahoo.filter((i) => itemMatches(i, brand, words)),
  };
}

/** 製品の名前（ブランド名つき）に、入力の語がすべてあるか（出品者が書いた JAN コードで、別の製品を拾わない） */
function namesAllWords(product: Product, words: string[]): boolean {
  const key = searchKey(`${product.brand}${product.name}`);
  return words.every((w) => hasWord(key, w));
}

/**
 * お店の商品の JAN コードから、Open Beauty Facts の製品を探す（費用なし）。
 * - JAN コードは、Yahoo! の項目と、楽天の商品説明に書かれたもの。保存されるのは Open Beauty Facts の製品
 *   （lookupByBarcode が保存する）。楽天の商品説明は保存しない
 * - どちらも出品者が書いた値なので、見つかった製品の名前でも、入力の語がすべて合うものだけを使う
 * - 有料の Web リサーチはしない（lookupByBarcode の webResearch: false）
 */
export async function productFromShopBarcodes(matches: ShopMatches): Promise<Product | null> {
  const jans = new Set<string>();
  for (const item of matches.yahoo) if (item.janCode) jans.add(item.janCode);
  for (const item of matches.rakuten) {
    const jan = item.caption ? janFromCaption(item.caption) : null;
    if (jan) jans.add(jan);
  }
  for (const jan of [...jans].slice(0, MAX_SEED_BARCODES)) {
    const product = (await findSavedByBarcode(jan)) ?? (await lookupByBarcode(jan, { webResearch: false }));
    if (!product || !isVerifiedSource(product) || product.ingredients.length === 0) continue;
    if (namesAllWords(product, matches.words)) return product;
  }
  return null;
}

/**
 * Yahoo! の商品説明（description）の全成分から、保存する製品を作る（費用なし。説明に全成分があるのは 3% ほど）。
 * 楽天の商品説明と同じ2段の確認（ingredientsFromCaption）を通った一覧だけ。出品者の文なので、出典の表示で
 * 「販売ページの成分表示」と伝え、ほかの人へのおすすめ（代わりの商品）には、お店の候補として扱うときだけ使う
 */
export async function productFromYahooDescription(matches: ShopMatches): Promise<Product | null> {
  for (const item of matches.yahoo) {
    if (!item.caption) continue;
    const label = await ingredientsFromCaption(item.caption);
    if (!label) continue;
    const name = withoutListingNoise(item.name);
    return {
      // 同じ製品はいつも同じ id（JAN コード。無ければ Yahoo! の商品コード）
      id: `yahoo_${item.janCode ?? item.code}`.slice(0, 120),
      name,
      brand: matches.brandName,
      country: 'JP',
      category: categoryFromText(name) ?? 'other',
      ...(item.janCode && { barcode: item.janCode }),
      ...labelProductFields(label),
      ...(item.imageUrl && { imageUrl: item.imageUrl }),
      // 出典は素の商品ページ。アフィリエイトのリンクは保存しない（保存した後に設定が変わっても、古いリンク・PR を出さない）
      sourceUrl: item.url,
      ingredientSource: 'shop_yahoo',
      isEstimatedFromMarketplaces: false,
    };
  }
  return null;
}

/** 名前の照合のキー：お店の飾り・ブランド名・容量（40g・150ml 等）を除く（同じ製品の容量違いを同じにする） */
function sameProductKey(name: string, brandName: string): string {
  const brandKey = searchKey(brandName);
  return searchKey(withoutListingNoise(name))
    .split(brandKey)
    .join('')
    .replace(/[0-9]+(?:\.[0-9]+)?(?:ml|g|mg|l|枚|個|本|包)/g, '');
}

/** Yahoo! のストア（store.shopping.yahoo.co.jp/<ストア>/…）。分からなければ null */
function yahooStore(url: string): string | null {
  try {
    const u = new URL(url);
    // ストアのページだけ（検索・製品ページなどの URL を、ストアとして数えない）
    if (u.hostname !== 'store.shopping.yahoo.co.jp') return null;
    return u.pathname.split('/')[1]?.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * 保存した製品に結び付ける JAN コード（Yahoo! の項目の JAN コードだけ。出品者が説明に書いた値は使わない）。
 * 名前から容量を除くと、保存した製品の名前と同じ商品だけ（同じシリーズの別の製品（I・II・III）は結び付けない）。
 * JAN コードも名前も出品者が書いた値なので、2つ以上のストアが同じ名前・同じ JAN コードで出しているものだけ
 * （1つのストアの間違い・わざと別の製品の JAN コードを書いたものを、30日のあいだ全員に出さない）。
 * 最大 MAX_LINKED_JANS 件。バーコードの読み取りで、費用なしに見つかるように
 */
export function yahooJanCodes(matches: ShopMatches, product: Product): string[] {
  const target = sameProductKey(product.name, product.brand);
  if (!target) return [];
  const stores = new Map<string, Set<string>>();
  for (const item of matches.yahoo) {
    const store = yahooStore(item.url);
    if (!item.janCode || !store || sameProductKey(item.name, matches.brandName) !== target) continue;
    stores.set(item.janCode, (stores.get(item.janCode) ?? new Set()).add(store));
  }
  return [...stores]
    .filter(([, s]) => s.size >= 2)
    .map(([jan]) => jan)
    .slice(0, MAX_LINKED_JANS);
}
