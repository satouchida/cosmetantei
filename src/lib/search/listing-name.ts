import type { ListingVariant } from '../types';
import { categoryFromText } from '../analyzer/product-category';
import { formFromText } from '../analyzer/product-form';

/**
 * 「」『』で囲んだ売り文句（「「ポイント10倍 11月20〜21日」」「『クーポンで10%OFF』」）。「」には商品の名前が入ることもあるので、
 * 売り方の言い方か日付があるときだけ。ポイント・% は売り方の形のときだけ（「ポイントメイクリムーバー」「10%配合」は名前）。
 * NFKC の後に使う（％ → %）
 */
const SALE_QUOTE =
  /[「『][^「『」』]*?(?:ポイント\s*(?:\d|up|アップ|還元)|\d\s*倍|クーポン|セール|(?<![a-z])sale(?![a-z])|\d\s*%\s*(?:off|オフ|還元|引)|割引|送料|期間限定|エントリー|\d{1,2}\s*月\s*\d{1,2}|\d{1,2}\/\d{1,2})[^「『」』]*[」』]/;

/** 売り文句の「」と、ほかの飾りをまとめた正規表現 */
const withSaleQuote = (noise: RegExp) => new RegExp(`${SALE_QUOTE.source}|${noise.source}`, 'gi');

/**
 * お店の商品名に付く、商品の名前ではない語（検索語を作るときだけ外す。表示する名前は変えない）。
 * ＼／で囲んだ売り文句（「＼P10倍／」「＼最大20%OFF／」）と「P10倍」、売り文句の「」（SALE_QUOTE）も
 */
const LISTING_NOISE = withSaleQuote(
  /【[^】]*】|［[^］]*］|\[[^\]]*\]|＜[^＞]*＞|<[^>]*>|[\\＼][^\\＼/／]{1,20}[/／]|★|☆|送料無料|公式(?:ショップ|ストア)?|正規品|あす楽|期間限定|(?:ポイント|(?<![a-z])P)\s*\d+\s*倍|\d+\s*%\s*OFF/
);

/** 商品名から飾りを外す（検索語と、コスメかどうかの確認にだけ使う。表示する名前は変えない） */
export function withoutListingNoise(name: string): string {
  return name.normalize('NFKC').replace(LISTING_NOISE, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * お店の商品名で、商品の名前の後に並べた検索用の語（「崩れにくい 30代 40代 ギフト」）。1語まるごとのときだけ。
 * 名前の語のこともある語は入れない：肌の種類（「化粧水 敏感肌用 高保湿タイプ」）・「メンズ」「女性用」（「ビオレ メンズ 洗顔」）・
 * 「国産」「日本製」（「国産 馬油 クリーム」）・「人気」「時短」「長持ち」・「毛穴対策」「乾燥対策」（「毛穴対策 洗顔料」
 * 「メラノCC 薬用しみ集中対策 美容液」）。「〇〇対策」は紫外線・UV・日焼け・花粉だけ
 */
// 「アットコスメ」「@cosme」はクチコミサイトの名前（「… リップクリーム アットコスメ」。docs/plans/shop-names-and-cleansing-genre.md「Step 3」）
const SEARCH_TAG =
  /^(?:\d0代\S*|年代|\S+にくい|\S+しない|(?:紫外線|uv|日焼け|花粉)対策|ギフト\S*|プレゼント\S*|(?:母|父|敬老)の日\S*|クリスマス\S*|ホワイトデー\S*|バレンタイン\S*|ランキング\S*|(?:楽天)?第?\d+位\S*|受賞\S*|アットコスメ\S*|@cosme\S*|おすすめ|オススメ|メール便\S*|ネコポス\S*|ゆうパケット\S*|即納|送料込み?)$/i;

/**
 * 名前の前に付く売り文句の語（docs/plans/shop-names-and-cleansing-genre.md「Step 2」）。
 * 「BLACK FRIDAYはP2倍+2品同時購入で50円OFFクーポン POHO+ …」の「POHO+」より前
 */
const SALE_MARK =
  'black\\s*friday|ブラックフライデー|クーポン|\\d+\\s*円\\s*off|\\d+\\s*%\\s*off|同時購入|お買い?物マラソン|スーパー\\s*sale|ポイント\\s*\\d+\\s*倍|(?<![a-z])p\\s*\\d+\\s*倍';
/** 先頭から続く、売り文句の語を含む語と、その後の記号だけの語（「ポイント2倍!」の倍を外した後の「!」） */
const LEADING_SALE = new RegExp(`^(?:\\S*?(?:${SALE_MARK})\\S*\\s*)+(?:[!！?？・/|]+(?:\\s+|$))*`, 'i');

/** 種類・形の語（「ボディローション」「化粧水」「ジェル」「ミルク」） */
const isKindWord = (word: string) => !!categoryFromText(word) || !!formFromText(word);
/** 効能を並べた語とみなす、続いた種類の語の数 */
const MIN_KIND_RUN = 3;
/**
 * 種類の名前だけの語（docs/plans/shop-paid-lookups-and-keyword-names.md「Step 2」）。前に容量が付いていてもよい
 * （楽天の「… PA++++ 50g日焼け止め 紫外線吸収剤不使用 …」。容量は価格の横に出す）
 */
const PLAIN_KIND_NAME = /^(?:\d+(?:\.\d+)?\s*(?:ml|g|kg|l))?(?:日焼け止め|サンスクリーン|化粧水|美容液|乳液|クリーム|洗顔料?|クレンジング|リップクリーム|パック)$/i;
/** 種類の名前だけの語の後に、検索用の語の並びとみなす語の数 */
const MIN_KEYWORD_TAIL = 3;
/** 検索用の語として数えない語：かっこの付いた語（「(顔・からだ用)」「(SPF50+」）、容量（「14g」）、SPF・PA の値（「SPF50+」「PA++++」） */
const NOT_KEYWORD = /[()（）[\]［］【】]|^\d+(?:\.\d+)?\s*(?:ml|g|kg|l|枚|個|本)$|^(?:spf\s*\d+\+*|pa\+*)$/i;
/** 名前の続きの印（「ローション II」の番号） */
const VARIANT_NUMERAL = /^(?:i{1,3}|iv|v|vi)$/i;
/** 種類の言い直し（「洗顔料 泡洗顔」）で切るのは、前にこの数以上の語（ブランドと名前）があるときだけ（「ミノン 洗顔料 泡洗顔 …」は名前） */
const MIN_WORDS_BEFORE_REPEAT = 2;
/** 「UV」で始まる語（「UVジェル」「UVミルク」）。日焼け止めの形の名前なので、種類の言い直しとみなさない */
const UV_WORD = /^uv/i;
/** 最初の語をもう一度書いたところで切るのは、間にこの数以上の語があるときだけ */
const MIN_WORDS_BETWEEN = 2;

/**
 * 商品の名前の後に付く、お店の分類・管理の語を外す（docs/plans/shop-search-reach.md「Step 3」）。
 * - 最初の語（ブランド）をもう一度書いたところから後ろ（「ヴァセリン … 無香料 400ml ヴァセリン ヴアセリンアドバンスムコウ400」の
 *   商品コード）。最初の語が2文字以上で種類の語でなく、間に2語以上あるときだけ
 * - 種類・形の語を「・」でつないだ最後の語（楽天のジャンル名「ボディローション・ジェル」「ボディーローション・ミルク・トナー」）。
 *   前の語に種類・形の語があるときだけ
 * - 前の語をくり返した最後の語（「… ボディローション 大容量 400ml 無香料 ボディローション」）。数字だけの語は外さない
 * - 種類の語が3つ以上続くところから後ろ（「… オールインワンジェル 化粧水 美容液 乳液 クリーム …」）。前の語に種類の語があるときだけ
 * - 種類の名前だけの語（「日焼け止め」）から後ろ。前の語が同じ種類を名乗り（または次の語が同じ種類の言い直しで）、後ろに3語以上続くときだけ
 */
function withoutNameTail(words: string[]): string[] {
  let kept = words;
  const first = kept[0]?.toLowerCase() ?? '';
  if (first.length >= 2 && !isKindWord(first)) {
    const again = kept.findIndex((w, i) => i - 1 >= MIN_WORDS_BETWEEN && w.toLowerCase() === first);
    if (again > 0) kept = kept.slice(0, again);
  }
  // 種類の語が3つ以上続くところから後ろは、効能を並べた語（「オールインワンジェル 化粧水 美容液 乳液 クリーム …」）
  const run = kept.findIndex(
    (_, i) => i > 0 && kept.slice(0, i).some(isKindWord) && kept.slice(i, i + MIN_KIND_RUN).length === MIN_KIND_RUN && kept.slice(i, i + MIN_KIND_RUN).every(isKindWord)
  );
  if (run > 0) kept = kept.slice(0, run);
  // 種類の名前だけの語から後ろは、検索用の語の並び（「シルキーUVミルク spf50+ PA++++ 日焼け止め 紫外線吸収剤不使用 …」）。
  // 前の語が同じ種類を名乗り、後ろにかっこ・容量でない語が3語以上続くときだけ（「ノンケミカル UVカット 日焼け止め ミルク」は名前。
  // 「日焼け止め 14g (顔・からだ用) (SPF50+ PA++++)」の容量・注記は検索用の語ではない）
  const plain = kept.findIndex((w, i) => {
    const kind = PLAIN_KIND_NAME.test(w) ? categoryFromText(w) : undefined;
    if (!kind) return false;
    const sameKind = (t: string) => categoryFromText(t) === kind;
    const tail = kept.slice(i + 1);
    const next = tail[0];
    // 次の語が同じ種類の言い直し（「洗顔料 泡洗顔」「洗顔料 クレンジングフォーム」）なら、検索用の語の並び
    // （docs/plans/kind-repeat-keyword-names-and-platinum-label.md「Step 1」）
    // 「UVジェル」「UVミルク」は日焼け止めの言い直しではなく、名前の形（「スキンアクア 日焼け止め UVジェル …」）
    const repeated = !!next && sameKind(next) && !UV_WORD.test(next);
    // 次の語が形・別の種類・番号なら、まだ名前（「アネッサ UV 日焼け止め ジェル SPF50+ PA++++ 無香料」）
    if (next && !repeated && (isKindWord(next) || VARIANT_NUMERAL.test(next))) return false;
    // 言い直しの語そのものは、検索用の語の数に入れない
    const keywords = (repeated ? tail.slice(1) : tail).filter((t) => !NOT_KEYWORD.test(t));
    if (keywords.length < MIN_KEYWORD_TAIL) return false;
    // 名前は前の語で済んでいる：同じ種類を名乗る語があるか、言い直しの前にブランドと名前の語がある
    return kept.slice(0, i).some(sameKind) || (repeated && i >= MIN_WORDS_BEFORE_REPEAT);
  });
  if (plain > 0) kept = kept.slice(0, plain);
  while (kept.length > 1) {
    const last = kept[kept.length - 1];
    const before = kept.slice(0, -1);
    const genre = last.includes('・') && last.split('・').every((part) => part && isKindWord(part)) && before.some(isKindWord);
    // 数字だけの語（色番号の「0」「01」）は、くり返しても名前の一部のことがある
    const repeat = /\D/.test(last) && before.some((w) => w.toLowerCase() === last.toLowerCase());
    if (!genre && !repeat) break;
    kept = before;
  }
  return kept;
}

/**
 * お店の商品名から、検索用の語より後ろを外す（「美容液ファンデ 崩れにくい 30代 40代 …」→「美容液ファンデ」）。先頭の検索用の語
 * （「ギフト キュレル …」）と先頭の売り文句（LEADING_SALE）も外す。すべての語が検索用の語なら、そのまま。お店の分類・管理の語
 * （withoutNameTail）も外す。
 * Amazon・Qoo10 の検索はすべての語を含む商品を探すので、名前ではない語が1つでもあると見つからない
 */
export function withoutSearchTags(name: string): string {
  const n = name.normalize('NFKC').trim();
  // 先頭の売り文句（何も残らなければ外さない）
  const words = (n.replace(LEADING_SALE, '') || n).split(/\s+/).filter(Boolean);
  const start = words.findIndex((w) => !SEARCH_TAG.test(w));
  if (start < 0) return words.join(' ');
  const end = words.findIndex((w, i) => i > start && SEARCH_TAG.test(w));
  return withoutNameTail(words.slice(start, end < 0 ? undefined : end)).join(' ');
}

/**
 * withoutListingNoise が外さない括弧（(…)・≪…≫・《…》・〈…〉・◆…◆ など。宣伝の語が多い）。
 * お店の商品の照合（shop-alternatives.ts）と、Amazon・Qoo10 の検索語で外す
 */
export const LOOSE_NOISE = /\([^)]*\)|≪[^≫]*≫|《[^》]*》|〈[^〉]*〉|([◆■●▼▲◇□])[^◆■●▼▲◇□]*\1/g;
/** 容量・入数（「170ml」「6個セット」「×3本」「7枚入り」）。検索では容量違いも同じ製品なので外す。色番号などの数字だけの語は残す */
const SEARCH_SIZE = /(?<![a-z])(?:[x×]\s*)?\d+(?:\.\d+)?\s*(?:ml|g|kg|l|枚|個|本|点|箱|袋|パック)(?![a-z])(?:\s*入り?)?(?:\s*セット)?|\d+\s*セット/gi;
/** 1語の区切り記号（「肌ラボ / 極潤ヒアルロン液」「200ml/500ml」の容量を外した後の「/」） */
const LONE_SEPARATOR = /(?<=^|\s)[/／|｜]+(?=\s|$)/g;

/**
 * Amazon・Qoo10 で探す名前：飾り（withoutListingNoise）、宣伝の語が多い括弧、容量・入数、1語の「本体」、検索用の語を外す。
 * 何も残らなければ ''
 */
export function listingSearchName(name: string): string {
  const clean = withoutListingNoise(name);
  const trimmed = clean
    .replace(LOOSE_NOISE, ' ')
    .replace(SEARCH_SIZE, ' ')
    .replace(/\s+/g, ' ')
    .replace(DISPLAY_BODY_WORD, ' ')
    .replace(SEPARATOR_RUN, (run) => run[0])
    .replace(SEPARATOR_AT_WORD_EDGE, '$1')
    .replace(LONE_SEPARATOR, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return withoutSearchTags(trimmed || clean);
}

/** 「〇〇化粧品」の会社名（かな・英数字3文字以上 + 化粧品）。「ゲル化粧品」は2文字なので当たらない */
const MAKER_NAME = /^([ぁ-ゖァ-ヺーa-z0-9]{3,})化粧品$/i;
/** 「〇〇化粧品」でも会社名ではない、種類の言い方 */
const GENERIC_MAKER_WORD =
  /^(?:オーガニック|ナチュラル|ボタニカル|メンズ|ベビー|キッズ|プチプラ|ハーブ|アロマ|コスメ|スキンケア|ミネラル|ケミカルフリー|オールインワン|ビーガン|シンプル|ドクターズ|サロン|ノン[ァ-ヺー]*)$/i;

/**
 * 商品名の最初の語が「ベルマン化粧品」のような会社名ならそれ（一覧に無いブランドのとき、お店の商品のブランド名に使う）。無ければ ''
 */
export function makerInListingName(name: string): string {
  const first = withoutListingNoise(name).split(' ')[0] ?? '';
  const m = MAKER_NAME.exec(first);
  return m && !GENERIC_MAKER_WORD.test(m[1]) ? first : '';
}

/** 【】の中の語。かっこの後ろは別の書き方（「【アベンヌ(Avene)】」→「アベンヌ」） */
const NAME_TAG = /【([^】]*)】/g;
/** 【】に書かれてもブランドではない語（品質・売り方・容量） */
const NOT_A_BRAND_WORD =
  /^(?:医薬部外品|薬用|国内正規品|正規品|無添加|新商品|新発売|限定|大容量|詰め?替え?用?|つめかえ用?|本体|\d+(?:\.\d+)?\s*(?:ml|g|l|kg|枚|個|本))$/i;

/**
 * 商品名の最初の語が、【】の中にもう一度書かれていればそれ（「麗白 ハトムギ ボディミルク(400ml)【麗白】」→「麗白」）。
 * 楽天の商品にはブランドの欄が無いので、一覧に無いブランドのとき、お店の商品のブランド名に使う。無ければ ''
 */
export function brandTagInListingName(name: string): string {
  const n = name.normalize('NFKC');
  const first = withoutListingNoise(n).split(' ')[0] ?? '';
  if (first.length < 2 || NOT_A_BRAND_WORD.test(first)) return '';
  for (const [, tag] of n.matchAll(NAME_TAG)) {
    if (tag.split('(')[0].trim().toLowerCase() === first.toLowerCase()) return first;
  }
  return '';
}

/**
 * 商品名にある、まとめ売り・中古・ふるさと納税の返礼品など、1個の店頭の価格ではないもの。
 * 本体と詰替用を一緒に売るもの（「本体+詰替用」）も1個ではない（「詰替用（本体別売り）」は詰替用1個）
 */
export const NOT_SINGLE_ITEM =
  /\d+\s*(?:個|本|点|箱|袋|パック)\s*(?:セット|組|パック)|[x×]\s*\d+\s*(?:個|本|点|箱|袋|セット)|まとめ買い|まとめ売り|セット品|福袋|中古|訳あり|サンプル|試供品|ふるさと納税|返礼品|本体\s*[+&と]\s*(?:詰|つめ|付け?替|つけかえ|レフィル|リフィル)|(?:詰め?替え?用?|つめかえ用?|レフィル|リフィル)\s*[+&]\s*本体/i;

/** 詰替用の商品名（「詰替用」「詰め替え」「つめかえ用」「付け替え」「レフィル」） */
const REFILL_WORD = /詰め?替え?|詰めかえ|つめ替え|つめかえ|付け?替え?|つけ替え|つけかえ|レフィル|リフィル|refill/i;
/** 本体の商品名で詰替用に触れる言い方（「詰替用は別売り」「詰め替え可能」「詰替対応」）。詰替用そのものではない */
const REFILL_MENTION = /(?:詰め?替え?|詰めかえ|つめ替え|つめかえ|レフィル|リフィル)\s*(?:用\s*)?(?:は\s*)?(?:別売り?|可能|対応|あり)/gi;
/** 商品名の容量（「180mL」「【180mL】」「(150ml)」「50g」「1L」「30gx2」）。数字の区切りの「,」は先に外す */
const SIZE_IN_NAME = /(\d+(?:\.\d+)?)\s*(ml|g|l)(?![a-wyz])/gi;

/**
 * お店の商品名から、同じ製品の中の種類（本体・詰替用と容量）を読む。成分は同じなので製品は分けず、価格の横に書く。
 * 容量は1つだけ書かれているときだけ（「180ml 詰替150ml」は分からない）
 */
export function listingVariant(name: string): ListingVariant {
  const n = name.normalize('NFKC').replace(/(?<=\d),(?=\d{3}(?!\d))/g, '');
  const unit = (u: string) => ({ ml: 'mL', g: 'g', l: 'L' })[u.toLowerCase() as 'ml' | 'g' | 'l'];
  const sizes = new Set([...n.matchAll(SIZE_IN_NAME)].map((m) => `${Number(m[1])}${unit(m[2])}`));
  return { refill: REFILL_WORD.test(n.replace(REFILL_MENTION, ' ')), ...(sizes.size === 1 && { size: [...sizes][0] }) };
}

/** 種類の表示（「本体 180mL」「詰替用 150mL」「詰替用」） */
export function variantLabel(variant: ListingVariant): string {
  return [variant.refill ? '詰替用' : '本体', variant.size].filter(Boolean).join(' ');
}

/**
 * 名前から外す容量と、その前後の書き方（「(12g入り)」「約12g」「内容量:12g」「30g×2」「1,000ml」）。
 * listingVariant の SIZE_IN_NAME とは別（価格の横の容量の読み方は変えない）
 */
const SHOWN_SIZE =
  /(?:内容量\s*[:：]?\s*)?(?:約\s*)?(?<![a-z\d.,])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:ml|g|l)(?![a-wyz])(?:\s*[x×]\s*\d+)?(?:\s*入り?)?/gi;
/** 容量を外した後に残る空のかっこ（「(12g)」→「()」） */
const EMPTY_BRACKETS = /\(\s*\)|\[\s*\]|【\s*】/g;
/** 容量を外した後に重なった区切り（「ローション / 180mL / 無香料」→「ローション / / 無香料」） */
const DOUBLED_SEPARATOR = /([/|・])(?:\s*[/|・])+/g;
/** 容量を外した後、名前の端に残った区切り */
const EDGE_SEPARATOR = /^[\s/|・]+|[\s/|・]+$/g;

/**
 * 価格の横に容量を書く商品の名前から、その容量を外す（「プロフィニッシュクッション 0 ライトオークル(12g)」→
 * 「プロフィニッシュクッション 0 ライトオークル」。価格の横の「本体 12g」と二重に出さない）。
 * 容量は名前に1つだけ書かれているときに書く（listingVariant）ので、外すのも同じ容量。容量が無ければ、そのまま。
 * 何も残らなければ元の名前
 */
export function withoutShownSize(name: string, variant: ListingVariant | undefined): string {
  if (!variant?.size) return name;
  const s = name
    .normalize('NFKC')
    .replace(SHOWN_SIZE, ' ')
    .replace(EMPTY_BRACKETS, ' ')
    .replace(/\s+/g, ' ')
    .replace(DOUBLED_SEPARATOR, '$1')
    .replace(EDGE_SEPARATOR, '')
    .trim();
  return s || name;
}

/**
 * お店の商品1つの価格の横に書く種類。詰替用か、容量が分かるときだけ（「本体」とだけ書いても分からない）
 */
export function shopPriceVariantLabel(variant: ListingVariant | undefined): string | undefined {
  return variant && (variant.refill || variant.size) ? variantLabel(variant) : undefined;
}

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

/**
 * 1個の商品に付く特典・売り方の案内。売っているのは1個なので、セットかどうかを見る前に外す
 * - 特典：「【サンプル付き】」「サンプル2包付き」「【選べるおまけ付き】」
 * - まとめて買うと得になる案内：「【まとめ買いでポイント5倍】」「まとめ買い割対象」「【2セット購入で10%OFF】」
 * - お店の催しの対象外：「【福袋対象外】」
 * 「サンプル」「まとめ買い」だけ、「まとめ買いでお得 12本」のようにまとめ売りを言うものは外さない
 */
const SINGLE_ITEM_NOTE =
  /(?:選べる\s*)?(?:サンプル|試供品|おまけ|ノベルティ|ミニサイズ)\s*(?:\d+\s*(?:包|個|本|枚|点)\s*)?(?:付き?|つき|プレゼント|進呈|同梱)|まとめ買い\s*(?:で\s*(?:ポイント|送料|クーポン|\d+\s*%|\d+\s*円)|割引?(?:\s*対象)?|クーポン)|福袋\s*対象外|\d+\s*(?:個|本|点|セット)\s*(?:以上\s*)?(?:購入|お買い上げ)\s*で/g;

/**
 * 1個の商品でない（セット・まとめ売り・中古・試供品など）。シートマスクを探すときだけ、袋で数えた1箱を1個とする。
 * name はお店の商品名そのもの。【】の中も見る（「【まとめ買い】」「【2個セット】」。withoutListingNoise を通すと消える）。
 * 成分は1個と同じだが、表示する価格・販売ページはまとめ売りのもの。価格・お店の候補・保存した製品の代わりの商品で同じ決まりを使う
 */
export function notSingleItem(name: string, sheet: boolean): boolean {
  const n = name.normalize('NFKC').replace(SINGLE_ITEM_NOTE, ' ');
  if (!sheet) return NOT_SINGLE_ITEM.test(n);
  return NOT_SINGLE_ITEM.test(n.replace(ONE_SHEET_PACK, ' ')) || SHEET_ASSORTMENT.test(n);
}

/**
 * 表示で外す飾り（色番号の［01］などは商品の名前の一部なので残す。＼／で囲んだ売り文句と、売り文句の「」も外す）。
 * [] は、配送・売り方の語があるときだけ外す（3語以上で種類の語のある [] は SEARCH_TAG_BRACKET で外す）。
 * () は「(国内正規品)」と配送の語（「(メール便L)」）だけ外す（docs/plans/shop-names-and-cleansing-genre.md「Step 2」）。
 * かっこの中の JAN コード（「( 4901730160032 )」「(JAN:49012345)」。8桁は「JAN」と書いたときだけ）と、1語の「本体」も外す
 * （本体・詰替用と容量は価格の横に書く）
 */
const DISPLAY_NOISE = withSaleQuote(
  /\[[^\]]*(?:出荷|発送|営業日|送料|クーポン|ポイント|\d\s*倍|\d\s*(?:%|円)?\s*off(?![a-z])|(?<![a-z])sale(?![a-z])|セール|即納|メール便|ネコポス|ゆうパケット)[^\]]*\]|\(\s*(?:国内)?正規品\s*\)|\([^)]*(?:メール便|ネコポス|ゆうパケット|送料|出荷|発送)[^)]*\)|【[^】]*】|＜[^＞]*＞|<[^>]*>|[\\＼][^\\＼/／]{1,20}[/／]|★|☆|送料無料|公式(?:ショップ|ストア)?|正規品|あす楽|期間限定|(?:ポイント|(?<![a-z])P)\s*\d+\s*倍|\d+\s*%\s*OFF|\(\s*(?:JAN(?:コード)?\s*:?\s*\d{8,14}|\d{13})\s*\)/
);
/** 1語の「本体」（ほかの飾りを外した後に見る。「本体【公式】」でも外す） */
const DISPLAY_BODY_WORD = /(?<=^|[\s/／|｜])本体(?=[\s/／|｜]|$)/g;
/** 区切りの重なり（「本体」を外した後の「ミルク / / 100g」） */
const SEPARATOR_RUN = /[/／|｜](?:\s*[/／|｜])+/g;
/** 語の端に付いた区切り（「本体/無香料」の本体を外した後の「/無香料」）。空白に挟まれた区切り（「肌ラボ / 極潤」）は残す */
const SEPARATOR_AT_WORD_EDGE = /(^|\s)[/／|｜]+(?=\S)|(?<=\S)[/／|｜]+(?=\s|$)/g;

/** 「本体」を外した後の区切りを整える（docs/plans/alternatives-live-review-2026-11-23.md「Step 5」） */
function tidySeparators(name: string): string {
  return name
    .replace(SEPARATOR_RUN, (run) => run[0])
    .replace(SEPARATOR_AT_WORD_EDGE, '$1')
    .replace(/^[\s/／|｜]+|[\s/／|｜]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * お店の商品名を表示する形にする：飾り（【公式】・送料無料など）と、先頭のブランド名（上の行に出すので）を外す。
 * 何も残らなければ元の名前
 */
/** [] の中身 */
const SQUARE_BRACKET = /\[([^\]]*)\]/g;
/** 検索用の語を並べた [] の語の数の下限（「[01 ライトベージュ]」のような色の名前は2語まで） */
const MIN_TAG_BRACKET_WORDS = 3;

/**
 * 検索用の語を並べた []（「[リップクリーム 高保湿 無香料]」「[ワセリン ボディクリーム 保湿 敏感肌 乾燥肌]」）を外す。
 * 3語以上で種類・形の語があるときだけ（色の名前「[N 21 ナチュラルベージュ]」「[01 ピュアベージュ 明るい肌色]」は残す）
 */
function withoutTagBrackets(name: string): string {
  return name.replace(SQUARE_BRACKET, (whole, inner: string) => {
    const words = inner.trim().split(/\s+/).filter(Boolean);
    return words.length >= MIN_TAG_BRACKET_WORDS && words.some(isKindWord) ? ' ' : whole;
  });
}

export function displayListingName(name: string, brand = ''): string {
  const clean = (t: string, noise: RegExp) => t.replace(noise, ' ').replace(/\s+/g, ' ').trim();
  // 検索用の語（「崩れにくい 30代 …」）より後ろも出さない（withoutSearchTags）
  let s = withoutSearchTags(tidySeparators(clean(clean(withoutTagBrackets(name.normalize('NFKC')), DISPLAY_NOISE), DISPLAY_BODY_WORD)));
  // 「ちふれ・CHIFURE」のように書き方が複数あるブランドは、最初の書き方
  const b = brand.normalize('NFKC').split(/[・/／]/)[0].trim();
  // ブランド名の後に区切り（空白・／など）があるときだけ（「セザンヌ化粧品」の「セザンヌ」・型番「ABC-123」は外さない）。
  // 残りが色の印（[01]）だけなら外さない
  const rest = b && s.toLowerCase().startsWith(b.toLowerCase()) ? s.slice(b.length) : '';
  if (/^[\s/／|｜・:：]+[^\s[\]]/.test(rest) && !/^[\s/／|｜・:：]+\[[^\]]*\]$/.test(rest)) s = rest.replace(/^[\s/／|｜・:：]+/, '');
  // 最後の語がブランドなら外す（「肌をうるおす 保湿乳液 … 松山油脂」。ブランドは上の行に出す）
  const words = s.split(' ');
  if (b && words.length > 1 && words[words.length - 1].toLowerCase() === b.toLowerCase()) s = words.slice(0, -1).join(' ');
  return s || name.trim();
}
