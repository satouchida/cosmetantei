export type CountryOrigin = 'JP' | 'KR' | 'US' | 'EU';

export type IngredientRiskLevel = 
  | 'safe'            // 🟢 低刺激・安心成分
  | 'low_caution'     // 🟡 軽度の注意（個人差あり）
  | 'moderate_irritant'// 🟠 敏感肌には刺激になりやすい
  | 'high_irritant'   // 🔴 高リスクアレルゲン等
  | 'active_caution'  // 🟣 高濃度アクティブ成分（併用・バリア機能低下時に注意）
  | 'unknown';        // ⚪ 未評価（既知DB・推論ルールに該当せず、安全性を判断できない）

export const INGREDIENT_RISK_LEVELS: IngredientRiskLevel[] = [
  'safe',
  'low_caution',
  'moderate_irritant',
  'high_irritant',
  'active_caution',
  'unknown',
];

export type IngredientCategory = 
  | 'fragrance'          // 合成香料
  | 'essential_oil'      // 精油・植物エキス系アレルゲン
  | 'drying_alcohol'     // 乾燥性アルコール・揮発性成分
  | 'sulfate'            // 強力な陰イオン界面活性剤
  | 'preservative'       // 防腐剤・抗菌剤
  | 'uv_filter'          // 紫外線吸収剤
  | 'potent_active'      // レチノール・ピーリング酸・高濃度VC
  | 'soothing'           // 抗炎症・鎮静成分（CICA、アラントイン等）
  | 'barrier_support'    // バリア修復（セラミド、コレステロール等）
  | 'moisturizer'        // 保湿成分（ヒアルロン酸、グリセリン等）
  | 'other';

export interface KnownIngredient {
  id: string;
  nameJa: string;
  nameEn: string;
  aliases: string[];
  category: IngredientCategory;
  riskLevel: IngredientRiskLevel;
  reasonJa: string;
  sensitiveSkinAdviceJa: string;
  /** 記述の根拠（規制・安全性評価・論文）。成分DB（ingredients-db.ts）の項目では必須 */
  sources?: ReferenceLink[];
  /** 記述を出典と照合した日（YYYY-MM-DD）。成分DBの項目では必須 */
  reviewedAt?: string;
  /** AI の評価・解説の根拠の種類（AI が書いたもの。id が ai_ の項目だけ） */
  evidenceJa?: string;
}

export interface ReferenceLink {
  title: string;
  url: string;
}

/**
 * 全成分データの出所
 * - open_beauty_facts: Open Beauty Facts に登録された成分表示
 * - user_label: ユーザーがパッケージから入力した成分表示
 * - web_page: Web 検索で見つけたページ（ブランド公式・販売店）の成分表示を Gemini が読み取ったもの。
 *   読み取ったページの URL を sourceUrl に持つ
 * - ai_estimate: Gemini による推定。おすすめ代替品には使わない
 * - shop_listing: 楽天市場の商品説明（出品者が書いた文）から読み取った成分表示（src/lib/services/shop-ingredients.ts）。
 *   楽天の規約で保存できないので、その返答にだけ使う（共有のキャッシュ・ブラウザの保存・書き出しに入れない）。
 *   確認済みとはしない（代わりの商品に使わない）
 */
export type IngredientSource = 'open_beauty_facts' | 'user_label' | 'web_page' | 'ai_estimate' | 'shop_listing';

/** お店の商品検索の製品の id の頭（src/lib/services/shop-lineup.ts が付け、候補のカードが見分ける） */
export const SHOP_ID_PREFIX = 'shop_';

export interface Product {
  id: string;
  name: string;
  brand: string;
  country: CountryOrigin;
  category: 'cleanser' | 'toner' | 'serum' | 'cream' | 'sunscreen' | 'mask' | 'lip' | 'other';
  barcode?: string;
  imageUrl?: string;
  isQuasiDrug?: boolean; // 医薬部外品
  activeIngredientsJa?: string[]; // 医薬部外品の有効成分
  ingredients: string[]; // 全成分リスト（医薬部外品は有効成分以外の「その他の成分」）
  /** 医薬部外品の「他 n成分」（企業秘密として名称が表示されていない成分の数） */
  undisclosedIngredientCount?: number;
  /** 成分表示を読み取った方式の版（label-parser の LABEL_FORMAT）。古い分け方で保存された製品を見分ける */
  labelFormat?: number;
  /** 英語（INCI 名）の全成分表示を日本語の名前に訳したときの元の一覧（ingredient-translate） */
  ingredientsEn?: string[];
  fullIngredientsRaw?: string;
  descriptionJa?: string;
  fragranceFree?: boolean;
  alcoholFree?: boolean; // エタノールフリー
  amazonSearchUrl?: string; // Amazonアフィリエイトリンク
  isEstimatedFromMarketplaces?: boolean; // Amazon/Sephora/Olive Young/Rakuten等のオンライン情報から補完
  ingredientSource?: IngredientSource;
  /** 製品情報・成分表示の出典ページ（ingredientSource が web_page のとき） */
  sourceUrl?: string;
  /** お店の商品検索の製品の価格（API が返したまま。保存しない） */
  shopPrice?: { yen: number; taxIncluded: boolean | null };
  /** お店の商品検索の製品の商品ページ。アフィリエイト ID が設定されていればアフィリエイトリンク（sponsored） */
  shopLink?: { href: string; sponsored: boolean };
  /**
   * false: 信頼するサイト（src/lib/data/trusted-sites.ts）ではないページから読んだ製品。調べた本人にだけ返し、
   * 共有のキャッシュに入れない。画面に「ほかのサイトの情報」と出す（表示だけに使い、サーバーは信用しない）
   */
  sharedSource?: false;
}

export interface AnalyzedIngredient {
  rawName: string;
  normalizedJa: string;
  matchedKnown?: KnownIngredient;
  riskLevel: IngredientRiskLevel;
  isSuspect: boolean;
  category: IngredientCategory;
  reasonJa?: string;
  /** 医薬部外品の有効成分として表示されている */
  isActive?: boolean;
  /** 日本の化粧品基準（別表）に載っている成分の、配合の禁止・上限（化粧品のみ。医薬部外品には付けない） */
  jpStandard?: { table: string; textJa: string; notAllowedHere: boolean; referenceUrl: string };
  /** 表示指定成分（医薬部外品で名前の表示が義務付けられている成分。平成12年厚生省告示第332号） */
  jpDesignated?: { nameJa: string; textJa: string; references: ReferenceLink[] };
  /** 小麦由来の成分（「（小麦由来）」の注記、または名前に小麦・コムギ・wheat が入る） */
  wheatDerived?: boolean;
  /** 成分DBとルールで評価できず、AI が評価した（誤りを含みうる） */
  aiEvaluated?: boolean;
  /** 「AIでさらに詳しく調べる」で AI の解説を付けた（ブラウザだけで付ける） */
  aiExplained?: boolean;
}

export interface ProductAnalysisResult {
  product: Product;
  ingredients: AnalyzedIngredient[];
  riskCounts: {
    safe: number;
    low_caution: number;
    moderate_irritant: number;
    high_irritant: number;
    active_caution: number;
    unknown: number;
  };
  overallRiskLevel: 'safe' | 'caution' | 'warning' | 'insufficient_data'; // insufficient_data: 評価できる成分データが不足
  summaryJa: string;
  warningsJa: string[];
  soothingHighlightsJa: string[];
  safeAlternatives?: Product[]; // 刺激成分を含まないおすすめ代替品
  /** 成分表示の読み方の注意（医薬部外品の記載順・非表示の成分） */
  labelNotesJa?: string[];
  /** 成分表示の読み方の出典（医薬部外品の名称リスト・表示の基本方針） */
  labelReferences?: ReferenceLink[];
  isEstimatedFromMarketplaces?: boolean;
  dataSourceDisclaimer?: string;
  /** 未評価の成分を AI で評価し直した結果（もう一度 AI に頼まない） */
  aiEvaluation?: { evaluatedCount: number };
}

export interface CulpritIngredient {
  nameJa: string;
  nameEn: string;
  riskLevel: IngredientRiskLevel;
  category: IngredientCategory;
  reasonJa: string;
  foundInProducts: string[];
  absenceConfirmedInSafeCount: number;
}

/** 製品をまたぐ組み合わせの注意（pair-rules.ts） */
export interface PairFinding {
  id: 'retinoid_with_salicylic' | 'exfoliant_overlap' | 'fragrance_overlap';
  titleJa: string;
  textJa: string;
  /** 当てはまる製品名 */
  products: string[];
  /** 当てはまる成分（成分表示の名前） */
  ingredients: string[];
  sources: ReferenceLink[];
}

/** 今使っている製品の組み合わせチェックの結果 */
export interface CurrentUseCheckResult {
  /** 調べた製品名 */
  productNames: string[];
  findings: PairFinding[];
  /** 3か月以上前に追加した製品の名前（ブラウザが付ける。サーバーは追加した日を知らない） */
  staleProductNames?: string[];
}

export interface DifferentialAnalysisResult {
  badProducts: Product[];
  safeProducts: Product[];
  culprits: CulpritIngredient[];
  /** 肌荒れした製品を一緒に使っていた場合の、組み合わせの注意 */
  pairFindings?: PairFinding[];
  sharedIngredients: string[];
  summaryJa: string;
  adviceJa: string[];
  safeAlternatives: Product[]; // 疑わしい成分を含まない安心のAmazonおすすめ商品
}

/** 販売ページで確認した価格（T4。キャッシュしない） */
export interface PriceOffer {
  /** 販売している店（楽天・Yahoo! の出店者名など） */
  shop: string;
  /** モールの名前（楽天市場・Yahoo!ショッピング・@cosme SHOPPING） */
  marketplace: string;
  productName: string;
  priceYen: number;
  /** 税込と書かれていれば true、税抜なら false、書かれていなければ null */
  taxIncluded: boolean | null;
  /** 価格を確かめた商品ページ */
  sourceUrl: string;
  /** 開くリンク。アフィリエイト ID が設定されていればアフィリエイトリンク */
  href: string;
  /** href がアフィリエイトリンクか（PR 表示・rel="sponsored"） */
  sponsored: boolean;
}

/** 価格の取得に使った API（API の利用規約で、表示にクレジットが必要） */
export type PriceApiCredit = 'rakuten' | 'yahoo';

export interface PriceResult {
  productQuery: string;
  /** unavailable: 検索・ページの読み取りに失敗した（「価格が無い」とは区別する） */
  status: 'ok' | 'unavailable';
  /** 安い順。確認できた価格が無ければ空 */
  offers: PriceOffer[];
  /** 調べた日時（ISO 8601） */
  checkedAt: string;
  amazonUrl: string;
  /** 表示している価格の取得に使った API */
  credits: PriceApiCredit[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  productSuggestions?: Product[];
  /** productSuggestions が、原因成分を含まない代わりの商品 */
  suggestionKind?: 'alternatives';
  singleAnalysis?: ProductAnalysisResult;
  differentialAnalysis?: DifferentialAnalysisResult;
  currentUseCheck?: CurrentUseCheckResult;
  safeAlternatives?: Product[];
  priceResult?: PriceResult;
  quickReplies?: string[];
}

export interface UserRoutineState {
  /** 今使っているコスメ（組み合わせチェックに使う。ブラウザにだけ保存し、追加した日もブラウザが持つ） */
  currentlyUsing: Product[];
  badProducts: Product[];    // 肌荒れしたコスメ
  safeProducts: Product[];   // 問題なく使えている安全なコスメ
}
