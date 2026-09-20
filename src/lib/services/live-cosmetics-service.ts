import { Product } from '../types';
import { addProductToDynamicCache, COSMETICS_DATABASE } from '../data/cosmetics-db';
import { buildAmazonAffiliateUrl } from './amazon-affiliate';
import { GEMINI_API_KEY, GEMINI_MODEL } from './gemini';

/**
 * 検索文字列の正規化（全角半角・大文字小文字・不要記号の統一）
 */
export function normalizeSearchString(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-_・/\\,.]+/g, '')
    .trim();
}

/**
 * ユーザー入力が「挨拶」や「サービスへの一般的な相談・質問」であるかを判定
 */
export function isGreetingOrConsultation(text: string): boolean {
  if (!text) return false;
  const clean = text.replace(/\u3000/g, ' ').trim().toLowerCase();

  // 単に化粧品名やブランド名が含まれている場合は挨拶ではない
  const hasCosmeticIndicator = /(化粧水|乳液|クリーム|洗顔|美容液|リップ|下地|日焼け止め|バーム|セラム)/i.test(clean);
  if (hasCosmeticIndicator) {
    return false;
  }

  // 挨拶フレーズ
  const greetings = /^(こんにちは|こんばんは|おはよう|はじめまして|初めまして|お疲れ様|おつかれ|hello|hi|hey)[\s!！?？〜~]*$/i;
  if (greetings.test(clean)) return true;

  // 一般的な相談・目的質問フレーズ
  const consultationQuestions =
    /(何ができる|使い方|どう使えばいい|教えて|相談|肌荒れした|肌が荒れた|助けて|どうすればいい|何から始めればいい|ここはどこ|サービス内容)/i;
  if (consultationQuestions.test(clean)) return true;

  return false;
}

/**
 * 挨拶や相談に対する、サービスの目的説明とコスメ名入力促進メッセージ
 */
export function getServicePurposeExplanation(userQuery?: string): string {
  return `こんにちは！コスメ探偵（CosmeTantei）へようこそ。

当サービスは、あなたが「肌荒れを起こしてしまった化粧品」と「普段問題なく使えている安全な化粧品」の全成分を比較・差分分析し、肌トラブルの真の原因成分（香料、エタノール、特定の防腐剤や紫外線吸収剤など）をあぶり出すサービスです。

【使い方】
1. まず、最近肌荒れした化粧品や、現在お使いのコスメ名（例: 「キュレル 泡洗顔料」「ちふれ 口紅」など）をメッセージに入力してください。
2. カメラでバーコードをスキャンして登録することも可能です。
3. 実在するコスメ候補が表示されたら、「肌荒れした」または「安全に使えている」に追加して差分分析を実行してください。

まずは、肌荒れした化粧品名やお使いのコスメ名を入力するか、下の実在コスメ候補から選んでみてください！`;
}

/**
 * 非コスメのGoogle検索クエリ・ノイズワードの判定
 */
export function isNonCosmeticSearchQuery(text: string): boolean {
  if (!text) return true;
  const clean = text.toLowerCase().trim();

  // 一般的なWeb検索ワード・ノイズ・疑問文・非コスメ名
  const nonCosmeticPattern =
    /(株価|配当|年収|会長|社長|役員|歴史|求人|バイト|採用|会社概要|株式会社|本社|工場|cm\s*女優|cm\s*俳優|モデル|芸能人|誰|どなた|店舗|どこで買える|売ってない|どこに売ってる|取扱店|販売店|売り場|ドラッグストア|薬局|通販|amazon|楽天|ショップ|ストア|公式|メルカリ|フリマ|治し方|原因|食べ物|サプリ|病院|皮膚科|病気|病名|治療|市販薬|処方薬|ステロイド|順番|タイミング|どっち|違い|比較|選び方|塗り方|使い方|使用方法|落とし方|洗い方|朝と夜|塗る順番|口コミ|評判|レビュー|ブログ|アットコスメ|知恵袋|評価|ランキング|おすすめ|人気色|オワコン|ステマ|効果|効かない|効く|荒れる|荒れた|落ちない|崩れる|毛穴落ち|モロモロ|ブルベ|イエベ|パーソナルカラー|色選び|似てる|ジェネリック|代用|類似|危険性|発がん|副作用|安全性|英語|意味|とは|wiki|wikipedia|無料|プレゼント|懸賞|いくら|定価|値段|安く|セール|クーポン|落とし穴|リップル|リップス|暗号資産|仮想通貨|ヘアサロン|美容室|メンズ.*おすすめ|高校生|中学生|小学生|年代|年齢層|どうやって|どれがいい|少ない|多い|ない|すみしょう|かずのすけ|youtuber|youtube)/i;

  if (nonCosmeticPattern.test(clean)) {
    return true;
  }

  // 検索サジェストで末尾や語間に単なる肌悩み・検索単語が付いているだけの非製品クエリ
  // 例: 「炭 洗顔 敏感 肌」「泡洗顔 角栓」「泡洗顔 炭酸泡」
  const querySuffixPattern =
    /[\s\-_・/](少ない|多い|すみしょう|かずのすけ|角栓|黒ずみ|いちご鼻|テカリ|皮脂|敏感\s*肌|乾燥\s*肌|脂性\s*肌|混合\s*肌|ニキビ|赤み|炭酸\s*泡|炭酸\s*洗顔|毛穴汚れ)$/i;

  if (querySuffixPattern.test(clean)) {
    return true;
  }

  // 単一の抽象語やカテゴリ名単体のみ（例: 「リップ」「洗顔」「ちふれ」単体で商品名がないもの）
  const bareCategories =
    /^(リップ|口紅|洗顔|化粧水|乳液|クリーム|美容液|日焼け止め|ファンデーション|コスメ|スキンケア)$/;
  if (bareCategories.test(clean)) {
    return true;
  }

  return false;
}

/**
 * 実際の化粧品製品名（コスメ・スキンケア・メイクアイテム）であるかの厳格判定
 * - 架空のブランド名やプレースホルダーは厳格に除外
 * - 単なる検索クエリや疑問文、架空テンプレートは厳格に除外
 */
export function isActualCosmeticProduct(p: Product | string): boolean {
  const text = typeof p === 'string' ? p : `${p.brand} ${p.name}`;
  if (!text) return false;

  // 1. ノイズワードが含まれていれば即NG
  if (isNonCosmeticSearchQuery(text)) return false;

  if (typeof p !== 'string') {
    if (isNonCosmeticSearchQuery(p.name) || isNonCosmeticSearchQuery(p.brand)) {
      return false;
    }

    // 架空ブランド・プレースホルダーの厳格除外
    const FAKE_BRANDS =
      /^(注目コスメ|注目スキンケア|薬用スキンケア|低刺激ラボ|酵素洗顔|ディープクリア|バーコード照合|ブランド未記載|未記載|モイストリップ|プランプケア|カラーケア|無添加ラボ)$/i;
    if (FAKE_BRANDS.test(p.brand.trim())) {
      return false;
    }

    // 架空製品名・テンプレート名・アイテム連番の厳格除外
    const FAKE_NAMES =
      /(炭＆植物スクラブ|薬用 炭クレイ スクラブ|ディープクリア 炭スクラブ|低刺激 炭スクラブ|酵素＆炭スクラブ|アイテム\d+|アイテム \d+)/i;
    if (FAKE_NAMES.test(p.name)) {
      return false;
    }

    // ブランド名と商品名が同一で、かつ単なる一般カテゴリ名の場合
    if (p.brand === p.name && /^(洗顔|化粧水|乳液|クリーム|美容液|リップ|日焼け止め)$/i.test(p.name)) {
      return false;
    }
  }

  // 2. 単一カテゴリのみの場合もNG
  const bareQuery = text.trim().toLowerCase();
  if (
    /^(リップ|口紅|洗顔|化粧水|乳液|クリーム|美容液|日焼け止め|ファンデーション|コスメ|スキンケア)$/.test(
      bareQuery
    )
  ) {
    return false;
  }

  // 3. 単なる一般的なカテゴリ・成分・肌悩み単語の組み合わせのみで構成されている場合は検索クエリと判定
  const genericWords =
    /^(泡|炭|炭酸|炭酸泡|炭酸洗顔|洗顔|泡洗顔|スクラブ|スクラブ洗顔|敏感|肌|敏感肌|乾燥|乾燥肌|保湿|高保湿|低刺激|薬用|クレンジング|メイク落とし|リップ|口紅|化粧水|乳液|クリーム|美容液|日焼け止め|毛穴|角栓|黒ずみ|泥|クレイ|酵素|男|メンズ|女性|子供|人気|おすすめ|市販|プチプラ)$/i;

  const parts = bareQuery.split(/[\s\-_・/]+/);
  if (parts.length > 0 && parts.every((pt) => genericWords.test(pt))) {
    return false;
  }

  // 4. 化粧品カテゴリー、剤形、または実在コスメ製品シリーズ名が含まれていること
  const cosmeticSignature =
    /(化粧水|ローション|トナー|スキン|乳液|ミルク|エマルジョン|クリーム|フェイスクリーム|バーム|美容液|セラム|エッセンス|アンプル|オイル|パック|マスク|シートマスク|ジェル|洗顔|泡洗顔|洗顔料|洗顔フォーム|クレンジング|メイク落とし|石鹸|せっけん|スクラブ|日焼け止め|日やけ止め|uv|サンプロテクト|サンクリーム|下地|化粧下地|ファンデーション|ファンデ|bbクリーム|ccクリーム|コンシーラー|パウダー|おしろい|リップ|口紅|ルージュ|ティント|リップバーム|リップクリーム|リップグロス|リッププランパー|アイシャドウ|マスカラ|アイライナー|アイブロウ|眉マスカラ|チーク|ハイライト|シェーディング|ネイル|モンスター|メラノcc|シカプラスト|パーフェクトホイップ|クリアフル|白潤|極潤|オバジc|ダイブイン|リードルショット)/i;

  if (cosmeticSignature.test(text)) {
    return true;
  }

  return false;
}

/**
 * 有名コスメブランド一覧（クエリ解析およびブランド名抽出用）
 */
export const KNOWN_BRANDS: { match: RegExp; name: string }[] = [
  { match: /ちふれ|chifure/i, name: 'ちふれ' },
  { match: /キュレル|curel/i, name: 'キュレル' },
  { match: /ケイト|kate/i, name: 'KATE' },
  { match: /イハダ|ihada/i, name: 'イハダ' },
  { match: /無印良品|無印|muji/i, name: '無印良品' },
  { match: /オルビス|orbis/i, name: 'オルビス' },
  { match: /ミノン|minon/i, name: 'ミノン' },
  { match: /ラロッシュポゼ|la\s*roche/i, name: 'ラロッシュポゼ' },
  { match: /ファンケル|fancl/i, name: 'ファンケル' },
  { match: /資生堂|shiseido/i, name: '資生堂' },
  { match: /カネボウ|kanebo/i, name: 'カネボウ' },
  { match: /コーセー|kose/i, name: 'コーセー' },
  { match: /メラノcc|melano/i, name: 'メラノCC (ロート製薬)' },
  { match: /肌ラボ|hadalabo/i, name: '肌ラボ (ロート製薬)' },
  { match: /オバジ|obagi/i, name: 'オバジ (Obagi)' },
  { match: /ロート製薬|rohto/i, name: 'ロート製薬' },
  { match: /ロゼット|rosette/i, name: 'ロゼット' },
  { match: /カウブランド|牛乳石鹸|cow/i, name: 'カウブランド' },
  { match: /ソフティモ|softymo/i, name: 'ソフティモ' },
  { match: /ダヴ|dove/i, name: 'ダヴ (Dove)' },
  { match: /なめらか本舗|サナ|sana/i, name: 'なめらか本舗 (SANA)' },
  { match: /毛穴撫子|石澤研究所/i, name: '毛穴撫子 (石澤研究所)' },
  { match: /クレンジングリサーチ|aha/i, name: 'クレンジングリサーチ' },
  { match: /サボン|sabon/i, name: 'SABON' },
  { match: /トリデン|torriden/i, name: 'トリデン' },
  { match: /アヌア|anua/i, name: 'Anua (アヌア)' },
  { match: /vtコスメ|vt/i, name: 'VTコスメティクス' },
  { match: /セラヴィ|cerave/i, name: 'セラヴィ' },
  { match: /セタフィル|cetaphil/i, name: 'セタフィル' },
  { match: /カルテhd|carte/i, name: 'カルテHD' },
  { match: /キャンメイク|canmake/i, name: 'キャンメイク' },
  { match: /セザンヌ|cezanne/i, name: 'セザンヌ' },
  { match: /エテュセ|ettusais/i, name: 'エテュセ' },
  { match: /イプサ|ipsa/i, name: 'イプサ' },
  { match: /コスメデコルテ|decorte/i, name: 'コスメデコルテ' },
  { match: /ニベア|nivea/i, name: 'ニベア' },
  { match: /専科|senka/i, name: '洗顔専科' },
  { match: /ビオレ|biore/i, name: 'ビオレ' },
  { match: /メディヒール|mediheal/i, name: 'メディヒール' },
  { match: /魔女工場|manyo/i, name: '魔女工場' },
  { match: /イニスフリー|innisfree/i, name: 'イニスフリー' },
  { match: /ロムアンド|rom&nd/i, name: 'ロムアンド' },
  { match: /クリオ|clio/i, name: 'クリオ' },
  { match: /ダルバ|d'alba/i, name: "d'Alba (ダルバ)" },
  { match: /the\s*ordinary|ジオーディナリー/i, name: 'The Ordinary' },
];

/**
 * 【実在する代表的コスメデータ】
 * 日本・海外で広く流通している100%実在の市販化粧品（正式なブランド名・商品名・実際の成分）
 * オフライン時や標準探索のグラウンディング基準として活用
 */
export const AUTHENTIC_POPULAR_COSMETICS: Product[] = [
  {
    id: 'auth_chifure_lipstick',
    name: '口紅 (詰替用)',
    brand: 'ちふれ',
    country: 'JP',
    category: 'lip',
    ingredients: ['ヒマシ油', 'オクチルドデカノール', 'トリエチルヘキサノイン', 'パラフィン', 'マイクロクリスタリンワックス', 'ミツロウ', 'ヒアルロン酸Na', 'トコフェロール'],
    descriptionJa: 'しっとりうるおうヒアルロン酸配合のロングセラー口紅。',
    amazonSearchUrl: buildAmazonAffiliateUrl('ちふれ', '口紅'),
    fragranceFree: true,
    alcoholFree: true,
  },
  {
    id: 'auth_curel_foaming_wash',
    name: '潤浸保湿 泡洗顔料',
    brand: 'キュレル',
    country: 'JP',
    category: 'cleanser',
    isQuasiDrug: true,
    activeIngredientsJa: ['グリチルリチン酸2K'],
    ingredients: ['グリチルリチン酸2K', '精製水', 'グリセリン', 'ラウロイルアスパラギン酸Na液', 'マルチトール液', 'ラウリルヒドロキシスルホベタイン液', 'PG', 'PEG6000', 'ヤシ油脂肪酸アシルグルタミン酸Na', 'ステアリン酸POEソルビタン', 'パラベン'],
    descriptionJa: '肌の必須成分「セラミド」を守って洗い、肌荒れを防ぐ消炎剤配合の薬用泡洗顔料。',
    amazonSearchUrl: buildAmazonAffiliateUrl('キュレル', '潤浸保湿 泡洗顔料'),
    fragranceFree: true,
    alcoholFree: true,
  },
  {
    id: 'auth_fancl_deep_clear_powder',
    name: 'ディープクリア 洗顔パウダー (炭・酵素・泥)',
    brand: 'ファンケル',
    country: 'JP',
    category: 'cleanser',
    ingredients: ['炭', 'プロテアーゼ', 'ヒアルロン酸Na', 'ラウロイルグルタミン酸Na', 'パルミチン酸K', 'マンニトール', 'ミリスチン酸K', 'ヒドロキシプロピルメチルセルロース', 'プルラン', 'ケイ酸(Al/Mg)'],
    descriptionJa: '炭とクレイ（泥）、酵素のトリプル処方で毛穴の黒ずみ・角栓をすっきり落とす個包装パウダー洗顔。',
    amazonSearchUrl: buildAmazonAffiliateUrl('ファンケル', 'ディープクリア 洗顔パウダー'),
    fragranceFree: true,
    alcoholFree: true,
  },
  {
    id: 'auth_rosette_kaidei_smooth',
    name: '洗顔パスタ 海泥スムース (毛穴・角栓スクラブ)',
    brand: 'ロゼット',
    country: 'JP',
    category: 'cleanser',
    ingredients: ['水', 'ミリスチン酸K', 'ステアリン酸K', 'グリセリン', 'ステアリン酸', 'DPG', '海シルト (海泥)', '含水ケイ酸', 'ラウリン酸K', 'ノイバラ果実エキス', 'BG'],
    descriptionJa: '海泥（クレイ）を含んだもっちり濃密泡で毛穴汚れや古い角質を吸着オフする洗顔フォーム。',
    amazonSearchUrl: buildAmazonAffiliateUrl('ロゼット', '洗顔パスタ 海泥スムース'),
    fragranceFree: true,
    alcoholFree: true,
  },
  {
    id: 'auth_kate_lip_monster',
    name: 'リップモンスター',
    brand: 'KATE',
    country: 'JP',
    category: 'lip',
    ingredients: ['ジカプリン酸ネオペンチルグリコール', 'トリエチルヘキサノイン', 'ビスアルキル(C16-18)グリセリルウンデシルジメチコン', 'リンゴ酸ジイソステアリル', 'マイクロクリスタリンワックス', 'パラフィン', 'トコフェロール'],
    descriptionJa: '唇から蒸発する水分を活用して密着ジェル膜を形成し、つけたての色が持続する人気リップ。',
    amazonSearchUrl: buildAmazonAffiliateUrl('KATE', 'リップモンスター'),
    fragranceFree: true,
    alcoholFree: true,
  },
  {
    id: 'auth_torriden_dive_in_serum',
    name: 'ダイブイン セラム (5重ヒアルロン酸)',
    brand: 'トリデン',
    country: 'KR',
    category: 'serum',
    ingredients: ['水', 'BG', 'グリセリン', 'DPG', '1,2-ヘキサンジオール', 'ヒアルロン酸Na', 'ヒアルロン酸クロスポリマーNa', '加水分解ヒアルロン酸', 'ヒアルロン酸', '加水分解ヒアルロン酸Na', 'パンテノール', 'アラントイン', 'ツボクサエキス'],
    descriptionJa: '分子サイズの異なる5種のヒアルロン酸が角層深く浸透し、べたつかずうるおいを与える低刺激セラム。',
    amazonSearchUrl: buildAmazonAffiliateUrl('トリデン', 'ダイブイン セラム'),
    fragranceFree: true,
    alcoholFree: true,
  },
  {
    id: 'auth_cerave_moisturizing_cream',
    name: 'モイスチャライジングクリーム',
    brand: 'セラヴィ (CeraVe)',
    country: 'US',
    category: 'cream',
    ingredients: ['水', 'グリセリン', 'セテアリルアルコール', 'トリ(カプリル酸/カプリン酸)グリセリル', 'セタノール', 'セテアレス-20', 'ワセリン', 'ジメチコン', 'セラミドNP', 'セラミドAP', 'セラミドEOP', 'フィトスフィンゴシン', 'コレステロール', 'ヒアルロン酸Na'],
    descriptionJa: '3種の必須ヒト型セラミドとヒアルロン酸を配合し、肌のバリア機能を修復・長時間保湿する皮膚科医推奨クリーム。',
    amazonSearchUrl: buildAmazonAffiliateUrl('CeraVe', 'Moisturizing Cream'),
    fragranceFree: true,
    alcoholFree: true,
  },
  {
    id: 'auth_melano_cc_premium_serum',
    name: '薬用しみ集中対策 プレミアム美容液',
    brand: 'メラノCC (ロート製薬)',
    country: 'JP',
    category: 'serum',
    isQuasiDrug: true,
    activeIngredientsJa: ['アスコルビン酸 (活性型ビタミンC)', 'ピリドキシン塩酸塩 (ビタミンB6)', 'アラントイン', 'イソプロピルメチルフェノール'],
    ingredients: ['アスコルビン酸', 'ピリドキシン塩酸塩', 'アラントイン', 'イソプロピルメチルフェノール', '3-O-エチルアスコルビン酸', 'L-アスコルビン酸2-グルコシド', 'ビタミンCテトライソパルミテート', 'トコフェロール酢酸エステル', 'BG', 'エタノール'],
    descriptionJa: 'ピュアビタミンCとビタミンB6、殺菌成分・抗炎症成分を配合した集中ケア美容液。',
    amazonSearchUrl: buildAmazonAffiliateUrl('メラノCC', 'プレミアム美容液'),
  },
  {
    id: 'auth_ihada_medicated_lotion',
    name: '薬用ローション (とてもしっとり)',
    brand: 'イハダ',
    country: 'JP',
    category: 'toner',
    isQuasiDrug: true,
    activeIngredientsJa: ['アラントイン', 'グリチルリチン酸2K'],
    ingredients: ['アラントイン', 'グリチルリチン酸2K', '精製水', '濃グリセリン', '1,3-ブチレングリコール', 'ジプロピレングリコール', 'ポリオキシエチレン(14)ポリオキシプロピレン(7)ジメチルエーテル', 'ポリオキシエチレンメチルグルコシド', 'ワセリン'],
    descriptionJa: '高精製ワセリン配合でうるおいバリアを形成し、肌荒れ・乾燥を防ぐ低刺激薬用化粧水。',
    amazonSearchUrl: buildAmazonAffiliateUrl('イハダ', '薬用ローション'),
    fragranceFree: true,
    alcoholFree: true,
  },
  {
    id: 'auth_muji_sensitive_toner_high_moist',
    name: '敏感肌用化粧水 高保湿タイプ',
    brand: '無印良品',
    country: 'JP',
    category: 'toner',
    ingredients: ['水', 'DPG', 'グリセリン', 'PEG-32', 'グリコシルトレハロース', '加水分解水添デンプン', 'スベリヒユエキス', 'ポリクオタニウム-51', 'グレープフルーツ種子エキス', 'ヒアルロン酸Na', 'アラントイン', 'BG', 'フェノキシエタノール'],
    descriptionJa: '岩手県釜石の天然水を使用した、デリケートな肌のための無香料・無着色・アルコールフリー化粧水。',
    amazonSearchUrl: buildAmazonAffiliateUrl('無印良品', '敏感肌用化粧水 高保湿タイプ'),
    fragranceFree: true,
    alcoholFree: true,
  },
  {
    id: 'auth_laroche_cicaplast_b5',
    name: 'シカプラスト リペアクリーム B5+',
    brand: 'ラロッシュポゼ',
    country: 'EU',
    category: 'cream',
    ingredients: ['水', '水添ポリイソブテン', 'ジメチコン', 'グリセリン', 'シア脂', 'パンテノール', 'プロパンジオール', 'BG', 'オクテニルコハク酸トウモロコシデンプンAl', 'ツボクサ葉エキス', 'マデカッソシド', 'グルコン酸亜鉛', 'グルコン酸マンガン', 'グルコン酸銅'],
    descriptionJa: 'パンテノール5%とCICA成分（マデカッソシド）を配合し、肌荒れや乾燥ダメージを速攻ケアする保湿バーム。',
    amazonSearchUrl: buildAmazonAffiliateUrl('ラロッシュポゼ', 'シカプラスト リペアクリーム B5+'),
    fragranceFree: true,
    alcoholFree: true,
  },
  {
    id: 'auth_anua_heartleaf_77_toner',
    name: 'ドクダミ 77% スージングトナー',
    brand: 'Anua (アヌア)',
    country: 'KR',
    category: 'toner',
    ingredients: ['ドクダミエキス (77%)', '水', '1,2-ヘキサンジオール', 'グリセリン', 'ベタイン', 'パンテノール', 'サトウキビエキス', 'ツボクサエキス', 'カミツレ花エキス', 'イタドリ根エキス', 'オウゴン根エキス', 'チャ葉エキス', 'カンゾウ根エキス'],
    descriptionJa: 'ドクダミエキス77%配合で敏感になった肌の赤みや肌荒れを穏やかに整える弱酸性トナー。',
    amazonSearchUrl: buildAmazonAffiliateUrl('Anua', 'ドクダミ 77 スージングトナー'),
    fragranceFree: true,
    alcoholFree: true,
  },
];

/**
 * ユーザーの入力意図の自動判定
 */
export function detectQueryIntent(query: string): {
  type: 'greeting_or_consult' | 'skin_concern' | 'category' | 'ingredient' | 'brand' | 'product_search' | 'general';
  key?: string;
  expandedQuery?: string;
} {
  const clean = query.replace(/\u3000/g, ' ').trim();
  if (!clean) {
    return { type: 'greeting_or_consult' };
  }

  if (isGreetingOrConsultation(clean)) {
    return { type: 'greeting_or_consult' };
  }

  // 1. ブランド名照合
  const brandMatch = KNOWN_BRANDS.find((b) => b.match.test(clean));
  if (brandMatch) {
    return { type: 'brand', key: brandMatch.name, expandedQuery: `${clean} コスメ` };
  }

  // 2. 肌トラブル・お悩み
  if (/乾燥|カサつき|かさつき|つっぱり|粉ふき|皮むけ/i.test(clean)) {
    return { type: 'skin_concern', key: 'dryness', expandedQuery: `${clean} スキンケア` };
  }
  if (/ニキビ|吹き出物|コメド|アクネ/i.test(clean)) {
    return { type: 'skin_concern', key: 'acne', expandedQuery: `${clean} 洗顔` };
  }
  if (/赤み|赤ら顔|ヒリヒリ|ピリピリ|しみる|敏感|酒さ|痒い|かゆみ|肌荒れ|荒れ/i.test(clean)) {
    return { type: 'skin_concern', key: 'redness', expandedQuery: `${clean} 低刺激 スキンケア` };
  }
  if (/毛穴|黒ずみ|角栓|テカリ|皮脂/i.test(clean)) {
    return { type: 'skin_concern', key: 'pores', expandedQuery: `${clean} 洗顔 美容液` };
  }
  if (/日焼け|紫外線|uv/i.test(clean)) {
    return { type: 'skin_concern', key: 'sunburn', expandedQuery: `${clean} 日焼け止め` };
  }

  // 3. 成分名
  if (/レチノール|ビタミンa/i.test(clean)) {
    return { type: 'ingredient', key: 'retinol', expandedQuery: `${clean} 美容液` };
  }
  if (/セラミド/i.test(clean)) {
    return { type: 'ingredient', key: 'ceramide', expandedQuery: `${clean} 保湿` };
  }
  if (/ビタミンc|アスコルビン/i.test(clean)) {
    return { type: 'ingredient', key: 'vitaminc', expandedQuery: `${clean} 美容液` };
  }
  if (/cica|シカ|ツボクサ/i.test(clean)) {
    return { type: 'ingredient', key: 'cica', expandedQuery: `${clean} スキンケア` };
  }

  // 4. カテゴリ
  if (/リップ|口紅|ルージュ|ティント|バーム|lip/i.test(clean)) {
    return { type: 'category', key: 'lip', expandedQuery: `${clean} コスメ` };
  }
  if (/化粧水|ローション|トナー|lotion|toner/i.test(clean)) {
    return { type: 'category', key: 'toner', expandedQuery: `${clean} 化粧品` };
  }
  if (/洗顔|クレンジング|ウォッシュ|soap|cleanser/i.test(clean)) {
    return { type: 'category', key: 'cleanser', expandedQuery: `${clean} コスメ` };
  }
  if (/クリーム|乳液|ミルク|cream/i.test(clean)) {
    return { type: 'category', key: 'cream', expandedQuery: `${clean} スキンケア` };
  }
  if (/美容液|セラム|エッセンス|serum/i.test(clean)) {
    return { type: 'category', key: 'serum', expandedQuery: `${clean} 美容液` };
  }
  if (/日焼け止め|日やけ止め|sunscreen/i.test(clean)) {
    return { type: 'category', key: 'sunscreen', expandedQuery: `${clean} 日焼け止め` };
  }

  // 複数単語または2文字以上のコスメ検索
  if (clean.length >= 2) {
    return { type: 'product_search', expandedQuery: `${clean} コスメ` };
  }

  return { type: 'general', expandedQuery: `${clean} コスメ` };
}

/**
 * 1. Open Beauty Facts API から実在コスメを検索
 */
export async function searchOpenBeautyFacts(query: string, limit = 4): Promise<Product[]> {
  const clean = query.replace(/\u3000/g, ' ').trim();
  if (!clean || isGreetingOrConsultation(clean) || isNonCosmeticSearchQuery(clean)) return [];

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const url = `https://world.openbeautyfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(
      clean
    )}&search_simple=1&action=process&json=1&page_size=${limit}`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'CosmeTantei/1.0 (https://cosmetantei.com; contact@cosmetantei.com)',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    if (!res.ok) return [];

    const data = await res.json();
    if (!data.products || !Array.isArray(data.products) || data.products.length === 0) {
      return [];
    }

    const results: Product[] = [];

    for (const p of data.products) {
      const name = p.product_name_ja || p.product_name || p.product_name_en;
      if (!name) continue;

      const brand = p.brands || p.brand;
      if (!brand || brand.trim().length === 0) continue;

      const barcode = p.code || undefined;

      let ingredients: string[] = [];
      if (p.ingredients_text_ja) {
        ingredients = p.ingredients_text_ja
          .split(/[,、・\n\r/]/)
          .map((s: string) => s.trim())
          .filter(Boolean);
      } else if (p.ingredients_text) {
        ingredients = p.ingredients_text
          .split(/[,、・\n\r/]/)
          .map((s: string) => s.trim())
          .filter(Boolean);
      }

      const product: Product = {
        id: `obf_${barcode || Math.random().toString(36).substring(2, 9)}`,
        name,
        brand,
        country: 'JP',
        category: 'other',
        barcode,
        ingredients: ingredients.length > 0 ? ingredients : ['成分情報はオンラインマーケットプレイスより探索'],
        descriptionJa: p.generic_name_ja || p.generic_name || `${brand}のコスメアイテム`,
        amazonSearchUrl: buildAmazonAffiliateUrl(brand, name),
        isEstimatedFromMarketplaces: true,
      };

      if (isActualCosmeticProduct(product)) {
        addProductToDynamicCache(product);
        results.push(product);
      }
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * 2. Gemini 3.8 Flash + Google Search Grounding（実在する市販コスメのWeb検索）
 * 架空商品や抽象名詞を厳格に排除し、市場に実在する正規コスメのみを特定
 */
export async function searchGoogleGroundedGemini(query: string, limit = 4): Promise<Product[]> {
  const clean = query.replace(/\u3000/g, ' ').trim();
  if (
    !clean ||
    isGreetingOrConsultation(clean) ||
    isNonCosmeticSearchQuery(clean)
  ) {
    return [];
  }

  // APIキー未設定またはモックキーの場合：実在代表コスメから合致するものを返却
  if (
    !GEMINI_API_KEY ||
    GEMINI_API_KEY.includes('YOUR_GEMINI_API_KEY') ||
    GEMINI_API_KEY.startsWith('AIzaSy_YOUR')
  ) {
    const norm = normalizeSearchString(clean);
    return AUTHENTIC_POPULAR_COSMETICS.filter((p) => {
      const b = normalizeSearchString(p.brand);
      const n = normalizeSearchString(p.name);
      return b.includes(norm) || n.includes(norm) || norm.includes(b) || (clean.includes('洗顔') && p.category === 'cleanser') || (clean.includes('リップ') && p.category === 'lip');
    }).slice(0, limit);
  }

  const prompt = `あなたは日本および各国の化粧品市場に精通したコスメ・スキンケア専門リサーチャーです。
ユーザーが「${clean}」に関連する化粧品を探しています。

【絶対遵守の厳格ルール】
1. 必ず日本または海外で現在市販されている「実在する化粧品製品」のみを最大${limit}件特定してください。
2. 架空の製品、想像上の製品、一般名詞のみの名前（例: 「炭洗顔フォーム」「濃密泡洗顔」など）は絶対に出力しないでください。
3. 必ず実在する正式なブランド名・発売元（例: 「ロゼット」「FANCL」「Bioré」「マンダム」「ちふれ」「キュレル」等）と、正確な製品名を記載してください。
4. 全成分（ingredients）も、その実在製品の公式パッケージや公式サイトに掲載されている実際の全成分リスト（または公表主要成分）を記載してください。適当な推測成分は出力しないでください。
5. 太字(**)やイタリック(*)などのMarkdown強調記法は絶対に含めないでください。

以下のJSON配列形式のみを出力してください（Markdownコードブロックは不要です）：
[
  {
    "name": "実在する正確な製品名",
    "brand": "実在する正式なブランド名",
    "country": "JP",
    "category": "cleanser | toner | serum | cream | sunscreen | mask | lip | other",
    "ingredients": ["実際の全成分1", "実際の全成分2"],
    "descriptionJa": "製品の簡単な特徴（太字なし）"
  }
]`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        GEMINI_MODEL
      )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ googleSearch: {} }],
          generationConfig: { temperature: 0.1 },
        }),
      }
    );

    if (!response.ok) return [];

    const resJson = await response.json();
    const candidateText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) return [];

    const jsonMatch = candidateText.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed) || parsed.length === 0) return [];

    const groundedProducts: Product[] = [];
    for (const item of parsed) {
      if (!item.name || !item.brand) continue;

      const product: Product = {
        id: `gem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        name: item.name,
        brand: item.brand,
        country: item.country || 'JP',
        category: item.category || 'other',
        ingredients: Array.isArray(item.ingredients) && item.ingredients.length > 0
          ? item.ingredients
          : ['成分情報はオンライン公開情報より探索'],
        descriptionJa: item.descriptionJa || `${item.brand} - ${item.name}`,
        amazonSearchUrl: buildAmazonAffiliateUrl(item.brand, item.name),
        isEstimatedFromMarketplaces: true,
      };

      if (isActualCosmeticProduct(product)) {
        addProductToDynamicCache(product);
        groundedProducts.push(product);
      }
    }

    return groundedProducts;
  } catch {
    return [];
  }
}

/**
 * 3. 実在するコスメ候補のみを検索・特定して返却するメインエンジン
 * 架空商品の生成は一切行わず、実在する正規コスメのみを返却
 */
export async function searchCosmeticsLive(query: string, limit = 6): Promise<Product[]> {
  const clean = query ? query.replace(/\u3000/g, ' ').trim() : '';

  const collected: Product[] = [];

  // 1. 空入力または挨拶・相談の場合：実在する代表的コスメを提示
  if (!clean || isGreetingOrConsultation(clean)) {
    const cachedCosmetics = COSMETICS_DATABASE.filter(isActualCosmeticProduct);
    for (const c of cachedCosmetics) {
      if (collected.length >= limit) break;
      if (!collected.some((p) => p.id === c.id || p.name === c.name)) {
        collected.push(c);
      }
    }

    for (const auth of AUTHENTIC_POPULAR_COSMETICS) {
      if (collected.length >= limit) break;
      if (!collected.some((p) => p.name === auth.name && p.brand === auth.brand)) {
        collected.push(auth);
      }
    }

    return collected.slice(0, limit);
  }

  // 2. 通常の検索語の場合
  const intent = detectQueryIntent(clean);
  const cacheNorm = normalizeSearchString(clean);

  // A. 動的ランタイムキャッシュ（過去に取得した実在データ）から探索
  const cachedMatches = COSMETICS_DATABASE.filter((p) => {
    if (!isActualCosmeticProduct(p)) return false;
    const b = normalizeSearchString(p.brand);
    const n = normalizeSearchString(p.name);
    return (b && b.includes(cacheNorm)) || (n && n.includes(cacheNorm)) || (b && cacheNorm.includes(b));
  });

  for (const m of cachedMatches) {
    if (!collected.some((c) => c.id === m.id || c.name === m.name)) {
      collected.push(m);
    }
  }

  // B. 実在する代表的コスメ（AUTHENTIC_POPULAR_COSMETICS）から照合
  const authMatches = AUTHENTIC_POPULAR_COSMETICS.filter((p) => {
    const b = normalizeSearchString(p.brand);
    const n = normalizeSearchString(p.name);
    const d = normalizeSearchString(p.descriptionJa || '');
    const cat = p.category;

    // 直接的なブランド・商品名・説明文一致
    if (b.includes(cacheNorm) || n.includes(cacheNorm) || cacheNorm.includes(b) || d.includes(cacheNorm)) {
      return true;
    }

    // カテゴリ一致
    if (
      (clean.includes('洗顔') && cat === 'cleanser') ||
      (clean.includes('リップ') && cat === 'lip') ||
      (clean.includes('化粧水') && cat === 'toner') ||
      (clean.includes('クリーム') && cat === 'cream') ||
      (clean.includes('美容液') && cat === 'serum') ||
      (clean.includes('日焼け止め') && cat === 'sunscreen')
    ) {
      return true;
    }

    // 肌悩み一致
    if (intent.type === 'skin_concern') {
      if (intent.key === 'dryness' && (cat === 'cream' || cat === 'toner' || d.includes('保湿') || d.includes('乾燥') || n.includes('保湿'))) return true;
      if (intent.key === 'acne' && (cat === 'cleanser' || d.includes('アクネ') || d.includes('肌荒れ') || d.includes('ニキビ'))) return true;
      if (intent.key === 'redness' && (n.includes('敏感') || d.includes('赤み') || d.includes('敏感') || d.includes('cica') || d.includes('ドクダミ') || d.includes('肌荒れ') || d.includes('低刺激') || d.includes('消炎'))) return true;
      if (intent.key === 'pores' && (d.includes('毛穴') || d.includes('角栓') || d.includes('炭') || d.includes('泥') || n.includes('毛穴'))) return true;
    }

    // 成分一致
    if (intent.type === 'ingredient') {
      if (intent.key === 'ceramide' && (d.includes('セラミド') || p.ingredients.some(i => i.includes('セラミド')) || n.includes('セラミド'))) return true;
      if (intent.key === 'vitaminc' && (d.includes('ビタミンc') || p.ingredients.some(i => i.includes('アスコルビン')) || n.includes('ビタミンc') || n.includes('メラノcc'))) return true;
      if (intent.key === 'cica' && (d.includes('cica') || d.includes('ツボクサ') || p.ingredients.some(i => i.includes('ツボクサ')) || n.includes('シカ'))) return true;
      if (intent.key === 'retinol' && (cat === 'serum' || cat === 'cream')) return true;
    }

    return false;
  });

  for (const a of authMatches) {
    if (collected.length >= limit) break;
    if (!collected.some((c) => c.name === a.name && c.brand === a.brand)) {
      collected.push(a);
    }
  }

  // C. Open Beauty Facts API（世界規模の実在コスメデータベース）
  if (collected.length < limit) {
    const obfResults = await searchOpenBeautyFacts(clean, limit);
    for (const o of obfResults) {
      if (isActualCosmeticProduct(o) && !collected.some((c) => c.id === o.id || c.name === o.name)) {
        collected.push(o);
      }
    }
  }

  // D. 意図判定による拡張クエリでの Open Beauty Facts 試行
  if (collected.length < limit && intent.expandedQuery && intent.expandedQuery !== clean) {
    const obfExpanded = await searchOpenBeautyFacts(intent.expandedQuery, limit);
    for (const o of obfExpanded) {
      if (isActualCosmeticProduct(o) && !collected.some((c) => c.id === o.id || c.name === o.name)) {
        collected.push(o);
      }
    }
  }

  // E. Gemini 3.8 Flash Google Search Grounding（実在市販コスメのWeb特定）
  if (collected.length < limit) {
    const googleResults = await searchGoogleGroundedGemini(clean, Math.min(limit, 4));
    for (const gr of googleResults) {
      if (isActualCosmeticProduct(gr) && !collected.some((c) => c.id === gr.id || c.name === gr.name)) {
        collected.push(gr);
      }
    }
  }

  // F. 1文字入力や一般的な入力で件数が不足する場合、実在代表コスメから補完
  if (collected.length < limit) {
    for (const a of AUTHENTIC_POPULAR_COSMETICS) {
      if (collected.length >= limit) break;
      if (!collected.some((c) => c.name === a.name && c.brand === a.brand)) {
        collected.push(a);
      }
    }
  }

  // F. 厳格フィルター（実在コスメのみを確実に保証）
  const validProducts = collected.filter(isActualCosmeticProduct);

  // 重要：架空商品の合成・捏造は一切行わない。実在商品のみを返す。
  return validProducts.slice(0, limit);
}

/**
 * 4. 実在コスメからのフォールバック抽出（テスト互換用）
 * 架空商品の捏造は完全撤廃し、実在コスメ一覧から最も関連度の高い正規製品を返却
 */
export function synthesizeDynamicCandidate(query: string, variationIndex = 0): Product {
  const clean = query.replace(/\u3000/g, ' ').trim();
  const norm = normalizeSearchString(clean);

  // 1. 実在コスメからキーワード一致を探索
  const matched = AUTHENTIC_POPULAR_COSMETICS.filter((p) => {
    const b = normalizeSearchString(p.brand);
    const n = normalizeSearchString(p.name);
    return b.includes(norm) || n.includes(norm) || norm.includes(b);
  });

  if (matched.length > 0) {
    return matched[variationIndex % matched.length];
  }

  // 2. カテゴリ一致を探索
  const catMatched = AUTHENTIC_POPULAR_COSMETICS.filter((p) => {
    if (clean.includes('洗顔') && p.category === 'cleanser') return true;
    if (clean.includes('リップ') && p.category === 'lip') return true;
    if (clean.includes('化粧水') && p.category === 'toner') return true;
    if (clean.includes('クリーム') && p.category === 'cream') return true;
    if (clean.includes('美容液') && p.category === 'serum') return true;
    return false;
  });

  if (catMatched.length > 0) {
    return catMatched[variationIndex % catMatched.length];
  }

  // 3. デフォルトの実在コスメ（キュレル泡洗顔料）
  return AUTHENTIC_POPULAR_COSMETICS[1];
}
