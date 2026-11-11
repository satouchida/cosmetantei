import { KnownIngredient } from '../types';
import { normalizeIngredientName } from '../utils/ingredient-name';

/**
 * 成分名の書き方（接尾辞・骨格・命名規則）から、成分の分類・注意の度合い・解説を決めるルール。
 * 成分DBに無い成分に使う。キャッシュ・通信は使わない（キャッシュと AI の解説は services/dynamic-ingredient-service.ts）
 */

/** 成分名の正規化（成分DBとの照合と同じもの） */
export const normalizeName = normalizeIngredientName;

/** EU で表示が義務付けられている香料アレルゲン（2003年からの26種のうち、成分DBに無いもの） */
const FRAGRANCE_ALLERGENS = [
  'ヘキシルシンナマル',
  'シトロネロール',
  'クマリン',
  'オイゲノール',
  'ファルネソール',
  '安息香酸ベンジル',
  'サリチル酸ベンジル',
  'ケイヒ酸ベンジル',
  'シンナマル',
  'ケイヒアルコール',
  'アミルシンナマル',
  'アミルシンナミルアルコール',
  'アニスアルコール',
  'ヒドロキシシトロネラール',
  'イソメチルイオノン',
  'オークモス',
  'ツリーモス',
  'hexylcinnamal',
  'citronellol',
  'coumarin',
  'eugenol',
  'farnesol',
  'benzylbenzoate',
  'benzylsalicylate',
  'benzylcinnamate',
  'cinnamal',
  'cinnamylalcohol',
  'amylcinnamal',
  'anisealcohol',
  'hydroxycitronellal',
  'isomethylionone',
  'oakmoss',
  'treemoss',
];

/** 水そのもの（植物の蒸留水・花水は含めない） */
const PLAIN_WATERS = [
  'イオン交換水',
  '精製水',
  '蒸留水',
  '常水',
  '純水',
  '水',
  'purifiedwater',
  'deionizedwater',
  'distilledwater',
  'water',
  'aqua',
  'eau',
];

/** 水そのものの名前だけでできているか（「水（精製水）」「Water/Aqua/Eau」も含む） */
function isPlainWater(norm: string): boolean {
  let rest = norm;
  for (const name of PLAIN_WATERS) rest = rest.split(name).join('');
  return rest.replace(/[,、]/g, '') === '' || norm.includes('温泉水') || norm.includes('深層水') || norm === '海水' || norm === '炭酸水';
}

/** 保湿剤の多価アルコール（正規化した名前に対して。ここに無いグリコール類は「未評価」） */
const POLYOL_NAME =
  /^(濃)?グリセリン$|^(ジ|ポリ)グリセリン(-?\d+)?$|^glycerin$|^(bg|dpg)$|^(1,?[23])?(ブチレン|ペンチレン|ヘキシレン|ジプロピレン|プロピレン)グリコール$|^(1,?[23])?(butylene|pentylene|hexylene|dipropylene|propylene)glycol$|プロパンジオール|propanediol|ペンタンジオール|pentanediol|ヘキサンジオール|hexanediol|^ポリエチレングリコール\d*$|^polyethyleneglycol\d*$/;

/** 天然保湿因子（NMF）にも含まれるアミノ酸・保湿成分（単独の名前のときだけ） */
const NMF_NAMES = [
  'ベタイン',
  'タウリン',
  'アラニン',
  'グリシン',
  'セリン',
  'プロリン',
  'トレオニン',
  'グルタミン酸',
  'グルタミン酸na',
  'アスパラギン酸na',
  'バリン',
  'ロイシン',
  'イソロイシン',
  'フェニルアラニン',
  'チロシン',
  'リシン',
  'リシンhcl',
  // 「HCl」を「HCI」と書く成分表示がある
  'リシンhci',
  'ヒスチジンhcl',
  'ヒスチジンhci',
  'アミノ酸',
  'pcana',
  '乳酸na',
  'betaine',
  'taurine',
  'alanine',
  'glycine',
  'serine',
  'proline',
  'sodiumpca',
  'sodiumlactate',
];

/** 無機の粉体・塩（紫外線散乱剤の酸化チタン・酸化亜鉛は成分DB） */
const MINERAL_NAMES = new Set([
  'シリカ',
  '含水シリカ',
  '無水ケイ酸',
  'マイカ',
  '合成金雲母',
  'タルク',
  '酸化鉄',
  '黄酸化鉄',
  '黒酸化鉄',
  'ベンガラ',
  '酸化セリウム',
  '窒化ホウ素',
  '水酸化al',
  '水酸化アルミニウム',
  '塩化na',
  '塩化ナトリウム',
  '硫酸mg',
  '硫酸マグネシウム',
  '炭酸水素na',
  '炭酸水素ナトリウム',
  'silica',
  'mica',
  'talc',
]);

/** 高級アルコール（セタノール等。エタノールのような乾燥させるアルコールではない） */
const FATTY_ALCOHOL =
  /^(セタノール|セチルアルコール|ステアリルアルコール|セテアリルアルコール|ベヘニルアルコール|バチルアルコール|イソステアリルアルコール|オレイルアルコール|c\d+アルコール|cetylalcohol|stearylalcohol|cetearylalcohol|behenylalcohol)$/;

/** 油性のエステル（エモリエント）。グリセリル・ソルビタン等のエステルは別のルール。酸そのもの（エチルヘキサン酸 等）は除く */
const EMOLLIENT_ESTER =
  /^2?エチルヘキサン酸(?=.)|^イソノナン酸(?=.)|^セバシン酸ジ|^コハク酸ジ|^リンゴ酸ジ|^炭酸ジ|^テトラエチルヘキサン酸(?=.)|^ジカプリン酸|^ジカプリル酸|^ジエチルヘキサン酸|^ネオペンタン酸(?=.)|^安息香酸アルキル|ジリノール酸|^カプリル酸カプリン酸/;

/** 植物の種や実の油脂（精油ではないもの） */
const CARRIER_OIL =
  /^(水添)?(シア脂|シアバター|オリーブ果実油|オリーブ油|オリブ油|アルガニアスピノサ核油|アルガンオイル|ヤシ油|パーム油|パーム核油|コメヌカ油|コメ胚芽油|カニナバラ果実油|ローズヒップ油|ヒマワリ種子油|アーモンド油|スイートアーモンド油|アボカド油|コーン油|トウモロコシ油|ツバキ種子油|ツバキ油|ブドウ種子油|カカオ脂|マンゴー種子脂|ダイズ油|メドウフォーム油|ヒマシ油|ゴマ油|サフラワー油|ナタネ油|アンズ核油|モモ核油|ククイナッツ油)$/;

/** 精油（葉・花・果皮などから取った香りの油）。成分DBの精油（ラベンダー・ティーツリー・柑橘の果皮油）が先 */
const ESSENTIAL_OIL =
  /(葉油|花油|果皮油|根油|樹皮油|木油|枝油|葉茎油|全草油|花芽油)$|^(オレンジ|レモン|ライム|ユズ|ハッカ|ペパーミント|ユーカリ|ティートリー|ローズ|ゼラニウム|マンダリン)油$/;

/** 糖・糖アルコール・多糖類の保湿成分 */
const SUGAR_NAMES = new Set([
  'トレハロース',
  'グリコシルトレハロース',
  '加水分解水添デンプン',
  'ソルビトール',
  'ソルビット',
  'マルチトール',
  'エリスリトール',
  'マンニトール',
  'キシリトール',
  'キシリット',
  'イノシトール',
  'マルトデキストリン',
  'デキストリン',
  '異性化糖',
  'αグルカン',
  'αグルカンオリゴサッカリド',
  'コーンスターチ',
  'ヒドロキシプロピルシクロデキストリン',
]);
const SUGAR_PATTERN = /^グリコシルトレハロース|多糖体$|^(ナットウ|ビオサッカリド)ガム\d*$/;

/** タンパク質由来の保湿成分（加水分解コムギは成分DB） */
const PROTEIN_MOISTURIZER = /^(水溶性|加水分解|可溶性|サクシノイルアテロ|アテロ)?(コラーゲン|エラスチン|シルク|プロテオグリカン)$/;

/** 肌の脂質に近い成分（ステロール・リン脂質・スフィンゴ脂質） */
const SKIN_LIPID =
  /^コレステロール|^(フィト|ダイズ)ステロール|フィトスフィンゴシン$|^スフィンゴ脂質$|^(水添|リゾ)?レシチン$|^(水添)?(大豆)?リン脂質$/;

/** 防腐剤・防腐を助ける成分（配合上限は化粧品基準が成分のカードに出す） */
const PRESERVATIVE_NAMES = new Set([
  'クロルフェネシン',
  '安息香酸',
  '安息香酸na',
  '安息香酸ナトリウム',
  '安息香酸塩',
  'カプリリルグリコール',
  'ヒドロキシアセトフェノン',
  'カプリルヒドロキサム酸',
  'アニス酸na',
  'レブリン酸na',
  'デヒドロ酢酸na',
  'ソルビン酸k',
  'chlorphenesin',
  'sodiumbenzoate',
  'caprylylglycol',
]);

/**
 * Layer 2: 化粧品化学・皮膚科学ルールベース動的推論エンジン
 * 接尾辞、骨格、命名規則から成分の役割・敏感肌向けアドバイス・リスク度を自動推論
 * （成分DB（KNOWN_INGREDIENTS）に一致しない成分だけに使う。DB の成分は出典と照合済み）
 */
export function generateIngredientExplanation(rawName: string): KnownIngredient {
  const norm = normalizeName(rawName);
  const id = `dyn_${norm || 'unknown'}`;
  const base = { id, nameJa: rawName, aliases: [rawName] };

  // 1. 香料アレルゲン（「サリチル酸ベンジル」をサリチル酸と取り違えないよう、ほかのルールより先に見る）
  if (FRAGRANCE_ALLERGENS.some((a) => norm.includes(a))) {
    return {
      ...base,
      nameEn: 'Fragrance Allergen',
      category: 'fragrance',
      riskLevel: 'moderate_irritant',
      reasonJa: '香りづけに使われる成分で、EUでは一定量以上を含む場合に成分名の表示が義務付けられている香料アレルゲンの一つです。',
      sensitiveSkinAdviceJa: '香料でかぶれた経験がある場合は注意が必要です。気になる場合は「無香料」の製品と比べてみてください。',
    };
  }

  // 2. 硫酸系・スルホン酸系の洗浄成分（「硫酸Mg」などの塩、「〜スルホン酸」の紫外線吸収剤は含めない）。
  //    「ラウリル硫酸TEA」「ポリオキシエチレンラウリルエーテル硫酸〜」をアルカリ剤・乳化剤のルールより先に判定する
  const isLaurylSulfate = norm.includes('ラウリル硫酸') || norm.includes('laurylsulfate');
  if (
    isLaurylSulfate ||
    // 日本語名はアルキル基が「硫酸」の前に付く。「硫酸Mg」「硫酸Na」（塩）や多糖の硫酸エステルは除く
    (/.硫酸/.test(norm) && !norm.startsWith('硫酸') && !/コンドロイチン|デキストラン|ケラタン|ヘパリン|フコイダン/.test(norm)) ||
    /(lauryl|laureth|myristyl|myreth|cetyl|cetearyl|coco|coceth|pareth|trideceth|tridecyl|decyl|octyl|alkyl|ethylhexyl)(ether)?\d*sulfate/.test(norm) ||
    /(オレフィン|アルキルベンゼン|ドデシルベンゼン).*スルホン酸|(olefin|benzene)sulfonate/.test(norm)
  ) {
    return {
      ...base,
      nameEn: 'Sulfate / Sulfonate Surfactant',
      category: 'sulfate',
      riskLevel: isLaurylSulfate ? 'high_irritant' : 'moderate_irritant',
      reasonJa: '脱脂力と起泡力の強い陰イオン界面活性剤です。皮脂や油分をしっかり落とします。',
      sensitiveSkinAdviceJa: '肌のうるおいを保つ脂質まで洗い流しやすく、乾燥・つっぱり・かゆみの原因になることがあります。敏感肌はアミノ酸系などの洗浄成分の製品と比べてみてください。',
    };
  }

  // 3. 水・温泉水・基剤
  if (isPlainWater(norm)) {
    return {
      ...base,
      nameEn: 'Water / Aqua',
      category: 'other',
      riskLevel: 'safe',
      reasonJa: '化粧品の大部分（基剤）を構成する水です。他の成分を溶解・均一に保ち、肌に水分を補給します。',
      sensitiveSkinAdviceJa: '水そのものが刺激やアレルギーの原因になることはほとんどありません。',
    };
  }

  // 4. 植物の蒸留水・花水（ローズ水、ハマメリス水など）
  if (
    (norm.endsWith('水') || norm.endsWith('water') || norm.includes('hydrosol')) &&
    !/過酸化|アンモニア|peroxide|ammonia/.test(norm)
  ) {
    return {
      ...base,
      nameEn: 'Botanical Water / Hydrosol',
      category: 'other',
      riskLevel: 'low_caution',
      reasonJa: '植物を水蒸気蒸留したときに得られる芳香蒸留水（花水）などで、植物の香りの成分を微量に含みます。',
      sensitiveSkinAdviceJa: '精油と同じ香りの成分を微量に含むため、香料や精油で肌荒れしやすい方は、気にしておくとよいでしょう。',
    };
  }

  // 5. 炭・泥・クレイ・吸着剤
  if (
    // 「炭酸〜」（炭酸水素Na など）は炭ではないため除外
    (norm.includes('炭') && !norm.includes('炭酸')) ||
    norm.includes('クレイ') ||
    norm.includes('カオリン') ||
    norm.includes('ベントナイト') ||
    norm.includes('海シルト') ||
    norm.includes('charcoal') ||
    norm.includes('clay')
  ) {
    return {
      ...base,
      nameEn: 'Charcoal / Mineral Clay',
      category: 'other',
      riskLevel: 'low_caution',
      reasonJa: '微細な多孔質構造を持ち、毛穴の余分な皮脂や汚れ、角栓を物理的に吸着して洗い流す清浄成分です。',
      sensitiveSkinAdviceJa: '皮脂吸着力が比較的高いため、乾燥肌や極度の敏感肌が毎日使うとつっぱり感を感じる場合があります。擦らず優しく洗い流してください。',
    };
  }

  // 6. セルロース・グルコマンナン・植物性スクラブ
  if (
    norm.includes('セルロース') ||
    norm.includes('グルコマンナン') ||
    norm.includes('コンニャク') ||
    norm.includes('cellulose') ||
    norm.includes('scrub')
  ) {
    return {
      ...base,
      nameEn: 'Cellulose / Natural Scrub',
      category: 'other',
      riskLevel: 'low_caution',
      reasonJa: '植物繊維由来のマイルドな粒子で、古い角質や毛穴汚れをやさしく絡め取るスクラブ・テクスチャー調整成分です。',
      sensitiveSkinAdviceJa: '化学合成プラスチックビーズよりも肌当たりは穏やかですが、肌のバリア機能が低下している時は擦りすぎないよう注意が必要です。',
    };
  }

  // 7. 乳化剤（PEG・ポリソルベートなど、エチレンオキシドを付加した非イオン界面活性剤）
  if (/^peg(ppg)?\d|ポリソルベート|polysorbate|^poe|ポリオキシエチレン|グルセス|グリセレス/.test(norm)) {
    return {
      ...base,
      nameEn: 'Nonionic Emulsifier (PEG / Polysorbate)',
      category: 'other',
      riskLevel: 'low_caution',
      reasonJa: '水と油を混ぜ合わせる乳化剤・可溶化剤です。界面活性剤の中では穏やかな部類です。',
      sensitiveSkinAdviceJa: '通常の配合量では刺激になりにくい成分ですが、肌荒れ中は洗い流さない製品に多く含まれるとしみることがあります。',
    };
  }

  // 8. 脂肪酸のエステル（グリセリル・ポリグリセリル・ソルビタン・ショ糖）
  // チオグリコール酸グリセリル等（パーマ液・除毛剤の還元剤。かぶれの原因になる）は脂肪酸エステルではないので「未評価」に残す
  if (
    /ポリグリセリル|グリセリル|グリセリン脂肪酸エステル|ソルビタン|ショ糖|スクロース|glyceryl|sorbitan|sucrose/.test(norm) &&
    !/チオグリコ|thioglycol|メルカプト|mercapto/.test(norm)
  ) {
    return {
      ...base,
      nameEn: 'Fatty Acid Ester (Emulsifier / Emollient)',
      category: 'other',
      riskLevel: 'safe',
      reasonJa: '脂肪酸とグリセリン・糖などを結合させた成分で、乳化剤や油性のエモリエント成分として使われます。',
      sensitiveSkinAdviceJa: '肌の脂質に近い成分から作られており、通常の配合量では刺激になりにくい成分です。',
    };
  }

  // 9. 高級脂肪酸（石けん原料・エモリエント）
  if (
    norm.includes('ミリスチン酸') ||
    norm.includes('ステアリン酸') ||
    norm.includes('パルミチン酸') ||
    norm.includes('ラウリン酸') ||
    norm.includes('オレイン酸') ||
    norm.includes('ベヘン酸')
  ) {
    const isLauric = norm.includes('ラウリン酸');
    return {
      ...base,
      nameEn: 'Fatty Acid (Soap Base / Emollient)',
      category: 'other',
      riskLevel: isLauric ? 'low_caution' : 'safe',
      reasonJa: '洗顔料や石けんの主原料となる脂肪酸です。アルカリ剤と反応してクリーミーで濃密な泡を形成し、汚れを落とします。',
      sensitiveSkinAdviceJa: isLauric
        ? 'ラウリン酸は泡立ちに優れますが、肌の脱脂力がやや強く、敏感肌にはつっぱり感の原因になることがあります。'
        : '皮脂膜を構成する脂肪酸に近く刺激性は低めですが、洗い流しを十分に行い肌に残さないことが大切です。',
    };
  }

  // 10. アルカリ剤・中和剤（石けん形成）
  if (
    norm.includes('水酸化k') ||
    norm.includes('水酸化カリウム') ||
    norm.includes('水酸化na') ||
    norm.includes('水酸化ナトリウム') ||
    // TEA（トリエタノールアミン）。「tea tree」などを誤って含めないよう完全一致で判定
    norm === 'tea' ||
    norm === 'triethanolamine' ||
    norm === 'トリエタノールアミン' ||
    norm.includes('アルギニン') ||
    norm.includes('potassiumhydroxide') ||
    norm.includes('sodiumhydroxide')
  ) {
    return {
      ...base,
      nameEn: 'Alkalizing / Neutralizing Agent',
      category: 'other',
      riskLevel: 'safe',
      reasonJa: 'pH調整剤および脂肪酸とケン化反応を起こして石けんを形成するためのアルカリ成分です。製品中では中和されて存在します。',
      sensitiveSkinAdviceJa: '製品のpHを調整するために配合され、最終製品中では中和されています。まれに肌に合わない場合があります。',
    };
  }

  // 11. 角質をやわらげる酸（AHA・PHA）。塩（グリコール酸アンモニウム等）も含める
  if (
    /^(グリコール酸|マンデル酸|ラクトビオン酸|グルコノラクトン|glycolicacid|mandelicacid|lactobionicacid|gluconolactone)/.test(norm)
  ) {
    return {
      ...base,
      nameEn: 'Exfoliating Acid (AHA / PHA)',
      category: 'potent_active',
      riskLevel: 'active_caution',
      reasonJa: '古い角質どうしの結びつきをゆるめて、ざらつきやくすみをやわらげる酸の成分です。',
      sensitiveSkinAdviceJa: '濃度や使う頻度によっては、赤み・ヒリつき・乾燥の原因になります。肌荒れ中は使用を控え、使うときは紫外線対策をしてください。',
    };
  }
  if (norm === '乳酸' || norm === 'lacticacid') {
    return {
      ...base,
      nameEn: 'Lactic Acid',
      category: 'other',
      riskLevel: 'low_caution',
      reasonJa: 'pHを整えるために少量配合されることが多い成分です。量が多い製品では、角質をやわらげる酸（AHA）として働きます。',
      sensitiveSkinAdviceJa: 'pH調整の量では刺激になりにくいですが、角質ケアをうたう製品では肌荒れ中にしみることがあります。',
    };
  }

  // 12. 多価アルコール・高保湿剤（グリセリン、BG、DPG、プロパンジオール等）。
  //     名前を限って判定する（「ジエチレングリコール」「チオグリコール酸〜」などを保湿剤にしない）
  if (norm.includes('エチルヘキシルグリセリン') || norm.includes('ethylhexylglycerin')) {
    return {
      ...base,
      nameEn: 'Ethylhexylglycerin',
      category: 'preservative',
      riskLevel: 'low_caution',
      reasonJa: '保湿のほか、防腐剤の働きを助ける目的で配合される成分です。',
      sensitiveSkinAdviceJa: '刺激になりにくい成分ですが、まれに接触アレルギーの報告があります。',
    };
  }
  if (POLYOL_NAME.test(norm)) {
    // PG・DPG（「ポリプロピレングリコール」は対象外）
    const isPropyleneGlycol = norm === 'dpg' || /^(ジ)?プロピレングリコール$|^(di)?propyleneglycol$/.test(norm);
    return {
      ...base,
      nameEn: 'Polyol / Humectant Base',
      category: 'moisturizer',
      riskLevel: isPropyleneGlycol ? 'low_caution' : 'safe',
      reasonJa: '角層に水分を抱え込み、うるおいを保つ代表的な多価アルコール系保湿成分です。化粧品のテクスチャーをしっとり整えます。',
      sensitiveSkinAdviceJa: isPropyleneGlycol
        ? 'プロピレングリコール類は、高濃度で配合された場合や肌荒れ中に、しみる・ピリピリするなどの刺激を感じることがあります。'
        : '肌への親和性が高く、刺激性は低いため、乾燥性敏感肌でも使いやすい基本の保湿成分です。',
    };
  }

  // 13. アミドプロピルベタイン（コカミドプロピルベタイン等）
  if (norm.includes('ミドプロピルベタイン') || norm.includes('ミドプロピルヒドロキシスルタイン') || norm.includes('amidopropylbetaine')) {
    return {
      ...base,
      nameEn: 'Amidopropyl Betaine (Amphoteric Surfactant)',
      category: 'other',
      riskLevel: 'low_caution',
      reasonJa: '泡立ちを助け、洗浄成分の刺激をやわらげるためにシャンプーや洗顔料に配合される両性界面活性剤です。',
      sensitiveSkinAdviceJa: '洗浄力は穏やかですが、原料に残る不純物による接触アレルギーの報告があります。洗い流す製品で、すすぎを十分に行えば問題になりにくい成分です。',
    };
  }

  // 14. アミド系・スルホコハク酸系の界面活性剤（コカミドDEA など）
  if (/コカミド|スルホコハク酸|sulfosuccinate|cocamide/.test(norm)) {
    return {
      ...base,
      nameEn: 'Amide / Sulfosuccinate Surfactant',
      category: 'other',
      riskLevel: 'low_caution',
      reasonJa: '泡立ちや洗浄力を高めるために、洗顔料やシャンプーに配合される界面活性剤です。',
      sensitiveSkinAdviceJa: '洗い流す製品で使われる成分ですが、肌荒れ中は刺激を感じることがあります。すすぎを十分にしてください。',
    };
  }

  // 15. アミノ酸系・ベタイン系のマイルドな界面活性剤
  if (
    norm.includes('ココイル') ||
    norm.includes('ラウロイル') ||
    norm.includes('ミリストイル') ||
    // ステアロイル〜は洗浄成分のものだけ（ステアロイルフィトスフィンゴシンはセラミド、ステアロイル乳酸Naは乳化剤）
    /ステアロイル(メチル)?タウリン|ステアロイルグルタミン酸/.test(norm) ||
    (norm.includes('ベタイン') && norm !== 'ベタイン')
  ) {
    return {
      ...base,
      nameEn: 'Mild Surfactant (Betaine / Amino Acid)',
      category: 'other',
      riskLevel: 'safe',
      reasonJa: '皮脂を取りすぎにくい、アミノ酸系・両性の比較的穏やかな洗浄成分（界面活性剤）です。キメ細やかな泡立ちを補助します。',
      sensitiveSkinAdviceJa: '硫酸系の洗浄成分よりバリア機能を壊しにくく、乾燥肌や敏感肌の洗顔料・シャンプーに多く使われます。',
    };
  }

  // 16. アミノ酸・天然保湿因子（ベタイン・タウリン・PCA-Na など）
  if (NMF_NAMES.includes(norm)) {
    return {
      ...base,
      nameEn: 'Amino Acid / Natural Moisturizing Factor',
      category: 'moisturizer',
      riskLevel: 'safe',
      reasonJa: '肌の天然保湿因子（NMF）にも含まれるアミノ酸などの保湿成分で、角層の水分を保ちます。',
      sensitiveSkinAdviceJa: 'もともと肌にある成分に近く、刺激になりにくい保湿成分です。',
    };
  }

  // 17. シリコーン・エモリエント油
  if (
    norm.includes('ジメチコン') ||
    norm.includes('シクロペンタシロキサン') ||
    norm.includes('メチコン') ||
    norm.includes('スクワラン') ||
    norm.includes('ホホバ') ||
    norm.includes('マカデミア') ||
    norm.includes('ミネラルオイル') ||
    norm.includes('ワセリン') ||
    norm.includes('トリエチルヘキサノイン') ||
    // シリコーン（シロキサン・シラン・シルセスキオキサン）
    // 「シロキ」だけで見ない（シロキクラゲはキノコ）
    norm.includes('シロキサン') ||
    // デシロキシ（デシル＋オキシ）はシリコーンではない
    /(?<!デ)シロキシ/.test(norm) ||
    (/シラン$|シラノール/.test(norm) && !norm.includes('オキシラン')) ||
    norm.includes('シルセスキオキサン') ||
    norm.includes('ポリシリコーン') ||
    // 炭化水素・ロウ
    // パラフィンスルホン酸Na などの洗浄成分は除く
    (norm.includes('パラフィン') && !/スルホン酸|硫酸|sulfon/.test(norm)) ||
    norm.includes('マイクロクリスタリンワックス') ||
    norm.includes('合成ワックス') ||
    norm.includes('ポリエチレンワックス') ||
    /^水添ポリ(イソブテン|デセン|ブテン|オレフィン)|^イソ(ヘキサデカン|ドデカン)$|オレフィンオリゴマー$|^オレフィンc\d+$/.test(norm) ||
    /^(サラシ)?ミツロウ$|^(キャンデリラ|カルナウバ)ロウ$/.test(norm)
  ) {
    return {
      ...base,
      nameEn: 'Emollient / Silicone Oil',
      category: 'barrier_support',
      riskLevel: 'safe',
      reasonJa: '肌表面に薄い保護ヴェールを形成し、水分の蒸発を防いで滑らかな感触を与えるエモリエント・保護成分です。',
      sensitiveSkinAdviceJa: '肌の表面をおおって水分の蒸発を防ぎます。植物由来の油脂・ロウは、まれに肌に合わない場合があります。',
    };
  }

  // 18. 高分子・増粘剤・ポリマー
  if (
    norm.includes('カルボマー') ||
    norm.includes('キサンタンガム') ||
    norm.includes('アクリレーツ') ||
    norm.includes('ポリマー') ||
    norm.includes('ペクチン') ||
    norm.includes('アルギン酸') ||
    norm.includes('共重合体') ||
    norm.includes('ポリビニルアルコール') ||
    norm.includes('ポリクオタニウム') ||
    norm === 'pvp'
  ) {
    return {
      ...base,
      nameEn: 'Thickener / Polymer',
      category: 'other',
      riskLevel: 'safe',
      reasonJa: '化粧水やジェルのとろみ・粘度を安定させ、肌に塗布した際の摩擦を軽減する高分子ポリマーです。',
      sensitiveSkinAdviceJa: '分子量が大きいため角層に浸透しにくく、刺激になりにくい成分とされています。肌に合わないと感じたときは使用を控えてください。',
    };
  }

  // 19. 酵素（プロテアーゼ・パパイン等）
  if (
    norm.includes('パパイン') ||
    norm.includes('プロテアーゼ') ||
    norm.includes('リパーゼ') ||
    norm.includes('スブチリシン') ||
    norm.includes('酵素') ||
    norm.includes('enzyme')
  ) {
    return {
      ...base,
      nameEn: 'Enzyme (Exfoliating / Cleansing)',
      category: 'potent_active',
      riskLevel: 'active_caution',
      reasonJa: '古い角質（タンパク質）や過剰な角栓（皮脂）を選択的に分解し、ざらつきやくすみをオフする酵素成分です。',
      sensitiveSkinAdviceJa: '古い角質を分解する性質があるため、肌がデリケートな時期や連日使用すると角層に負担がかかりヒリつきを感じる場合があります。週1〜2回程度を目安に、肌の様子を見ながら使うことが推奨されます。',
    };
  }

  // 20. キレート剤・酸化防止剤・pH調整剤
  if (
    norm.includes('edta') ||
    norm.includes('エチドロン酸') ||
    norm.includes('クエン酸') ||
    norm.includes('トコフェロール') ||
    norm.includes('ビタミンe') ||
    norm.includes('フィチン酸') ||
    norm.includes('エデト酸') ||
    norm.includes('ペンテト酸') ||
    norm === 'bht' ||
    norm === 'ジブチルヒドロキシトルエン' ||
    norm === 'トロメタミン' ||
    norm === 'ampd' ||
    norm === 'コハク酸' ||
    /^(メタ)?リン酸(水素)?\d?(na|k|ナトリウム|カリウム)$/.test(norm)
  ) {
    return {
      ...base,
      nameEn: 'Chelating / Antioxidant / Buffer',
      category: 'other',
      riskLevel: 'safe',
      reasonJa: '金属イオンを封じ込める・酸化を防ぐ・pHを整えるなどして、製品の品質を保つための成分です。',
      sensitiveSkinAdviceJa: '品質を保つために少量配合される成分で、一般的な配合量では刺激になりにくい成分です。',
    };
  }

  // 20b. 無機の粉体・塩
  if (MINERAL_NAMES.has(norm) || /ヘクトライト$|hectorite$/.test(norm)) {
    return {
      ...base,
      nameEn: 'Mineral Powder / Salt',
      category: 'other',
      riskLevel: 'safe',
      reasonJa: '使用感の調整・皮脂の吸着・色づけ・とろみの調整などに使われる、鉱物由来の粉体や塩です。',
      sensitiveSkinAdviceJa: '肌に吸収されにくく、通常の配合量では刺激になりにくい成分です。',
    };
  }

  // 20c. 高級アルコール
  if (FATTY_ALCOHOL.test(norm)) {
    return {
      ...base,
      nameEn: 'Fatty Alcohol (Emollient / Thickener)',
      category: 'other',
      riskLevel: 'safe',
      reasonJa: 'クリームや乳液の質感を整え、肌をやわらげる油性の成分です。名前に「アルコール」とありますが、エタノールのように肌を乾燥させる成分ではありません。',
      sensitiveSkinAdviceJa: '通常の配合量では刺激になりにくい成分です。',
    };
  }

  // 20d. 油性のエステル・植物の油脂
  if (EMOLLIENT_ESTER.test(norm) || CARRIER_OIL.test(norm)) {
    return {
      ...base,
      nameEn: 'Emollient Ester / Plant Oil',
      category: 'barrier_support',
      riskLevel: 'safe',
      reasonJa: '肌をやわらげ、水分の蒸発を防ぐ油性の成分（エステル油や、植物の種・実の油脂）です。',
      sensitiveSkinAdviceJa: '通常の配合量では刺激になりにくい成分です。植物の油脂は、その植物にアレルギーがある場合は避けてください。',
    };
  }

  // 20e. 精油（香りの成分）
  if (ESSENTIAL_OIL.test(norm)) {
    // 柑橘の果皮の精油は、成分DBの柑橘系果皮油（high_irritant）とそろえる（表示名の違いで評価を変えない）
    const isCitrus = /果皮油$|^(オレンジ|レモン|ライム|ユズ|マンダリン)油$|ベルガモット|グレープフルーツ|citrus/.test(norm);
    return {
      ...base,
      nameEn: 'Essential Oil',
      category: 'essential_oil',
      riskLevel: isCitrus ? 'high_irritant' : 'moderate_irritant',
      reasonJa: '植物の葉・花・果皮などから取った精油で、香りの成分を多く含みます。香料と同じように、かぶれ（接触アレルギー）の原因になることがあります。',
      sensitiveSkinAdviceJa: '香料や精油で肌荒れしたことがある場合は避けてください。柑橘の果皮の精油には、日光に当たると炎症を起こすもの（光毒性）があります。',
    };
  }

  // 20f. 糖・多糖類の保湿成分
  if (SUGAR_NAMES.has(norm) || SUGAR_PATTERN.test(norm)) {
    return {
      ...base,
      nameEn: 'Sugar / Polysaccharide Humectant',
      category: 'moisturizer',
      riskLevel: 'safe',
      reasonJa: '水分を抱え込んで肌のうるおいを保つ、糖や多糖類の保湿成分です。',
      sensitiveSkinAdviceJa: '刺激になりにくい保湿成分です。',
    };
  }

  // 20g. タンパク質由来の保湿成分
  if (PROTEIN_MOISTURIZER.test(norm)) {
    return {
      ...base,
      nameEn: 'Protein-Derived Humectant',
      category: 'moisturizer',
      riskLevel: 'low_caution',
      reasonJa: 'コラーゲン・エラスチン・シルクなどのタンパク質から作られた保湿成分です。',
      sensitiveSkinAdviceJa: '刺激になりにくい成分ですが、加水分解したタンパク質は、まれにアレルギーの原因になります（加水分解コムギの例があります）。',
    };
  }

  // 20h. 肌の脂質に近い成分
  if (SKIN_LIPID.test(norm)) {
    return {
      ...base,
      nameEn: 'Skin-Identical Lipid (Sterol / Phospholipid)',
      category: 'barrier_support',
      riskLevel: 'safe',
      reasonJa: 'コレステロール・リン脂質など、肌のバリアを作る脂質に近い成分で、うるおいを保ちます。乳化を助ける目的でも使われます。',
      sensitiveSkinAdviceJa: '肌にもともとある成分に近く、刺激になりにくい成分です。',
    };
  }

  // 20i. 防腐剤・防腐を助ける成分
  if (PRESERVATIVE_NAMES.has(norm)) {
    return {
      ...base,
      nameEn: 'Preservative / Preservative Booster',
      category: 'preservative',
      riskLevel: 'low_caution',
      reasonJa: '製品に菌やカビが増えるのを防ぐ成分、またはその働きを助ける成分です。',
      sensitiveSkinAdviceJa: '決められた量の範囲では刺激になりにくい成分ですが、肌荒れ中は刺激を感じることがあります。',
    };
  }

  // 20j. 尿素
  if (norm === '尿素' || norm === 'urea') {
    return {
      ...base,
      nameEn: 'Urea',
      category: 'moisturizer',
      riskLevel: 'low_caution',
      reasonJa: '肌の天然保湿因子（NMF）にも含まれる保湿成分です。濃度が高いと、硬くなった角質をやわらげる働きもあります。',
      sensitiveSkinAdviceJa: '肌荒れ中や傷のある肌では、しみることがあります。',
    };
  }

  // 21. 植物エキス・発酵液
  if (
    norm.includes('エキス') ||
    norm.includes('発酵') ||
    norm.includes('extract') ||
    norm.includes('filtrate')
  ) {
    return {
      ...base,
      nameEn: 'Botanical Extract / Ferment',
      category: 'other',
      riskLevel: 'low_caution',
      reasonJa: '保湿や肌を整える目的で配合される、植物・発酵由来の成分です。',
      sensitiveSkinAdviceJa: '天然由来成分ですが、植物固有の成分に対して稀にアレルギー反応を起こす体質の方もいます。初めて使う際は、腕の内側などで試してから使うことをおすすめします。',
    };
  }

  // 22. 一般フォールバック：どのルールにも該当しない成分は「未評価」とし、安全とは断定しない
  return {
    ...base,
    nameEn: rawName,
    category: 'other',
    riskLevel: 'unknown',
    reasonJa: 'この成分はコスメ探偵の成分データに登録がなく、刺激性を評価できていません。',
    sensitiveSkinAdviceJa: '刺激性や肌との相性を判断できないため、気になる場合は「AIでさらに詳しく調べる」で確認するか、腕の内側などの目立たない部分で試してから使用してください。',
  };
}
