import { Product } from '../types';

/**
 * 製品の種類（日焼け止め・化粧水 等）。代わりの商品は同じ種類からだけ選ぶ（docs/plans/alternative-recommendations.md）
 * ブラウザのカードでも使うので、サーバー専用のものは読み込まない
 */

export type AlternativeCategory = Exclude<Product['category'], 'other'>;

export const CATEGORY_LABELS_JA: Readonly<Record<AlternativeCategory, string>> = {
  cleanser: '洗顔料',
  toner: '化粧水',
  serum: '美容液',
  cream: 'クリーム',
  sunscreen: '日焼け止め',
  mask: 'パック',
  lip: 'リップ',
  foundation: 'ファンデーション',
};

/**
 * 文章・製品名に出てくる種類の言葉（先に一致したものを使う）
 * - 日焼け止め落とし・メイクリムーバーは洗顔料（日焼け止め・リップより先に見る。「リップ&アイメイクリムーバー」は洗顔料）
 * - リップが日焼け止め・クリームより先（「リップクリーム UV」はリップ）。カタカナの語の一部（フィリップ・
 *   チューリップ・クリップ）は除く（「ティントリップ」はリップ）。「唇」は「唇が荒れた」のように症状の文に出るので使わない
 * - ファンデーション（BB・CC クリームを含む）がリップ・日焼け止め・クリームより先（「クリームファンデーション」
 *   「UV ファンデ」はファンデーション）。ほかのメイク用品（下地・コンシーラー・おしろい・アイメイク等）は
 *   種類なし（スキンケアを代わりに勧めない）。下地は日焼け止めより後（「UV 下地」は日焼け止め）
 * - 日焼け止めが洗顔料より先（「クレンジング不要の日焼け止め」「洗顔料で落とせる UV ミルク」は日焼け止め）
 * - 「洗顔後の化粧水」は洗顔料ではない
 * - オールインワンはクリーム。洗顔料より後、化粧水・美容液より先（お店の名前は「オールインワンジェル 化粧水 美容液
 *   乳液」のように種類の語を並べる。「オールインワン美容液」も化粧水・美容液・クリームの代わり）
 * - スキンコンディショナーは化粧水、モイスチャライザーはクリーム（ヘア用のコンディショナーは種類なし）
 * - UV は単語のときだけ（Nuvo 等の名前の一部は除く）
 */
const CATEGORY_WORDS: readonly [RegExp, AlternativeCategory | 'makeup'][] = [
  [/日焼け止め落とし|(?<![a-z])uv(クレンジング|リムーバー)|メイク(アップ)?リムーバー/i, 'cleanser'],
  // ファンデを「落とす」洗浄料（「ファンデまで落とせるクレンジング」）はファンデーションではない
  [/(ファンデ|メイク)\S{0,6}(落と|オフ)/i, 'cleanser'],
  [/(?<![ァ-ヴー])リップ|ティントリップ|口紅|\blips?\b/i, 'lip'],
  [/ファンデ|(?<![a-z])(bb|cc) ?(クリーム|cream)|\bfoundation\b/i, 'foundation'],
  [
    /コンシーラー|(フェイス|ルース|プレスト|おしろい)パウダー|おしろい|白粉|チーク|アイシャドウ|アイシャドー|マスカラ|アイライナー|アイブロウ|ハイライター|\b(concealer|mascara|eyeliner|eyeshadow|blush)\b/i,
    'makeup',
  ],
  [/日焼け止め|サンスクリーン|sunscreen|(?<![a-z])uv(?![a-z])/i, 'sunscreen'],
  [/化粧下地|メイク下地|メイクアップベース|コントロールカラー|\bprimer\b/i, 'makeup'],
  [/洗顔(?!後)|クレンジング(?!後)|メイク落とし|\bcleanser\b/i, 'cleanser'],
  [/オールインワン/, 'cream'],
  [/化粧水|ローション|トナー|スキンコンディショナー|\btoner\b/i, 'toner'],
  [/美容液|セラム|エッセンス|\bserum\b/i, 'serum'],
  [/クリーム|乳液|ミルク|保湿ジェル|モイスチャライザー/, 'cream'],
  [/パック|シートマスク/, 'mask'],
];

/** 種類の語。メイク用品（ファンデーションを除く）は 'makeup' */
function kindFromText(text: string): AlternativeCategory | 'makeup' | undefined {
  const t = text.normalize('NFKC');
  return CATEGORY_WORDS.find(([pattern]) => pattern.test(t))?.[1];
}

export function categoryFromText(text: string): AlternativeCategory | undefined {
  const kind = kindFromText(text);
  return kind === 'makeup' ? undefined : kind;
}

const isAlternativeCategory = (c: string): c is AlternativeCategory => Object.hasOwn(CATEGORY_LABELS_JA, c);

/**
 * 製品の種類。「その他」なら製品名から推し量る（「UV」→ 日焼け止め）。分からなければ undefined
 * 名前がリップ・ファンデーション・メイク用品なら、保存された種類より名前を使う（ページの読み取りで
 * リップクリーム・クリームファンデーションが「クリーム」になることがある）
 */
export function productCategory(product: Pick<Product, 'category' | 'name'>): AlternativeCategory | undefined {
  const fromName = kindFromText(product.name);
  if (fromName === 'makeup') return undefined;
  if (fromName === 'lip' || fromName === 'foundation') return fromName;
  return isAlternativeCategory(product.category) ? product.category : fromName;
}

/** いちばん多い値。どれも無い・同数で決まらなければ undefined */
export function mostCommon<T>(values: (T | undefined)[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) if (v !== undefined) counts.set(v, (counts.get(v) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return undefined;
  return ranked[0]?.[0];
}

/** 製品に多い種類（比較の肌荒れしたコスメ等）。どれも分からない・同数で決まらなければ undefined */
export function mostCommonCategory(products: Pick<Product, 'category' | 'name'>[]): AlternativeCategory | undefined {
  return mostCommon(products.map(productCategory));
}

/**
 * 代わりの商品探しの、種類の中の分け方（docs/plans/alternative-search-improvements.md「Path 1」）。
 * Product.category は変えず、名前の語から読む（クレンジングオイルに洗顔料を、リップクリームに口紅を出さないため）
 */
export type SubKind =
  | 'makeup_remover'
  | 'face_wash'
  | 'all_in_one'
  | 'hand'
  | 'body'
  | 'eye'
  | 'milk'
  | 'gel'
  | 'face_cream'
  | 'base'
  | 'face'
  | 'lip_care'
  | 'lip_color'
  | 'sheet'
  | 'wash_off'
  | 'body_lotion'
  | 'wipe_off';

/** からだ用の語で、顔の語が無い（「顔・からだ用」「フェイス&ボディ」は顔にも使うので、からだ用にしない） */
export const BODY_ONLY = /^(?!.*(顔|フェイス|フェイシャル)).*(ボディ|からだ用|体用|全身用)/;
/** 顔用の語で、からだの語が無い */
export const FACE_ONLY = /^(?!.*(ボディ|からだ用|体用|全身用)).*(顔用|フェイス|フェイシャル)/;

/**
 * 種類ごとの、下位の種類の語（先に一致したものを使う。どれも無ければ下位の種類なし）
 * - 洗顔料：「クレンジングフォーム」「クレンジングウォッシュ」は洗顔料（泡で洗う洗顔料の名前）。その後はクレンジングの語が
 *   洗顔の語より先（「W洗顔不要のクレンジングオイル」「洗顔もできるクレンジング」はメイク落とし）。「メイクも落とせる洗顔料」は洗顔料
 * - クリーム：オールインワンが最初（「オールインワンジェル」「目元にも使えるオールインワン」）。ハンド → からだ用 → 目元 → 乳液 →
 *   ジェル → クリームの順（「ハンドクリーム」はハンド、「ボディミルク」はからだ用、「ジェル乳液」は乳液、「ジェルクリーム」は
 *   ジェル）。「目元にも」「目元まで」は目元用ではない。「ハンド&ボディ」はハンド
 * - 日焼け止め：下地（下地・トーンアップ・ベース）が最初（「トーンアップ UV 顔用」は下地）。顔とからだの両方に使うものは
 *   下位の種類なし。「ウォーターベース」は下地ではない
 * - リップ：リップケアの語が口紅の語より先（「色付きリップクリーム」「ティント リップバーム」はリップケア、「色付きリップ」は口紅）
 * - パック：シートが洗い流すものより先（「クレイ シートマスク」はシート）。「洗い流し不要」は洗い流すパックではない
 * - 化粧水：からだ用が拭き取りより先
 */
const SUB_KIND_WORDS: Partial<Record<AlternativeCategory, readonly [RegExp, SubKind][]>> = {
  cleanser: [
    [/クレンジング(フォーム|ウォッシュ)/, 'face_wash'],
    [/クレンジング|メイク落とし|リムーバー|日焼け止め落とし/, 'makeup_remover'],
    [/洗顔|ウォッシュ|フォーム|石けん|石鹸/, 'face_wash'],
  ],
  cream: [
    [/オールインワン/, 'all_in_one'],
    [/ハンド(?!メイド)/, 'hand'],
    [BODY_ONLY, 'body'],
    [/アイクリーム|アイジェル|目元(?!にも|まで)|目もと(?!にも|まで)/, 'eye'],
    [/乳液|ミルク|エマルジョン|エマルション/, 'milk'],
    [/ジェル|ゲル/, 'gel'],
    [/クリーム/, 'face_cream'],
  ],
  sunscreen: [
    [/下地|トーンアップ|(?<!ウォーター|ウオーター)ベース/, 'base'],
    [BODY_ONLY, 'body'],
    [FACE_ONLY, 'face'],
  ],
  lip: [
    [/リップクリーム|リップバーム|薬用リップ|リップケア|リップトリートメント|リップエッセンス|リップ美容液|リップセラム/, 'lip_care'],
    [/口紅|ルージュ|ティント|グロス|リップカラー|色付き|色つき/, 'lip_color'],
  ],
  mask: [
    [/シート|枚入り|\d+枚/, 'sheet'],
    [/洗い流す|洗い流し(?!不要)|ウォッシュオフ|クレイ|泥|ピールオフ/, 'wash_off'],
  ],
  toner: [
    [BODY_ONLY, 'body_lotion'],
    [/拭き取り|拭きとり|ふきとり|ふき取り/, 'wipe_off'],
  ],
};

/** 種類の中の、下位の種類（名前・文章から）。種類が無い・語が無ければ undefined */
export function subKindFromText(kind: AlternativeCategory | undefined, text: string): SubKind | undefined {
  if (!kind) return undefined;
  const t = text.normalize('NFKC');
  return SUB_KIND_WORDS[kind]?.find(([pattern]) => pattern.test(t))?.[1];
}

/** 製品の下位の種類（productCategory の種類の中で、名前から） */
export function productSubKind(product: Pick<Product, 'category' | 'name'>): SubKind | undefined {
  return subKindFromText(productCategory(product), product.name);
}

/** 肌荒れしたコスメのうち、その種類の製品に多い下位の種類。同数・無ければ undefined */
export function mostCommonSubKind(
  products: Pick<Product, 'category' | 'name'>[],
  kind: AlternativeCategory | undefined
): SubKind | undefined {
  return mostCommon(products.filter((p) => kind && productCategory(p) === kind).map(productSubKind));
}

/**
 * 同じ下位の種類の候補しか代わりにならないもの（顔の製品はハンド・からだ・目元・口紅・メイク落とし・ボディローションの
 * 代わりにならず、その逆も同じ）。分析した製品がこれなら、名前に下位の種類が無い候補も外す
 */
const STRICT_SUB_KINDS: ReadonlySet<SubKind> = new Set(['hand', 'body', 'eye', 'lip_color', 'makeup_remover', 'body_lotion']);
/** 分析した製品に下位の種類が無いとき（顔のクリーム等として扱う）に外す、候補の下位の種類 */
const NOT_FOR_UNSAID: ReadonlySet<SubKind> = new Set(['hand', 'body', 'eye', 'lip_color', 'body_lotion']);

/**
 * 候補の下位の種類が、分析した製品に合うか。same: 同じ（先に並べる）/ unsaid: 名前で分からない・どちらでもよい（後に並べる）/
 * other: 別の下位の種類（外す）。分析した製品にも候補にも下位の種類が無ければ unsaid（今までどおり）
 */
export function subKindFit(wanted: SubKind | undefined, candidate: SubKind | undefined): 'same' | 'unsaid' | 'other' {
  if (!wanted) return candidate && NOT_FOR_UNSAID.has(candidate) ? 'other' : 'unsaid';
  if (candidate === wanted) return 'same';
  if (candidate) return 'other';
  return STRICT_SUB_KINDS.has(wanted) ? 'other' : 'unsaid';
}
