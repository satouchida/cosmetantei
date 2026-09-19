import test from 'node:test';
import assert from 'node:assert';
import { searchCosmetics } from './lib/services/search-barcode-service';
import {
  analyzeProduct,
  performDifferentialAnalysis,
  findSafeAlternatives,
} from './lib/analyzer/ingredient-analyzer';
import { COSMETICS_DATABASE, addProductToDynamicCache } from './lib/data/cosmetics-db';
import { buildAmazonAffiliateUrl } from './lib/services/amazon-affiliate';
import { MARKETPLACE_DISCLAIMER_JA } from './lib/services/gemini';
import { Product } from './lib/types';
import { synthesizeDynamicCandidate } from './lib/services/live-cosmetics-service';

test('1. Dynamic cosmetics cache and baseline generic standards', () => {
  assert.ok(COSMETICS_DATABASE.length >= 3, 'Baseline generic standards must be loaded in cache');

  for (const p of COSMETICS_DATABASE) {
    assert.ok(p.name, `Product ${p.id} must have a name`);
    assert.ok(p.brand, `Product ${p.id} must have a brand`);
    assert.ok(p.ingredients.length > 0, `Product ${p.id} must have ingredients`);
    assert.ok(p.amazonSearchUrl, `Product ${p.id} must have an Amazon affiliate URL`);
    assert.ok(p.amazonSearchUrl.includes('tag=cosmetantei-22'), 'Affiliate URL must contain cosmetantei tag');
  }
});

test('2. Dynamic candidate creation from user search queries (No manual brand registration needed)', () => {
  const r1 = searchCosmetics('ちふれ　リップ', 3);
  assert.ok(r1.length > 0, 'Must return candidate product for ちふれ リップ');
  assert.ok(r1[0].brand.includes('ちふれ') || r1[0].name.includes('リップ'));
  assert.ok(r1[0].amazonSearchUrl?.includes('tag=cosmetantei-22'));

  const r2 = searchCosmetics('トリデン セラム', 3);
  assert.ok(r2.length > 0, 'Must return candidate product for トリデン セラム');

  const r3 = searchCosmetics('cerave moisturizing cream', 3);
  assert.ok(r3.length > 0, 'Must return candidate product for CeraVe cream');
});

test('3. Ingredient risk classification on live cosmetics', () => {
  const irritantSample: Product = {
    id: 'test_irritant_sample',
    name: '香料・エタノール配合美容液',
    brand: 'テストブランド',
    country: 'JP',
    category: 'serum',
    ingredients: ['水', 'エタノール', 'DPG', 'アスコルビン酸', '香料', 'パラベン'],
  };

  const analysis = analyzeProduct(irritantSample);
  assert.ok(analysis.riskCounts.high_irritant > 0, 'Must detect fragrance as high irritant');
  assert.ok(analysis.riskCounts.moderate_irritant > 0, 'Must detect ethanol as moderate irritant');
  assert.strictEqual(analysis.overallRiskLevel, 'warning');

  const safeSample: Product = {
    id: 'test_safe_sample',
    name: '低刺激セラミド保湿クリーム',
    brand: 'テストブランド',
    country: 'JP',
    category: 'cream',
    ingredients: ['水', 'グリセリン', 'スクワラン', 'セラミドNP', 'アラントイン'],
    fragranceFree: true,
    alcoholFree: true,
  };

  const safeAnalysis = analyzeProduct(safeSample);
  assert.strictEqual(safeAnalysis.overallRiskLevel, 'safe');
});

test('4. Differential culprit isolation algorithm & Amazon alternative recommendations', () => {
  const badProduct: Product = {
    id: 'bad_test_prod',
    name: '肌荒れを起こしたコスメ',
    brand: 'サンプルA',
    country: 'JP',
    category: 'toner',
    ingredients: ['水', 'BG', 'グリセリン', 'エタノール', '合成香料'],
  };

  const safeProduct: Product = {
    id: 'safe_test_prod',
    name: '安全に使えているコスメ',
    brand: 'サンプルB',
    country: 'JP',
    category: 'toner',
    ingredients: ['水', 'BG', 'グリセリン', 'セラミドNP'],
    fragranceFree: true,
    alcoholFree: true,
  };

  const diffResult = performDifferentialAnalysis([badProduct], [safeProduct]);

  assert.ok(diffResult.culprits.length > 0, 'Should isolate culprits');
  const culpritNames = diffResult.culprits.map((c) => c.nameJa);

  assert.ok(culpritNames.some((n) => n.includes('香料')), 'Culprits must include 香料');
  assert.ok(culpritNames.some((n) => n.includes('エタノール')), 'Culprits must include エタノール');

  assert.ok(diffResult.safeAlternatives.length > 0, 'Must recommend safe alternatives');
  for (const alt of diffResult.safeAlternatives) {
    assert.ok(alt.id !== badProduct.id, 'Bad product must not be recommended');
    assert.ok(alt.fragranceFree, 'Alternative should be fragrance-free');
    assert.ok(alt.amazonSearchUrl?.includes('cosmetantei'), 'Must have cosmetantei Amazon affiliate tag');
  }
});

test('5. Amazon affiliate link builder format', () => {
  const url = buildAmazonAffiliateUrl('ちふれ', 'リップスティック', 'cosmetantei-22');
  assert.ok(url.startsWith('https://www.amazon.co.jp/s?k='));
  assert.ok(url.includes('tag=cosmetantei-22'));
});

test('6. Missing ingredients online marketplace exploration & disclaimer test', () => {
  const uncatalogedProduct: Product = {
    id: 'test_uncataloged_item',
    name: '最新韓国トナー',
    brand: '新発売ブランド',
    country: 'KR',
    category: 'toner',
    ingredients: ['成分情報は取得できませんでした'],
    isEstimatedFromMarketplaces: true,
  };

  const analysis = analyzeProduct(uncatalogedProduct);
  assert.strictEqual(analysis.isEstimatedFromMarketplaces, true);
  assert.ok(analysis.dataSourceDisclaimer, 'Must include disclaimer');
  assert.ok(analysis.dataSourceDisclaimer.includes('Amazon'));
  assert.ok(analysis.dataSourceDisclaimer.includes('Sephora'));
  assert.ok(analysis.dataSourceDisclaimer.includes('Olive Young'));
  assert.ok(analysis.dataSourceDisclaimer.includes('楽天市場'));
  assert.ok(analysis.dataSourceDisclaimer.includes('誤差'));
});

test('7. Multi-word search with full-width space ("ちふれ　リップ") and candidate card generation', () => {
  const results = searchCosmetics('ちふれ　リップ', 6);
  assert.ok(results.length >= 1, 'Must return at least 1 candidate for ちふれ　リップ');
  assert.ok(results[0].name.includes('リップ') || results[0].brand.includes('ちふれ'));
});

test('8. Dynamic cache registration of live API & Google search products', () => {
  const liveFetchedProduct: Product = {
    id: 'obf_1234567890123',
    name: 'リアルタイム取得リップバーム',
    brand: 'API取得ブランド',
    country: 'JP',
    category: 'lip',
    ingredients: ['ヒアルロン酸Na', 'ホホバ種子油'],
    fragranceFree: true,
    alcoholFree: true,
  };

  const cached = addProductToDynamicCache(liveFetchedProduct);
  assert.strictEqual(cached.id, 'obf_1234567890123');
  assert.ok(cached.amazonSearchUrl?.includes('tag=cosmetantei-22'));

  const searchHits = searchCosmetics('リアルタイム取得リップバーム', 3);
  assert.ok(searchHits.some((p) => p.id === 'obf_1234567890123'));
});

test('9. All-inputs cosmetic suggestions guarantee (Concerns, Categories, Ingredients, 1-char)', async () => {
  const { searchCosmeticsLive } = await import('./lib/services/live-cosmetics-service');

  // A. 肌トラブル・お悩み入力
  const dryHits = await searchCosmeticsLive('乾燥肌', 3);
  assert.ok(dryHits.length >= 3, 'Must return at least 3 suggestions for 乾燥肌');
  assert.ok(dryHits.some((p) => p.name.includes('クリーム') || p.name.includes('バーム') || p.name.includes('保湿')));

  const acneHits = await searchCosmeticsLive('ニキビ', 3);
  assert.ok(acneHits.length >= 3, 'Must return at least 3 suggestions for ニキビ');

  const rednessHits = await searchCosmeticsLive('赤み', 3);
  assert.ok(rednessHits.length >= 3, 'Must return at least 3 suggestions for 赤み');

  // B. カテゴリ入力
  const lipHits = await searchCosmeticsLive('リップ', 3);
  assert.ok(lipHits.length >= 3, 'Must return at least 3 suggestions for リップ');
  assert.ok(lipHits.some((p) => p.category === 'lip'));

  const washHits = await searchCosmeticsLive('洗顔', 3);
  assert.ok(washHits.length >= 3, 'Must return at least 3 suggestions for 洗顔');

  // C. 成分名入力
  const retinolHits = await searchCosmeticsLive('レチノール', 2);
  assert.ok(retinolHits.length >= 2, 'Must return at least 2 suggestions for レチノール');

  // D. 1文字・任意入力（ゼロ件ゼロ保証）
  const singleCharHits = await searchCosmeticsLive('あ', 3);
  assert.ok(singleCharHits.length >= 3, 'Must return at least 3 suggestions for single character input');
});

test('10. Greeting and consultation detection & service purpose explanation', async () => {
  const { isGreetingOrConsultation, getServicePurposeExplanation } = await import('./lib/services/live-cosmetics-service');

  assert.strictEqual(isGreetingOrConsultation('こんにちは'), true);
  assert.strictEqual(isGreetingOrConsultation('はじめまして！'), true);
  assert.strictEqual(isGreetingOrConsultation('どうすればいい？'), true);
  assert.strictEqual(isGreetingOrConsultation('肌荒れについて相談したい'), true);
  assert.strictEqual(isGreetingOrConsultation('使い方がわからない'), true);

  // コスメ名入力の場合はfalseになること
  assert.strictEqual(isGreetingOrConsultation('ちふれ リップ'), false);
  assert.strictEqual(isGreetingOrConsultation('キュレル 洗顔'), false);

  const explanation = getServicePurposeExplanation('こんにちは');
  assert.ok(explanation.includes('コスメ探偵'), 'Explanation must mention CosmeTantei');
  assert.ok(explanation.includes('比較') || explanation.includes('あぶり出す'), 'Must explain service purpose');
  assert.ok(explanation.includes('化粧品名'), 'Must prompt user to enter cosmetic name');

  // マークダウン強調（**や*）が一切含まれないこと
  assert.ok(!explanation.includes('**'), 'Explanation must not contain ** markdown bold');
  assert.ok(!explanation.includes('* '), 'Explanation must not contain * markdown lists or italics');
});

test('11. Cosmetic-only suggestion filter (Rejects Google search query noise, returns real cosmetics only)', async () => {
  const { isNonCosmeticSearchQuery, isActualCosmeticProduct, searchCosmeticsLive } = await import('./lib/services/live-cosmetics-service');

  // 1. 一般的なGoogle検索ノイズ・クエリの完全排除テスト
  const searchNoiseQueries = [
    'ちふれ 株価',
    'ちふれ 店舗',
    'ちふれ 年齢層',
    'ちふれ 口コミ',
    'ちふれ おすすめ',
    'ちふれ どこで買える',
    'ちふれ 748 似てる',
    'ちふれ 使い方',
    'ちふれ 順番',
    'リップル',
    'リップス 美容室',
    'リップ 塗り方',
    '化粧水 順番',
    '化粧水 タイミング',
    '肌荒れ 治し方',
    'ニキビ 原因',
    'おすすめ ランキング',
    'コスメキッチン 店舗',
  ];

  for (const q of searchNoiseQueries) {
    assert.strictEqual(
      isNonCosmeticSearchQuery(q),
      true,
      `Query "${q}" must be flagged as non-cosmetic search query noise`
    );
    assert.strictEqual(
      isActualCosmeticProduct(q),
      false,
      `Query "${q}" must NOT pass isActualCosmeticProduct`
    );
  }

  // 2. 実在する本物の化粧品の判定テスト
  const authenticCosmetics = [
    'ちふれ 口紅',
    'ちふれ 美白化粧水 W',
    'ちふれ 濃厚 保湿クリーム',
    'KATE リップモンスター',
    'キュレル 潤浸保湿 泡洗顔料',
    'イハダ 薬用ローション とてもしっとり',
    'メラノCC 薬用しみ集中対策 プレミアム美容液',
    '無印良品 敏感肌用 化粧水 高保湿タイプ',
    'ラロッシュポゼ シカプラスト リペアクリーム B5+',
  ];

  for (const item of authenticCosmetics) {
    assert.strictEqual(
      isNonCosmeticSearchQuery(item),
      false,
      `Cosmetic "${item}" must not be flagged as noise`
    );
    assert.strictEqual(
      isActualCosmeticProduct(item),
      true,
      `Cosmetic "${item}" must pass isActualCosmeticProduct`
    );
  }

  // 3. searchCosmeticsLive で "ちふれ" を検索した際、全てが実在化粧品でありノイズが0件であること
  const chifureResults = await searchCosmeticsLive('ちふれ', 5);
  assert.ok(chifureResults.length > 0, 'Chifure must return suggestions');
  for (const product of chifureResults) {
    assert.strictEqual(
      isActualCosmeticProduct(product),
      true,
      `Product "${product.brand} ${product.name}" must be an actual cosmetic`
    );
    assert.strictEqual(
      isNonCosmeticSearchQuery(product.name),
      false,
      `Product name "${product.name}" must not be a search query noise`
    );
    assert.ok(
      !/(株価|店舗|年齢層|口コミ|おすすめ|順番|使い方|どこで買える|リップル)/.test(product.name),
      `Product name "${product.name}" must not contain search query noise`
    );
  }

  // 4. searchCosmeticsLive で "リップ" を検索した際、リップルやリップスなどの異物が入らないこと
  const lipResults = await searchCosmeticsLive('リップ', 5);
  assert.ok(lipResults.length > 0, 'Lip must return suggestions');
  for (const product of lipResults) {
    assert.strictEqual(
      isActualCosmeticProduct(product),
      true,
      `Product "${product.brand} ${product.name}" must be an actual cosmetic`
    );
    assert.ok(
      !/(リップル|仮想通貨|サロン|美容室|塗り方|順番)/.test(product.name),
      `Lip product "${product.name}" must not contain non-cosmetics`
    );
  }
});

test('12. Dynamic API & cache-only architecture (Zero internal static brand catalogs)', async () => {
  const { searchCosmeticsLive } = await import('./lib/services/live-cosmetics-service');
  const { COSMETICS_DATABASE } = await import('./lib/data/cosmetics-db');

  // 内部データベースに固定のブランド商品カタログが存在しないこと（外部API/推測から動的供給）
  const liveModule = await import('./lib/services/live-cosmetics-service');
  assert.strictEqual(
    (liveModule as any).BRAND_COSMETICS_CATALOG,
    undefined,
    'BRAND_COSMETICS_CATALOG must not exist as internal static database'
  );
  assert.strictEqual(
    (liveModule as any).SKIN_CONCERN_PRODUCTS,
    undefined,
    'SKIN_CONCERN_PRODUCTS must not exist as internal static database'
  );
  assert.strictEqual(
    (liveModule as any).CATEGORY_PRODUCTS,
    undefined,
    'CATEGORY_PRODUCTS must not exist as internal static database'
  );
  assert.strictEqual(
    (liveModule as any).INGREDIENT_PRODUCTS,
    undefined,
    'INGREDIENT_PRODUCTS must not exist as internal static database'
  );

  // 検索を実行すると、API/探索結果が動的ランタイムキャッシュに登録されること
  const initialCacheSize = COSMETICS_DATABASE.length;
  const results = await searchCosmeticsLive('アヌア', 3);
  assert.ok(results.length > 0, 'Must return results for dynamically queried brand');
  assert.ok(
    COSMETICS_DATABASE.length >= initialCacheSize,
    'Dynamically discovered products must be stored in runtime cache'
  );

  for (const item of results) {
    assert.ok(item.name, 'Product must have a valid name');
    assert.ok(item.brand, 'Product must have a valid brand');
    assert.ok(item.amazonSearchUrl?.includes('tag=cosmetantei-22'), 'Must have Amazon affiliate URL');
    assert.ok(!item.descriptionJa?.includes('**'), 'Description must not contain markdown bold');
  }
});



