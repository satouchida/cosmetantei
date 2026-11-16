import { isKnownGenericTerm } from './brand-check';

/** 検索語の分け方（挨拶・相談、コスメ以外の検索、一般名詞、入力の意図）。どの検索にも使う */

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
export function getServicePurposeExplanation(): string {
  return `こんにちは！コスメ探偵（CosmeTantei）へようこそ。

当サービスは、あなたが「肌荒れを起こしてしまった化粧品」と「問題なく使えている化粧品」の全成分を比較・差分分析し、肌トラブルの引き金になった可能性のある成分の候補（香料、エタノール、一部の防腐剤や紫外線吸収剤など）を絞り込むサービスです。

【使い方】
1. まず、最近肌荒れした化粧品や、現在お使いのコスメ名（例: 「キュレル 泡洗顔料」「ちふれ 口紅」など）をメッセージに入力してください。
2. カメラでバーコードをスキャンして登録することも可能です。
3. 実在するコスメ候補が表示されたら、「肌荒れした」または「使えている」に追加して「肌荒れの原因候補を調べる」を押してください。

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
    /(株価|配当|年収|会長|社長|役員|歴史|求人|バイト|採用|会社概要|株式会社|本社|工場|cm\s*女優|cm\s*俳優|モデル|芸能人|誰|どなた|店舗|どこで買える|売ってない|どこに売ってる|取扱店|販売店|売り場|ドラッグストア|薬局|通販|amazon|楽天|ショップ|ストア|公式|メルカリ|フリマ|治し方|原因|食べ物|サプリ|病院|皮膚科|病気|病名|治療|市販薬|処方薬|ステロイド|順番|タイミング|どっち|違い|比較|選び方|塗り方|使い方|使用方法|落とし方|洗い方|朝と夜|塗る順番|口コミ|評判|レビュー|ブログ|アットコスメ|知恵袋|評価|ランキング|おすすめ|人気色|オワコン|ステマ|効果|効かない|効く|荒れる|荒れた|落ちない|崩れる|毛穴落ち|モロモロ|ブルベ|イエベ|パーソナルカラー|色選び|似てる|ジェネリック|代用|類似|危険性|発がん|副作用|安全性|英語|意味|とは|wiki|wikipedia|無料|プレゼント|懸賞|いくら|定価|値段|安く|セール|クーポン|落とし穴|リップル|リップス(?![ティク])|暗号資産|仮想通貨|ヘアサロン|美容室|メンズ.*おすすめ|高校生|中学生|小学生|年代|年齢層|どうやって|どれがいい|少ない|多い|ない|すみしょう|かずのすけ|youtuber|youtube)/i;

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
 * 化粧品の一般名詞であるかの同期判定（語彙チェック＋判定済みブランドのキャッシュ）
 * ブランド判定の本体は brand-check.ts の judgeBrands（非同期）
 */
export function isGenericCosmeticTerm(text: string): boolean {
  return isKnownGenericTerm(text);
}

/**
 * ユーザーの入力意図の自動判定
 * - 特定ブランドの静的一覧を持たず、入力文字列と自然言語パターンから動的に判定
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

  // 1. 肌トラブル・お悩み
  if (/乾燥|カサつき|かさつき|つっぱり|粉ふき|皮むけ/i.test(clean)) {
    return { type: 'skin_concern', key: 'dryness', expandedQuery: `${clean} 保湿 スキンケア` };
  }
  if (/ニキビ|吹き出物|コメド|アクネ/i.test(clean)) {
    return { type: 'skin_concern', key: 'acne', expandedQuery: `${clean} 洗顔料` };
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

  // 2. 成分名
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

  // 3. カテゴリ
  // ファンデーションは、ティント・バーム・ローションなどの語を名前に含むことがあるので先に見る
  if (/ファンデ|(?<![a-z])(bb|cc) ?(クリーム|cream)|foundation/i.test(clean)) {
    return { type: 'category', key: 'foundation', expandedQuery: `${clean} ファンデーション` };
  }
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
