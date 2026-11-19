import type { ListingVariant } from '../types';

/** お店の商品名に付く、商品の名前ではない語（検索語を作るときだけ外す。表示する名前は変えない） */
const LISTING_NOISE =
  /【[^】]*】|［[^］]*］|\[[^\]]*\]|＜[^＞]*＞|<[^>]*>|★|☆|送料無料|公式(?:ショップ|ストア)?|正規品|あす楽|期間限定|ポイント\s*\d+\s*倍|\d+\s*%\s*OFF/gi;

/** 商品名から飾りを外す（検索語と、コスメかどうかの確認にだけ使う。表示する名前は変えない） */
export function withoutListingNoise(name: string): string {
  return name.normalize('NFKC').replace(LISTING_NOISE, ' ').replace(/\s+/g, ' ').trim();
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

/** 表示で外す飾り（色番号の［01］などは商品の名前の一部なので残す） */
const DISPLAY_NOISE =
  /【[^】]*】|＜[^＞]*＞|<[^>]*>|★|☆|送料無料|公式(?:ショップ|ストア)?|正規品|あす楽|期間限定|ポイント\s*\d+\s*倍|\d+\s*%\s*OFF/gi;

/**
 * お店の商品名を表示する形にする：飾り（【公式】・送料無料など）と、先頭のブランド名（上の行に出すので）を外す。
 * 何も残らなければ元の名前
 */
export function displayListingName(name: string, brand = ''): string {
  let s = name.normalize('NFKC').replace(DISPLAY_NOISE, ' ').replace(/\s+/g, ' ').trim();
  // 「ちふれ・CHIFURE」のように書き方が複数あるブランドは、最初の書き方
  const b = brand.normalize('NFKC').split(/[・/／]/)[0].trim();
  // ブランド名の後に区切り（空白・／など）があるときだけ（「セザンヌ化粧品」の「セザンヌ」・型番「ABC-123」は外さない）。
  // 残りが色の印（[01]）だけなら外さない
  const rest = b && s.toLowerCase().startsWith(b.toLowerCase()) ? s.slice(b.length) : '';
  if (/^[\s/／|｜・:：]+[^\s[\]]/.test(rest) && !/^[\s/／|｜・:：]+\[[^\]]*\]$/.test(rest)) s = rest.replace(/^[\s/／|｜・:：]+/, '');
  return s || name.trim();
}
