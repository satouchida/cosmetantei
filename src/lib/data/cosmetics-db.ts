import { Product } from '../types';
import { buildAmazonAffiliateUrl } from '../services/amazon-affiliate';

/**
 * 【動的コスメキャッシュ＆標準ベースライン】
 * 特定ブランドを手動で大量登録する方式を廃止し、
 * Open Beauty Facts API や Google検索グラウンディングから
 * リアルタイム・高頻度で取得した商品を動的にキャッシュ・管理します。
 */

// オフライン時や差分分析の比較基準としてのみ用いる、中立な標準基剤（ジェネリックベースライン）
const BASELINE_GENERIC_STANDARDS: Omit<Product, 'amazonSearchUrl'>[] = [
  {
    id: 'generic_pure_petrolatum',
    name: '高精製 白色ワセリン (標準低刺激バリア)',
    brand: '標準処方 (ジェネリック)',
    country: 'JP',
    category: 'cream',
    barcode: '4987286307435',
    isQuasiDrug: false,
    ingredients: ['白色ワセリン'],
    ingredientsEn: ['Petrolatum'],
    descriptionJa: '防腐剤・界面活性剤・香料無添加の超低刺激保湿保護バリア基剤。',
    fragranceFree: true,
    alcoholFree: true,
  },
  {
    id: 'generic_ceramide_barrier_lotion',
    name: 'ヒト型セラミド配合 低刺激保湿ローション',
    brand: '標準処方 (ジェネリック)',
    country: 'JP',
    category: 'toner',
    barcode: '4560123456789',
    isQuasiDrug: false,
    ingredients: ['水', 'グリセリン', 'BG', 'セラミドNP', 'セラミドAP', 'セラミドEOP', 'フィトスフィンゴシン', 'ヒアルロン酸Na', 'フェノキシエタノール'],
    ingredientsEn: ['Water', 'Glycerin', 'Butylene Glycol', 'Ceramide NP', 'Ceramide AP', 'Ceramide EOP', 'Phytosphingosine', 'Sodium Hyaluronate', 'Phenoxyethanol'],
    descriptionJa: '肌の角層バリアを補うセラミド複合体とヒアルロン酸配合の無香料ローション。',
    fragranceFree: true,
    alcoholFree: true,
  },
  {
    id: 'generic_mineral_sunscreen',
    name: 'ノンケミカル (紫外線散乱剤) ミネラルUVミルク',
    brand: '標準処方 (ジェネリック)',
    country: 'JP',
    category: 'sunscreen',
    barcode: '4560123456796',
    isQuasiDrug: false,
    ingredients: ['酸化亜鉛', '酸化チタン', '水', 'シクロペンタシロキサン', 'BG', 'グリセリン', 'ステアリン酸', 'スクワラン'],
    ingredientsEn: ['Zinc Oxide', 'Titanium Dioxide', 'Water', 'Cyclopentasiloxane', 'Butylene Glycol', 'Glycerin', 'Stearic Acid', 'Squalane'],
    descriptionJa: '紫外線吸収剤不使用（ノンケミカル処方）の低刺激日焼け止めミルク。',
    fragranceFree: true,
    alcoholFree: true,
  },
];

// 動的ランタイムキャッシュ（APIおよびGoogle検索から取得した商品データを随時格納）
const RUNTIME_CACHE: Product[] = BASELINE_GENERIC_STANDARDS.map((item) => ({
  ...item,
  amazonSearchUrl: buildAmazonAffiliateUrl(item.brand, item.name),
}));

export const COSMETICS_DATABASE: Product[] = RUNTIME_CACHE;

/**
 * 外部APIやGoogle検索で取得した商品情報を動的キャッシュに追加・更新
 */
export function addProductToDynamicCache(product: Product): Product {
  const existingIdx = RUNTIME_CACHE.findIndex(
    (p) =>
      p.id === product.id ||
      (product.barcode && p.barcode === product.barcode) ||
      (p.name === product.name && p.brand === product.brand)
  );

  const enrichedProduct: Product = {
    ...product,
    amazonSearchUrl: product.amazonSearchUrl || buildAmazonAffiliateUrl(product.brand, product.name),
  };

  if (existingIdx >= 0) {
    RUNTIME_CACHE[existingIdx] = enrichedProduct;
  } else {
    RUNTIME_CACHE.unshift(enrichedProduct);
  }

  return enrichedProduct;
}

export function addMultipleProductsToDynamicCache(products: Product[]): Product[] {
  return products.map(addProductToDynamicCache);
}
