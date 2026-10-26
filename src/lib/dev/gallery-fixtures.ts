/**
 * 開発用の画面一覧（/dev/gallery）で使う見本のデータ。API を呼ばずに、すべての画面を出すため。
 * 型は src/lib/types から取るので、型を変えたら型チェックでここも直すことになる。
 * 長い名前・多い成分・大きな値など、画面が崩れやすいものを入れておく（docs/plans/responsive-design.md）
 */
import type { KnownIngredient, PriceResult, Product } from '@/lib/types';
import { SHOP_ID_PREFIX } from '@/lib/types';
import { SHOP_TEXT_ID_PREFIX } from '@/lib/product-source';
import type { CurrentUseEntry } from '@/lib/current-use';
import { normalizeIngredientName } from '@/lib/utils/ingredient-name';

const AMAZON = 'https://www.amazon.co.jp/s?k=example&tag=cosmetantei22-22';

export const melano: Product = {
  id: 'gallery_melano',
  name: '薬用しみ集中対策 プレミアム美容液',
  brand: 'ロート製薬',
  country: 'JP',
  category: 'serum',
  isQuasiDrug: true,
  activeIngredientsJa: ['アスコルビン酸', 'グリチルリチン酸ジカリウム'],
  ingredients: ['ピリドキシン塩酸塩', 'アラントイン', 'o-シメン-5-オール', 'エタノール', '香料', 'フェノキシエタノール'],
  amazonSearchUrl: AMAZON,
};

/** 海外の製品：日本の化粧品基準で配合できない成分（ホウ酸）と、表示指定成分（セタノール・EDTA・BHT）を含む */
export const importedCream: Product = {
  id: 'gallery_imported_cream',
  name: 'Daily Moisturizing Cream',
  brand: 'Overseas Brand',
  country: 'US',
  category: 'cream',
  ingredients: ['水', 'グリセリン', 'スクワラン', 'セタノール', 'ステアリルアルコール', 'ホウ酸', 'EDTA-2Na', 'BHT'],
  amazonSearchUrl: AMAZON,
};

/** 全成分が見つからなかった製品（お店の商品名で調べて、成分の無い候補だけだったときなど） */
export const noIngredientsLotion: Product = {
  id: 'gallery_no_ingredients',
  name: 'モイスチャライジングローション 591ml',
  brand: 'テストブランド',
  country: 'US',
  category: 'toner',
  ingredients: ['成分情報はGoogle検索およびオンラインマーケットプレイスより補完'],
  isEstimatedFromMarketplaces: true,
  amazonSearchUrl: AMAZON,
};

/** 成分DBに無い2成分（セテアレス-20・パントラクトン）を AI が評価した製品（aiRatings と合わせて使う） */
export const aiRatedLotion: Product = {
  id: 'gallery_ai_rated',
  name: 'モイスチャライジングローション',
  brand: 'テストブランド',
  country: 'US',
  category: 'toner',
  ingredients: ['水', 'グリセリン', 'パンテノール', 'ナイアシンアミド', 'セテアレス-20', 'パントラクトン', '安息香酸Na', 'ベンジルアルコール'],
  ingredientSource: 'web_page',
  sourceUrl: 'https://example.com/products/moisturizing-lotion',
  amazonSearchUrl: AMAZON,
};

const aiRating = (nameJa: string, nameEn: string, riskLevel: KnownIngredient['riskLevel']): KnownIngredient => ({
  id: `ai_gallery_${nameEn}`,
  nameJa,
  nameEn,
  aliases: [],
  category: 'other',
  riskLevel,
  reasonJa: '乳化を助ける成分です（見本）。',
  sensitiveSkinAdviceJa: '気になる場合は、目立たない部分で試してから使用してください（見本）。',
  evidenceJa: '見本のデータ',
});

/** 正規化した成分名 → AI の評価（analyzeProduct の2つ目の引数） */
export const aiRatings = new Map<string, KnownIngredient>([
  [normalizeIngredientName('セテアレス-20'), aiRating('セテアレス-20', 'ceteareth-20', 'low_caution')],
  [normalizeIngredientName('パントラクトン'), aiRating('パントラクトン', 'pantolactone', 'safe')],
]);

/** 楽天の商品説明から成分を読んだ製品（出典のリンクはアフィリエイトのリンク） */
export const rakutenListing: Product = {
  id: `${SHOP_TEXT_ID_PREFIX}rakuten_gallery`,
  name: '【公式】敏感肌用 保湿クリーム 50g',
  brand: 'テストブランド',
  country: 'JP',
  category: 'cream',
  ingredients: ['水', 'グリセリン', 'スクワラン', 'セラミドNP', 'フェノキシエタノール'],
  ingredientSource: 'shop_listing',
  sharedSource: false,
  shopLink: { href: 'https://example.com/rakuten/item', sponsored: true },
};

/** Yahoo!ショッピングの商品説明から成分を読んで保存した製品（自動の保存。出典は素の商品ページ） */
export const yahooListing: Product = {
  id: 'yahoo_4900000000017',
  name: '敏感肌用 しっとり化粧水 とてもしっとり 150ml',
  brand: 'テストブランド',
  country: 'JP',
  category: 'toner',
  barcode: '4900000000017',
  ingredients: ['水', 'BG', 'グリセリン', 'ベタイン', 'セラミドNP', 'フェノキシエタノール'],
  ingredientSource: 'shop_yahoo',
  sourceUrl: 'https://store.shopping.yahoo.co.jp/example/item.html',
};

export const curel: Product = {
  id: 'gallery_curel',
  name: '潤浸保湿 泡洗顔料',
  brand: 'キュレル',
  country: 'JP',
  category: 'cleanser',
  isQuasiDrug: true,
  fragranceFree: true,
  alcoholFree: true,
  ingredients: ['グリチルリチン酸2K', '精製水', 'グリセリン', 'ラウロイルアスパラギン酸Na液'],
  amazonSearchUrl: AMAZON,
};

export const ihada: Product = {
  id: 'gallery_ihada',
  name: '薬用ローション とてもしっとり',
  brand: 'イハダ',
  country: 'JP',
  category: 'toner',
  fragranceFree: true,
  alcoholFree: true,
  ingredients: ['アラントイン', 'グリチルリチン酸ジカリウム', '精製水', '高精製ワセリン'],
  amazonSearchUrl: AMAZON,
};

export const retinolSerum: Product = {
  id: 'gallery_retinol',
  name: 'レチノール リペア ナイトセラム',
  brand: 'Long Brand Name Laboratories International',
  country: 'US',
  category: 'serum',
  ingredients: ['水', 'グリセリン', 'レチノール', 'トコフェロール', '香料'],
  amazonSearchUrl: AMAZON,
};

export const salicylicToner: Product = {
  id: 'gallery_salicylic',
  name: 'クリアスキン 角質ケア トナー',
  brand: 'COSRX',
  country: 'KR',
  category: 'toner',
  ingredients: ['水', 'サリチル酸', 'ナイアシンアミド', 'BG', 'リモネン', '香料'],
  amazonSearchUrl: AMAZON,
};

/** 空白のない長い英字の名前（折り返せないと横にはみ出す） */
export const longLatinName: Product = {
  id: 'gallery_long_latin',
  name: 'HyaluronicAcidCeramideNiacinamidePanthenolBarrierRepairIntensiveMoisturizingSerum',
  brand: 'SuperLongBrandNameWithoutAnySpacesCosmetics',
  country: 'EU',
  category: 'serum',
  ingredients: ['Aqua', 'Glycerin', 'Niacinamide', 'Sodium Hyaluronate', 'Ceramide NP', 'Panthenol', 'Parfum'],
  amazonSearchUrl: AMAZON,
};

/** 長い日本語の名前と、多くの成分 */
export const longJapanese: Product = {
  id: 'gallery_long_ja',
  name: 'トレリアン ダブルリペア フェイス モイスチャライザー UV SPF30 PA+++ 敏感肌用 乳液 75mL 2本セット',
  brand: 'ラ ロッシュ ポゼ',
  country: 'EU',
  category: 'cream',
  fragranceFree: true,
  ingredients: [
    '水',
    'グリセリン',
    'ジメチコン',
    'ナイアシンアミド',
    'セラミドNP',
    'スクワラン',
    'BG',
    'ペンチレングリコール',
    'メトキシケイヒ酸エチルヘキシル',
    't-ブチルメトキシジベンゾイルメタン',
    'カルボマー',
    'トコフェロール',
    'フェノキシエタノール',
    'エチルヘキシルグリセリン',
    'EDTA-2Na',
    'クエン酸',
  ],
  amazonSearchUrl: AMAZON,
};

/** 成分が分からない製品（リストに追加するボタンが出ない） */
export const noIngredients: Product = {
  id: 'gallery_no_ingredients',
  name: 'モイスチャー ジェルクリーム',
  brand: 'Unknown',
  country: 'JP',
  category: 'cream',
  ingredients: [],
  amazonSearchUrl: AMAZON,
};

/** お店の商品検索の製品（候補のトレイ・代わりの商品） */
export function shopProduct(i: number, opts: { longName?: boolean; sponsored?: boolean } = {}): Product {
  return {
    id: `${SHOP_ID_PREFIX}gallery_${i}`,
    name: opts.longName
      ? `【公式】無印良品 敏感肌用化粧水 高保湿タイプ 400mL 大容量 詰め替え用 2個セット 送料無料 ポイント10倍 ${i}`
      : `敏感肌用化粧水 高保湿タイプ ${i} 400mL`,
    brand: '無印良品',
    country: 'JP',
    category: 'toner',
    ingredients: [],
    imageUrl: undefined,
    shopPrice: { yen: i === 9 ? 1_234_567 : 990 + i * 490, taxIncluded: i % 3 === 0 ? false : true },
    shopLink: { href: `https://example.com/item/${i}`, sponsored: opts.sponsored ?? true },
  };
}

export const shopProducts: Product[] = Array.from({ length: 9 }, (_, i) => shopProduct(i + 1, { longName: i % 2 === 0 }));

export const routineProducts = {
  bad: [melano, longJapanese, longLatinName],
  safe: [curel, ihada],
};

const DAY = 24 * 60 * 60 * 1000;
/** 今使っているコスメ（2つ目は3か月以上前に追加した） */
export function currentUseEntries(now: number): CurrentUseEntry[] {
  return [
    { product: retinolSerum, addedAt: now - 10 * DAY },
    { product: salicylicToner, addedAt: now - 120 * DAY },
    { product: longJapanese, addedAt: now - 3 * DAY },
  ];
}

export const priceOk: PriceResult = {
  productQuery: 'キュレル 潤浸保湿 泡洗顔料',
  status: 'ok',
  checkedAt: '2026-10-21T09:30:00+09:00',
  amazonUrl: AMAZON,
  credits: ['rakuten', 'yahoo'],
  offers: [
    {
      shop: 'ドラッグストア・コスメ専門店 ビューティーライフ楽天市場店（土日祝も発送）',
      marketplace: '楽天市場',
      productName: '【送料無料・まとめ買い】花王 キュレル 潤浸保湿 泡洗顔料 150mL ×3個セット 医薬部外品 敏感肌 乾燥肌',
      priceYen: 2_178,
      taxIncluded: true,
      sourceUrl: 'https://example.com/rakuten/1',
      href: 'https://example.com/rakuten/1',
      sponsored: true,
    },
    {
      shop: 'LOHACO',
      marketplace: 'Yahoo!ショッピング',
      productName: 'キュレル 泡洗顔料 150mL',
      priceYen: 1_408,
      taxIncluded: null,
      sourceUrl: 'https://example.com/yahoo/1',
      href: 'https://example.com/yahoo/1',
      sponsored: true,
    },
    {
      shop: 'Store',
      marketplace: '楽天市場',
      productName: 'キュレル 潤浸保湿 泡洗顔料 業務用 10L',
      priceYen: 1_234_567,
      taxIncluded: false,
      sourceUrl: 'https://example.com/rakuten/2',
      href: 'https://example.com/rakuten/2',
      sponsored: false,
    },
  ],
};

export const priceUnavailable: PriceResult = {
  productQuery: 'HyaluronicAcidCeramideNiacinamidePanthenolBarrierRepairIntensiveMoisturizingSerum',
  status: 'unavailable',
  checkedAt: '2026-10-21T09:30:00+09:00',
  amazonUrl: AMAZON,
  credits: [],
  offers: [],
};
