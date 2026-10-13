import { ReferenceLink } from '../types';

/**
 * 化粧品基準（平成12年厚生省告示第331号）の別表。MHLW 掲載の改正反映版（最新の改正は令和6年7月12日
 * 厚生労働省告示第243号。改正の履歴は東京都健康安全研究センターの通知一覧で確認）
 * 告示は著作権の対象外（著作権法13条2号）。表の値は告示の PDF（MHLW 掲載の改正反映版）と照合した。
 * 手順と照合の記録: docs/plans/japan-ingredient-data.md の Step 2
 *
 * - nameJa: 告示の成分名（そのまま）
 * - nameEn: 英文版（Provisional Translation）の名前
 * - names: 成分表示と照合する名前（化粧品の表示名称・INCI 名）。正規化して完全一致で照合する。
 *   表示名称は日本化粧品工業会のリストとは照合していない（docs/plans/japan-ingredient-data.md の Step 1）
 * - namePattern: 物質群（「パラオキシ安息香酸エステル」等）を名前の形で照合する（正規化した名前に対して）
 * - 別表第1・第2 は配合の禁止・制限。別表第3 は防腐剤、別表第4 は紫外線吸収剤として配合するときの上限
 */

export const COSMETIC_STANDARD_REFERENCE: ReferenceLink = {
  title: '厚生労働省「化粧品基準」（平成12年厚生省告示第331号）',
  url: 'https://www.mhlw.go.jp/content/000491511.pdf',
};

/** 最新の改正（MHLW の掲載版に反映済み）。改正を確かめたらここを更新する */
export const COSMETIC_STANDARD_AMENDED = '2024-07-12';

/** 100g 中の最大配合量（g）。'any' は上限なし（告示の ○）、'banned' は配合不可（告示の空欄・「配合不可」） */
export type StandardLimit = number | 'any' | 'banned';

export type StandardTable =
  | '別表第1' // 配合禁止
  | '別表第2の1' // すべての化粧品に配合の制限
  | '別表第2の2' // 化粧品の種類・使用目的による制限
  | '別表第2の3' // 化粧品の種類による制限
  | '別表第3の1' // 防腐剤（すべての化粧品）
  | '別表第3の2' // 防腐剤（化粧品の種類による）
  | '別表第4の1' // 紫外線吸収剤（すべての化粧品）
  | '別表第4の2'; // 紫外線吸収剤（化粧品の種類による）

export interface StandardEntry {
  table: StandardTable;
  nameJa: string;
  nameEn: string;
  names: string[];
  namePattern?: RegExp;
  /** すべての化粧品での上限（別表第2の1・第3の1・第4の1）。「合計量として」の上限は totalJa に書く */
  all?: StandardLimit;
  /** 化粧品の種類ごとの上限（別表第2の3・第3の2・第4の2） */
  rinseOff?: StandardLimit;
  leaveOn?: StandardLimit;
  mucosa?: StandardLimit;
  /** 別表第2の2 の条件つきの制限（告示の文言を短くしたもの） */
  conditionsJa?: string[];
  /** 「合計量として」などの注 */
  noteJa?: string;
}

const banned = (nameJa: string, nameEn: string, names: string[] = [], namePattern?: RegExp): StandardEntry => ({
  table: '別表第1',
  nameJa,
  nameEn,
  names,
  ...(namePattern && { namePattern }),
});

const byType = (
  table: '別表第2の3' | '別表第3の2' | '別表第4の2',
  nameJa: string,
  nameEn: string,
  [rinseOff, leaveOn, mucosa]: [StandardLimit, StandardLimit, StandardLimit],
  names: string[] = [],
  noteJa?: string
): StandardEntry => ({ table, nameJa, nameEn, names, rinseOff, leaveOn, mucosa, ...(noteJa && { noteJa }) });

const forAll = (
  table: '別表第2の1' | '別表第3の1' | '別表第4の1',
  nameJa: string,
  nameEn: string,
  all: StandardLimit,
  names: string[] = [],
  extra: Partial<StandardEntry> = {}
): StandardEntry => ({ table, nameJa, nameEn, names, all, ...extra });

const B: StandardLimit = 'banned';
const O: StandardLimit = 'any';

export const COSMETIC_STANDARD: StandardEntry[] = [
  // ---------------- 別表第1（配合禁止）。物質群は、名前で見分けられるものだけ照合する ----------------
  banned('６―アセトキシ２，４ジメチル―ｍ―ジオキサン', '6-Acetoxy-2,4-dimethyl-m-dioxane', ['dimethoxane']),
  banned('アミノエーテル型の抗ヒスタミン剤（ジフェンヒドラミン等）以外の抗ヒスタミン剤', 'Antihistamines except those of aminoether type'),
  banned('エストラジオール、エストロン又はエチニルエストラジオール以外のホルモン及びその誘導体', 'Hormones and those derivatives except estradiol, estrone and ethinylestradiol'),
  banned('塩化ビニルモノマー', 'Vinyl chloride monomer', ['塩化ビニルモノマー', 'vinyl chloride']),
  banned('塩化メチレン', 'Methylene chloride', ['塩化メチレン', 'ジクロロメタン', 'methylene chloride', 'dichloromethane']),
  banned('オキシ塩化ビスマス以外のビスマス化合物', 'Bismuth compounds other than bismuth oxychloride', [], /ビスマス|bismuth/),
  banned('過酸化水素', 'Hydrogen peroxide', ['過酸化水素', '過酸化水素水', 'hydrogen peroxide']),
  banned('カドミウム化合物', 'Cadmium compounds', [], /カドミウム|cadmium/),
  banned('過ホウ酸ナトリウム', 'Sodium perborate', ['過ホウ酸ナトリウム', '過ホウ酸na', 'sodium perborate']),
  banned('クロロホルム', 'Chloroform', ['クロロホルム', 'chloroform']),
  banned('酢酸プログレノロン', 'Progrenolone acetate', ['酢酸プログレノロン']),
  banned('ジクロロフェン', 'Dichlorophene', ['ジクロロフェン', 'dichlorophene', 'dichlorophen']),
  banned('水銀及びその化合物', 'Mercury and its compounds', [], /水銀|mercury|thimerosal|チメロサール/),
  banned('ストロンチウム化合物', 'Strontium compounds', [], /ストロンチウム|strontium/),
  banned('スルファミド及びその誘導体', 'Sulfamide and its derivatives'),
  banned('セレン化合物', 'Selenium compounds', [], /セレン|selenium/),
  banned('ニトロフラン系化合物', 'Nitrofuran type compounds'),
  banned('ハイドロキノンモノベンジルエーテル', 'Hydroquinone monobenzylether', ['ハイドロキノンモノベンジルエーテル', 'モノベンゾン', 'monobenzone']),
  banned('ハロゲン化サリチルアニリド', 'Halogenated salicylanilide'),
  banned('ビタミンＬ１及びＬ２', 'Vitamin L1 and Vitamin L2'),
  banned('ビチオノール', 'Bithionol', ['ビチオノール', 'bithionol']),
  banned('ピロカルピン', 'Pilocalpine', ['ピロカルピン', 'pilocarpine']),
  banned('ピロガロール', 'Pyrogallol', ['ピロガロール', 'pyrogallol']),
  banned('フッ素化合物のうち無機化合物', 'Inorganic fluorine compounds', ['フッ化ナトリウム', 'フッ化na', 'フッ化スズ', 'モノフルオロリン酸ナトリウム', 'モノフルオロリン酸na', 'sodium fluoride', 'stannous fluoride', 'sodium monofluorophosphate']),
  banned('プレグナンジオール', 'Pregnanediol', ['プレグナンジオール', 'pregnanediol']),
  banned('プロカイン等の局所麻酔剤', 'Local anesthetics such as procaine', ['プロカイン', 'リドカイン', 'ベンゾカイン', 'procaine', 'lidocaine', 'benzocaine']),
  banned('ヘキサクロロフェン', 'Hexachlorophen', ['ヘキサクロロフェン', 'hexachlorophene']),
  banned('ホウ酸', 'Boric acid', ['ホウ酸', 'boric acid']),
  // 告示は「ホルマリン」（ホルムアルデヒドの水溶液）。成分表示のホルムアルデヒドも同じ物質として照合する
  banned('ホルマリン', 'Formalin', ['ホルマリン', 'ホルムアルデヒド', 'formalin', 'formaldehyde']),
  banned('メチルアルコール', 'Methyl alcohol', ['メチルアルコール', 'メタノール', 'methyl alcohol', 'methanol']),

  // ---------------- 別表第2（防腐剤・紫外線吸収剤・タール色素以外の成分の配合の制限） ----------------
  forAll('別表第2の1', 'アラントインクロルヒドロキシアルミニウム', 'Aluminum chlorhydroxy allantoinate', 1.0, ['アラントインクロルヒドロキシアルミニウム', 'アルクロキサ', 'alcloxa']),
  forAll('別表第2の1', 'カンタリスチンキ、ショウキョウチンキ又はトウガラシチンキ', 'Cantharides tincture, ginger tincture or capsicum tincture', 1.0, ['カンタリスチンキ', 'ショウキョウチンキ', 'トウガラシチンキ'], { noteJa: '3つの合計量として' }),
  forAll('別表第2の1', 'サリチル酸フェニル', 'Phenyl salicylate', 1.0, ['サリチル酸フェニル', 'phenyl salicylate']),
  forAll('別表第2の1', 'ポリオキシエチレンラウリルエーテル（８～10E.O.）', 'Polyoxyethylene laurylether (8-10E.O.)', 2.0, ['ラウレス-8', 'ラウレス-9', 'ラウレス-10', 'laureth-8', 'laureth-9', 'laureth-10']),
  {
    table: '別表第2の2',
    nameJa: 'ジルコニウム',
    nameEn: 'Zirconium',
    names: [],
    conditionsJa: ['エアゾール剤には配合できません'],
  },
  {
    table: '別表第2の2',
    nameJa: 'チラム',
    nameEn: 'Thiram',
    names: ['チラム', 'thiram'],
    rinseOff: 0.5,
    leaveOn: 0.3,
    mucosa: 0.3,
  },
  {
    table: '別表第2の2',
    nameJa: 'ウンデシレン酸モノエタノールアミド',
    nameEn: 'Undecylenic acid monoethanolamide',
    names: ['ウンデシレン酸モノエタノールアミド', 'ウンデシレナミドmea', 'undecylenamide mea'],
    leaveOn: 'banned',
    mucosa: 'banned',
  },
  {
    table: '別表第2の2',
    nameJa: 'パラフェノールスルホン酸亜鉛',
    nameEn: 'Zinc p-phenolsulfonate',
    names: ['パラフェノールスルホン酸亜鉛', 'フェノールスルホン酸亜鉛', 'zinc phenolsulfonate'],
    leaveOn: 2.0,
    mucosa: 2.0,
  },
  {
    table: '別表第2の2',
    nameJa: '２―（２―ヒドロキシ―５―メチルフェニル)ベンゾトリアゾール',
    nameEn: '2-(2-Hydroxy-5-methylphenyl) benzotriazole',
    names: ['ドロメトリゾール', 'drometrizole'],
    leaveOn: 7.0,
    mucosa: 7.0,
  },
  {
    table: '別表第2の2',
    nameJa: 'ラウロイルサルコシンナトリウム',
    nameEn: 'Sodium lauroyl sarcosinate',
    names: ['ラウロイルサルコシンナトリウム', 'ラウロイルサルコシンna', 'sodium lauroyl sarcosinate'],
    leaveOn: 'banned',
    mucosa: 'banned',
    conditionsJa: ['歯磨には100g中0.50gまで'],
  },
  {
    table: '別表第2の2',
    nameJa: 'システアミン塩酸塩',
    nameEn: 'Cysteamine Hydrochloride',
    names: ['システアミン塩酸塩', 'システアミンhcl', 'cysteamine hcl', 'cysteamine hydrochloride'],
    conditionsJa: ['頭髪のみに使用され、洗い流すヘアセット料には100g中8.63gまで。それ以外の化粧品には配合できません'],
  },
  {
    table: '別表第2の2',
    nameJa: 'エストラジオール、エストロン又はエチニルエストラジオール',
    nameEn: 'Estradiol, estrone and ethinylestradiol',
    names: ['エストラジオール', 'エストロン', 'エチニルエストラジオール', 'estradiol', 'estrone', 'ethinylestradiol'],
    conditionsJa: ['化粧品の種類とアルコール類の有無により、合計量として100g中20000国際単位または50000国際単位まで'],
  },
  {
    table: '別表第2の2',
    nameJa: 'アミノエーテル型の抗ヒスタミン剤',
    nameEn: 'Aminoether type antihistamines',
    names: ['ジフェンヒドラミン', '塩酸ジフェンヒドラミン', 'ジフェンヒドラミンhcl', 'diphenhydramine', 'diphenhydramine hcl'],
    conditionsJa: ['頭部のみに使用される化粧品には100g中0.010gまで。それ以外の化粧品には配合できません'],
  },
  {
    table: '別表第2の2',
    nameJa: 'ジエチレングリコール',
    nameEn: 'Diethylene glycol',
    names: ['ジエチレングリコール', 'diethylene glycol'],
    conditionsJa: ['歯磨には配合できません'],
  },
  {
    table: '別表第2の2',
    nameJa: 'ホウ砂',
    nameEn: 'Sodium pyroborate',
    names: ['ホウ砂', 'borax', 'sodium borate'],
    conditionsJa: [
      'ミツロウ・サラシミツロウを乳化させる目的に限り、100g中0.76gまで（ミツロウ・サラシミツロウの1/2以下の量の場合に限る）。それ以外の目的では配合できません',
    ],
  },
  byType('別表第2の3', 'タイソウエキス', 'Jujube Extract', [O, O, 5.0], ['タイソウエキス'], '日本薬局方タイソウを30％エタノール水溶液で抽出したエキス'),
  byType('別表第2の3', 'チオクト酸', 'Thioctic acid', [0.01, 0.01, B], ['チオクト酸', 'thioctic acid', 'lipoic acid', 'αリポ酸']),
  byType('別表第2の3', 'ユビデカレノン', 'Ubidecarenone', [0.03, 0.03, B], ['ユビデカレノン', 'ユビキノン', 'ubiquinone', 'ubidecarenone', 'コエンザイムq10']),

  // ---------------- 別表第3（防腐剤） ----------------
  forAll('別表第3の1', '安息香酸', 'Benzoic acid', 0.2, ['安息香酸', 'benzoic acid']),
  forAll('別表第3の1', '安息香酸塩類', 'Benzoate', 1.0, ['安息香酸ナトリウム', '安息香酸na', '安息香酸カリウム', '安息香酸k', 'sodium benzoate', 'potassium benzoate'], { noteJa: '合計量として' }),
  forAll('別表第3の1', '塩酸アルキルジアミノエチルグリシン', 'Alkyldiaminoethylglycine hydrochloride', 0.2, ['塩酸アルキルジアミノエチルグリシン']),
  forAll('別表第3の1', '感光素', 'Photosensitizing dyes', 0.002, [], { namePattern: /^感光素/, noteJa: '合計量として' }),
  forAll('別表第3の1', 'クロルクレゾール', 'Chlorcresol', 0.5, ['クロルクレゾール', 'chlorocresol', 'p-chloro-m-cresol']),
  forAll('別表第3の1', 'クロロブタノール', 'Chlorobutanol', 0.1, ['クロロブタノール', 'chlorobutanol']),
  forAll('別表第3の1', 'サリチル酸', 'Salicylic acid', 0.2, ['サリチル酸', 'salicylic acid']),
  forAll('別表第3の1', 'サリチル酸塩類', 'Salicylate', 1.0, ['サリチル酸ナトリウム', 'サリチル酸na', 'sodium salicylate'], { noteJa: '合計量として' }),
  forAll('別表第3の1', 'ソルビン酸及びその塩類', 'Sorbic acid and sorbate', 0.5, ['ソルビン酸', 'ソルビン酸カリウム', 'ソルビン酸k', 'sorbic acid', 'potassium sorbate'], { noteJa: '合計量として' }),
  forAll('別表第3の1', 'デヒドロ酢酸及びその塩類', 'Dehydroacetic acid and dehydroacetate', 0.5, ['デヒドロ酢酸', 'デヒドロ酢酸ナトリウム', 'デヒドロ酢酸na', 'dehydroacetic acid', 'sodium dehydroacetate'], { noteJa: '合計量として' }),
  forAll('別表第3の1', 'トリクロロヒドロキシジフェニルエーテル（別名トリクロサン）', 'Trichlorohydroxydiphenylether (Triclosan)', 0.1, ['トリクロサン', 'トリクロロヒドロキシジフェニルエーテル', 'triclosan']),
  forAll('別表第3の1', 'パラオキシ安息香酸エステル及びそのナトリウム塩', 'p-Oxybenzoic acid esters and their sodium salts', 1.0, [], {
    namePattern: /パラベン(na|ナトリウム)?$|^パラオキシ安息香酸|paraben$/,
    noteJa: '合計量として',
  }),
  forAll('別表第3の1', 'フェノキシエタノール', 'Phenoxyethanol', 1.0, ['フェノキシエタノール', 'phenoxyethanol']),
  forAll('別表第3の1', 'フェノール', 'Phenol', 0.1, ['フェノール', 'phenol']),
  forAll('別表第3の1', 'ラウリルジアミノエチルグリシンナトリウム', 'Sodium lauryldiaminoethylglycine', 0.03, ['ラウリルジアミノエチルグリシンナトリウム', 'ラウリルジアミノエチルグリシンna']),
  forAll('別表第3の1', 'レゾルシン', 'Resorcin', 0.1, ['レゾルシン', 'resorcinol']),
  byType('別表第3の2', '亜鉛・アンモニア・銀複合置換型ゼオライト', 'Zinc, ammonia and silver substituted zeolite', [1.0, 1.0, B], ['亜鉛・アンモニア・銀複合置換型ゼオライト']),
  byType('別表第3の2', '安息香酸パントテニルエチルエーテル', 'Pantothenyl ethylether benzoate', [O, 0.3, 0.3], ['安息香酸パントテニルエチルエーテル']),
  byType('別表第3の2', 'イソプロピルメチルフェノール', 'Isopropylmethylphenol', [O, 0.1, 0.1], ['イソプロピルメチルフェノール', 'o-シメン-5-オール', 'o-cymen-5-ol']),
  byType('別表第3の2', '塩化セチルピリジニウム', 'Cetylpyridinium chloride', [5.0, 1.0, 0.01], ['塩化セチルピリジニウム', 'セチルピリジニウムクロリド', 'cetylpyridinium chloride']),
  byType('別表第3の2', '塩化ベンザルコニウム', 'Benzalkonium chloride', [O, 0.05, 0.05], ['塩化ベンザルコニウム', 'ベンザルコニウムクロリド', 'benzalkonium chloride']),
  byType('別表第3の2', '塩化ベンゼトニウム', 'Benzethonium chloride', [0.5, 0.2, B], ['塩化ベンゼトニウム', 'ベンゼトニウムクロリド', 'benzethonium chloride']),
  byType('別表第3の2', '塩酸クロルヘキシジン', 'Chlorhexidine hydrochloride', [0.1, 0.1, 0.001], ['塩酸クロルヘキシジン', 'chlorhexidine dihydrochloride']),
  byType('別表第3の2', 'オルトフェニルフェノール', 'o-Phenyl phenol', [O, 0.3, 0.3], ['オルトフェニルフェノール', 'o-phenylphenol']),
  byType('別表第3の2', 'オルトフェニルフェノールナトリウム', 'Sodium o-phenylphenate', [0.15, 0.15, B], ['オルトフェニルフェノールナトリウム', 'sodium o-phenylphenate']),
  byType('別表第3の2', '銀－銅ゼオライト', 'Silver-Copper Zeolite', [0.5, 0.5, B], ['銀-銅ゼオライト', 'silver copper zeolite']),
  byType('別表第3の2', 'グルコン酸クロルヘキシジン', 'Chlorhexidine gluconate', [O, 0.05, 0.05], ['グルコン酸クロルヘキシジン', 'chlorhexidine digluconate', 'chlorhexidine gluconate']),
  byType('別表第3の2', 'クレゾール', 'Cresol', [0.01, 0.01, B], ['クレゾール', 'cresol']),
  byType('別表第3の2', 'クロラミンＴ', 'Chloramine T', [0.3, 0.1, B], ['クロラミンt', 'chloramine t']),
  byType('別表第3の2', 'クロルキシレノール', 'Chlorxylenol', [0.3, 0.2, 0.2], ['クロルキシレノール', 'chloroxylenol']),
  byType('別表第3の2', 'クロルフェネシン', 'Chlorphenesin', [0.3, 0.3, B], ['クロルフェネシン', 'chlorphenesin']),
  byType('別表第3の2', 'クロルヘキシジン', 'Chlorhexidine', [0.1, 0.05, 0.05], ['クロルヘキシジン', 'chlorhexidine']),
  byType('別表第3の2', '１，３―ジメチロール―５，５―ジメチルヒダントイン', '1,3-Dimethylol-5,5-dimethylhydantoin', [0.3, B, B], ['dmdmヒダントイン', 'dmdm hydantoin']),
  byType('別表第3の2', '臭化アルキルイソキノリニウム', 'Alkylisoquinolinium bromide', [O, 0.05, 0.05], ['臭化アルキルイソキノリニウム']),
  byType('別表第3の2', 'チアントール', 'Thianthol', [0.8, 0.8, B], ['チアントール', 'thianthol']),
  byType('別表第3の2', 'チモール', 'Thymol', [0.05, 0.05, O], ['チモール', 'thymol'], '粘膜に使用される化粧品は、口腔に使用されるものに限り配合できます'),
  byType('別表第3の2', 'トリクロロカルバニリド', 'Trichlorocarbanilide', [O, 0.3, 0.3], ['トリクロロカルバニリド', 'トリクロカルバン', 'triclocarban']),
  byType('別表第3の2', 'パラクロルフェノール', 'p-Chlorphenol', [0.25, 0.25, B], ['パラクロルフェノール', 'p-chlorophenol']),
  byType('別表第3の2', 'ハロカルバン', 'Halocarban', [O, 0.3, 0.3], ['ハロカルバン', 'cloflucarban']),
  byType('別表第3の2', 'ヒノキチオール', 'Hinokitiol', [O, 0.1, 0.05], ['ヒノキチオール', 'hinokitiol']),
  byType('別表第3の2', 'ピリチオン亜鉛', 'Zinc pyrithione', [0.1, 0.01, 0.01], ['ピリチオン亜鉛', 'ジンクピリチオン', 'zinc pyrithione']),
  byType('別表第3の2', 'ピロクトンオラミン', 'Piroctone olamine', [0.05, 0.05, B], ['ピロクトンオラミン', 'piroctone olamine']),
  byType('別表第3の2', 'ブチルカルバミン酸ヨウ化プロピニル', 'Iodopropynyl butylcarbamate', [0.02, 0.02, 0.02], ['ブチルカルバミン酸ヨウ化プロピニル', 'iodopropynyl butylcarbamate'], 'エアゾール剤には配合できません'),
  byType('別表第3の2', 'ポリアミノプロピルビグアナイド', 'Polyaminopropyl biguanide', [0.1, 0.1, 0.1], ['ポリアミノプロピルビグアナイド', 'ポリアミノプロピルビグアニド', 'polyaminopropyl biguanide']),
  byType('別表第3の2', 'メチルイソチアゾリノン', 'Methyl isothiazolinone', [0.01, 0.01, B], ['メチルイソチアゾリノン', 'methylisothiazolinone']),
  byType(
    '別表第3の2',
    'メチルクロロイソチアゾリノン・メチルイソチアゾリノン液',
    'Methylchloro isothiazolinone and methyl isothiazolinone solution',
    [0.1, B, B],
    ['メチルクロロイソチアゾリノン・メチルイソチアゾリノン液', 'メチルクロロイソチアゾリノン', 'methylchloroisothiazolinone'],
    '5-クロロ-2-メチル-4-イソチアゾリン-3-オン1.0〜1.3％と2-メチル-4-イソチアゾリン-3-オン0.30〜0.42％を含む水溶液としての量'
  ),
  byType('別表第3の2', 'Ｎ，Ｎ’’―メチレンビス〔Ｎ’―（３―ヒドロキシメチル―２，５―ジオキソ―４―イミダゾリジニル)ウレア］', "N,N''-Methylenebis[N'-(3-hydroxymethyl-2,5-dioxo-4-imidazolidinyl)urea]", [0.3, B, B], ['イミダゾリジニルウレア', 'imidazolidinyl urea']),
  byType('別表第3の2', 'ヨウ化パラジメチルアミノスチリルヘプチルメチルチアゾリウム', 'p-Dimethylaminostyryl heptyl methyl thiazolium iodide', [0.0015, 0.0015, B], ['ヨウ化パラジメチルアミノスチリルヘプチルメチルチアゾリウム']),

  // ---------------- 別表第4（紫外線吸収剤） ----------------
  forAll('別表第4の1', 'サリチル酸ホモメンチル', 'Homomenthyl salicylate', 10, ['サリチル酸ホモメンチル', 'ホモサレート', 'homosalate']),
  forAll('別表第4の1', '2－シアノ－3,3－ジフェニルプロパ－2－エン酸 2－エチルヘキシルエステル（別名オクトクリレン）', '2-Cyano-3,3-diphenyl prop-2-enoic acid 2-ethylhexyl ester (octocrylene)', 10, ['オクトクリレン', 'octocrylene']),
  forAll('別表第4の1', 'ジパラメトキシケイ皮酸モノ－2－エチルヘキサン酸グリセリル', 'Glyceryl mono-2-ethylhexanoate di-p-methoxycinnamate', 10, ['glyceryl ethylhexanoate dimethoxycinnamate']),
  forAll('別表第4の1', 'トリスビフェニルトリアジン', 'Tris-Biphenyl Triazine', 10, ['トリスビフェニルトリアジン', 'tris-biphenyl triazine']),
  forAll('別表第4の1', 'パラアミノ安息香酸及びそのエステル', 'p-Aminobenzoic acid and its esters', 4.0, ['パラアミノ安息香酸', 'paba', 'aminobenzoic acid', '4-aminobenzoic acid'], { noteJa: '合計量として' }),
  forAll('別表第4の1', '4－tert－ブチル－4’－メトキシジベンゾイルメタン', "4-tert-Butyl-4'-methoxy dibenzoylmethane", 10, ['t-ブチルメトキシジベンゾイルメタン', 'butyl methoxydibenzoylmethane', 'avobenzone']),
  byType('別表第4の2', '４―（２―β―グルコピラノシロキシ)プロポキシ―２―ヒドロキシベンゾフェノン', '4-(2-β-glucopyranosiloxy) propoxy-2-hydroxybenzophenone', [5.0, 5.0, B]),
  byType('別表第4の2', 'サリチル酸オクチル', 'Octyl salicylate', [10, 10, 5.0], ['サリチル酸オクチル', 'サリチル酸エチルヘキシル', 'ethylhexyl salicylate', 'octisalate']),
  byType('別表第4の2', '２，５―ジイソプロピルケイ皮酸メチル', 'Methyl-2,5-diisopropylcinnamate', [10, 10, B]),
  byType('別表第4の2', '２―［４―（ジエチルアミノ)―２―ヒドロキシベンゾイル]安息香酸ヘキシルエステル', '2-[4-(diethylamino)-2-hydroxybenzoyl] benzoic acid hexylester', [10, 10, B], ['ジエチルアミノヒドロキシベンゾイル安息香酸ヘキシル', 'diethylamino hydroxybenzoyl hexyl benzoate']),
  byType('別表第4の2', 'シノキサート', 'Cinoxate', [O, 5.0, 5.0], ['シノキサート', 'cinoxate']),
  byType('別表第4の2', 'ジヒドロキシジメトキシベンゾフェノン', 'Dihydroxydimethoxybenzophenone', [10, 10, B], ['オキシベンゾン-6', 'benzophenone-6']),
  byType('別表第4の2', 'ジヒドロキシジメトキシベンゾフェノンジスルホン酸ナトリウム', 'Sodium dihydroxydimethoxybenzophenone disulfonate', [10, 10, B], ['オキシベンゾン-9', 'benzophenone-9']),
  byType('別表第4の2', 'ジヒドロキシベンゾフェノン', 'Dihydroxybenzophenone', [10, 10, B], ['オキシベンゾン-1', 'benzophenone-1']),
  byType('別表第4の2', 'ジメチコジエチルベンザルマロネート', 'Dimethicodiethyl-benzal malonate', [10, 10, 10], ['ジメチコジエチルベンザルマロネート', 'ポリシリコーン-15', 'polysilicone-15']),
  byType('別表第4の2', '１―（３，４―ジメトキシフェニル)―４，４―ジメチル―１，３―ペンタンジオン', '1-(3,4-dimethoxyphenyl)-4,4-dimethyl-1,3-pentanedione', [7.0, 7.0, B]),
  byType('別表第4の2', 'ジメトキシベンジリデンジオキソイミダゾリジンプロピオン酸２―エチルヘキシル', 'Dimethoxybenzylidenedioxo-imidazolidine 2-ethylhexyl propionate', [3.0, 3.0, B], ['ジメトキシベンジリデンジオキソイミダゾリジンプロピオン酸オクチル', 'ethylhexyl dimethoxybenzylidene dioxoimidazolidine propionate']),
  byType('別表第4の2', 'テトラヒドロキシベンゾフェノン', 'Tetrahydroxybenzophenone', [10, 10, 0.05], ['オキシベンゾン-2', 'benzophenone-2']),
  byType('別表第4の2', 'テレフタリリデンジカンフルスルホン酸', 'Terephthalylidene dicamphor sulfonic acid', [10, 10, B], ['テレフタリリデンジカンフルスルホン酸', 'terephthalylidene dicamphor sulfonic acid']),
  byType('別表第4の2', '２，４，６―トリス［４―（２―エチルヘキシルオキシカルボニル)アニリノ]―１，３，５―トリアジン', '2,4,6-Tris[4-(2-ethylhexyloxycarbonyl)anilino]-1,3,5-triazine', [5.0, 5.0, B], ['エチルヘキシルトリアゾン', 'ethylhexyl triazone']),
  byType('別表第4の2', 'トリメトキシケイ皮酸メチルビス（トリメチルシロキシ）シリルイソペンチル', 'Methylbis(trimethylsiloxy)silyl isopentyl trimethoxycinnamate', [7.5, 7.5, 2.5], ['トリメトキシケイ皮酸メチルビス（トリメチルシロキシ）シリルイソペンチル', 'トリメトキシケイヒ酸メチルビス（トリメチルシロキシ）シリルイソペンチル']),
  byType('別表第4の2', 'ドロメトリゾールトリシロキサン', 'Drometrizole trisiloxane', [15.0, 15.0, B], ['ドロメトリゾールトリシロキサン', 'drometrizole trisiloxane']),
  byType('別表第4の2', 'パラジメチルアミノ安息香酸アミル', 'Amyl p-dimethylaminobenzoate', [10, 10, B], ['パラジメチルアミノ安息香酸アミル']),
  byType('別表第4の2', 'パラジメチルアミノ安息香酸２―エチルヘキシル', '2-Ethylhexyl p-dimethylaminobenzoate', [10, 10, 7.0], ['ジメチルpabaエチルヘキシル', 'ethylhexyl dimethyl paba', 'padimate o']),
  byType('別表第4の2', 'パラメトキシケイ皮酸イソプロピル・ジイソプロピルケイ皮酸エステル混合物', 'Isopropyl p-methoxycinnamate and diisopropyl cinnamate ester mixture', [10, 10, B]),
  byType('別表第4の2', 'パラメトキシケイ皮酸２―エチルヘキシル', '2-Ethylhexyl p-methoxycinnamate', [20, 20, 8.0], ['パラメトキシケイ皮酸2-エチルヘキシル', 'メトキシケイヒ酸エチルヘキシル', 'ethylhexyl methoxycinnamate', 'octinoxate']),
  byType('別表第4の2', '２，４―ビス―［｛４―（２―エチルヘキシルオキシ)―２―ヒドロキシ｝―フェニル］―６―（４―メトキシフェニル)―１，３，５―トリアジン', '2,4-Bis-[{4-(2-ethylhexyloxy)-2-hydroxy}-phenyl]-6-(4-methoxyphenyl)-1,3,5-triazine', [3.0, 3.0, B], ['ビスエチルヘキシルオキシフェノールメトキシフェニルトリアジン', 'bis-ethylhexyloxyphenol methoxyphenyl triazine', 'bemotrizinol']),
  byType('別表第4の2', '２―ヒドロキシ―４―メトキシベンゾフェノン', '2-Hydroxy-4-methoxybenzophenone', [O, 5.0, 5.0], ['オキシベンゾン-3', 'オキシベンゾン', 'benzophenone-3', 'oxybenzone']),
  byType('別表第4の2', 'ヒドロキシメトキシベンゾフェノンスルホン酸及びその三水塩', 'Hydroxymethoxybenzophenone sulfonate and its trihydrate', [10, 10, 0.1], ['オキシベンゾン-4', 'benzophenone-4', 'sulisobenzone'], 'ヒドロキシメトキシベンゾフェノンスルホン酸としての合計量'),
  byType('別表第4の2', 'ヒドロキシメトキシベンゾフェノンスルホン酸ナトリウム', 'Sodium hydroxymethoxybenzophenone sulfonate', [10, 10, 1.0], ['オキシベンゾン-5', 'benzophenone-5']),
  byType('別表第4の2', 'フェニルベンズイミダゾールスルホン酸', 'Phenylbenzimidazole sulfonic acid', [3.0, 3.0, B], ['フェニルベンズイミダゾールスルホン酸', 'phenylbenzimidazole sulfonic acid', 'ensulizole']),
  byType('別表第4の2', 'フェルラ酸', 'Ferulic acid', [10, 10, B], ['フェルラ酸', 'ferulic acid']),
  byType('別表第4の2', '２，２’―メチレンビス（６―（２Ｈベンゾトリアゾール―２―イル)―４―（１，１，３，３―テトラメチルブチル)フェノール', "2,2'-methylenebis(6-(2H-benzotriazole-2-yl)-4-(1,1,3,3-tetramethylbutyl)phenol", [10.0, 10.0, B], ['メチレンビスベンゾトリアゾリルテトラメチルブチルフェノール', 'methylene bis-benzotriazolyl tetramethylbutylphenol', 'bisoctrizole']),
  byType('別表第4の2', '４―メトキシケイ皮酸 ２―メチルフェニル', '2-Methylphenyl 4-methoxycinnamate', [10.0, 10.0, B]),
];
