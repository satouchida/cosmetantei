export type CountryOrigin = 'JP' | 'KR' | 'US' | 'EU';

export type IngredientRiskLevel = 
  | 'safe'            // 🟢 低刺激・安心成分
  | 'low_caution'     // 🟡 軽度の注意（個人差あり）
  | 'moderate_irritant'// 🟠 敏感肌には刺激になりやすい
  | 'high_irritant'   // 🔴 高リスクアレルゲン・旧表示指定成分等
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
 */
export type IngredientSource = 'open_beauty_facts' | 'user_label' | 'web_page' | 'ai_estimate';

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
  ingredientsEn?: string[]; // INCI英語名リスト
  fullIngredientsRaw?: string;
  descriptionJa?: string;
  fragranceFree?: boolean;
  alcoholFree?: boolean; // エタノールフリー
  amazonSearchUrl?: string; // Amazonアフィリエイトリンク
  isEstimatedFromMarketplaces?: boolean; // Amazon/Sephora/Olive Young/Rakuten等のオンライン情報から補完
  ingredientSource?: IngredientSource;
  /** 製品情報・成分表示の出典ページ（ingredientSource が web_page のとき） */
  sourceUrl?: string;
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
  isEstimatedFromMarketplaces?: boolean;
  dataSourceDisclaimer?: string;
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

export interface DifferentialAnalysisResult {
  badProducts: Product[];
  safeProducts: Product[];
  culprits: CulpritIngredient[];
  sharedIngredients: string[];
  summaryJa: string;
  adviceJa: string[];
  safeAlternatives: Product[]; // 疑わしい成分を含まない安心のAmazonおすすめ商品
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  productSuggestions?: Product[];
  singleAnalysis?: ProductAnalysisResult;
  differentialAnalysis?: DifferentialAnalysisResult;
  safeAlternatives?: Product[];
  quickReplies?: string[];
}

export interface UserRoutineState {
  currentlyUsing: Product[];
  badProducts: Product[];    // 肌荒れしたコスメ
  safeProducts: Product[];   // 問題なく使えている安全なコスメ
}
