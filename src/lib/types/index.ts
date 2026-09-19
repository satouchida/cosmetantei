export type CountryOrigin = 'JP' | 'KR' | 'US' | 'EU';

export type IngredientRiskLevel = 
  | 'safe'            // 🟢 低刺激・安心成分
  | 'low_caution'     // 🟡 軽度の注意（個人差あり）
  | 'moderate_irritant'// 🟠 敏感肌には刺激になりやすい
  | 'high_irritant'   // 🔴 高リスクアレルゲン・旧表示指定成分等
  | 'active_caution'; // 🟣 高濃度アクティブ成分（併用・バリア機能低下時に注意）

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
  comedogenicRating?: number; // 0 - 5
}

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
  ingredients: string[]; // 全成分リスト（日本語正規化）
  ingredientsEn?: string[]; // INCI英語名リスト
  fullIngredientsRaw?: string;
  descriptionJa?: string;
  fragranceFree?: boolean;
  alcoholFree?: boolean; // エタノールフリー
  amazonSearchUrl?: string; // Amazonアフィリエイトリンク
  isEstimatedFromMarketplaces?: boolean; // Amazon/Sephora/Olive Young/Rakuten等のオンライン情報から補完
}

export interface AnalyzedIngredient {
  rawName: string;
  normalizedJa: string;
  matchedKnown?: KnownIngredient;
  riskLevel: IngredientRiskLevel;
  isSuspect: boolean;
  category: IngredientCategory;
  reasonJa?: string;
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
  };
  overallRiskLevel: 'safe' | 'caution' | 'warning';
  summaryJa: string;
  warningsJa: string[];
  soothingHighlightsJa: string[];
  safeAlternatives?: Product[]; // 刺激成分を含まないおすすめ代替品
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
