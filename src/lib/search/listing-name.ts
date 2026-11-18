/** お店の商品名に付く、商品の名前ではない語（検索語を作るときだけ外す。表示する名前は変えない） */
const LISTING_NOISE =
  /【[^】]*】|［[^］]*］|\[[^\]]*\]|＜[^＞]*＞|<[^>]*>|★|☆|送料無料|公式(?:ショップ|ストア)?|正規品|あす楽|期間限定|ポイント\s*\d+\s*倍|\d+\s*%\s*OFF/gi;

/** 商品名から飾りを外す（検索語と、コスメかどうかの確認にだけ使う。表示する名前は変えない） */
export function withoutListingNoise(name: string): string {
  return name.normalize('NFKC').replace(LISTING_NOISE, ' ').replace(/\s+/g, ' ').trim();
}

/** 商品名にある、まとめ売り・中古・ふるさと納税の返礼品など、1個の店頭の価格ではないもの */
export const NOT_SINGLE_ITEM =
  /\d+\s*(?:個|本|点|箱|袋|パック)\s*(?:セット|組|パック)|[x×]\s*\d+\s*(?:個|本|点|箱|袋|セット)|まとめ買い|まとめ売り|セット品|福袋|中古|訳あり|サンプル|試供品|ふるさと納税|返礼品/i;

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
 * 1個の商品でない（セット・まとめ売り・中古・試供品など）。シートマスクを探すときだけ、袋で数えた1箱を1個とする。
 * name は withoutListingNoise を通した名前（お店の候補と、保存した製品の代わりの商品で同じ決まりを使う）
 */
export function notSingleItem(name: string, sheet: boolean): boolean {
  if (!sheet) return NOT_SINGLE_ITEM.test(name);
  return NOT_SINGLE_ITEM.test(name.replace(ONE_SHEET_PACK, ' ')) || SHEET_ASSORTMENT.test(name);
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
