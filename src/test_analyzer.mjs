import test from 'node:test';
import assert from 'node:assert';
import { searchCosmetics } from './lib/services/search-barcode-service.ts';
import { analyzeProduct, performDifferentialAnalysis } from './lib/analyzer/ingredient-analyzer.ts';
import { COSMETICS_DATABASE } from './lib/data/cosmetics-db.ts';

test('Search Cosmetics by Japanese and English terms', () => {
  const curelResults = searchCosmetics('キュレル 泡洗顔', 3);
  assert.ok(curelResults.length > 0, 'Should find Curel wash');
  assert.strictEqual(curelResults[0].id, 'curel_foam_wash');

  const anuaResults = searchCosmetics('アヌア ドクダミ', 3);
  assert.ok(anuaResults.length > 0, 'Should find Anua toner');
  assert.strictEqual(anuaResults[0].id, 'anua_heartleaf_77_toner');

  const ceraveResults = searchCosmetics('cerave cream', 3);
  assert.ok(ceraveResults.length > 0, 'Should find CeraVe cream');
  assert.strictEqual(ceraveResults[0].id, 'cerave_moisturizing_cream');
});

test('Analyze Product Ingredients', () => {
  const melano = COSMETICS_DATABASE.find(p => p.id === 'melano_cc_premium_essence');
  assert.ok(melano);
  const analysis = analyzeProduct(melano);
  
  assert.ok(analysis.riskCounts.high_irritant > 0, 'Should detect fragrance as high irritant');
  assert.ok(analysis.riskCounts.moderate_irritant > 0, 'Should detect ethanol');
  assert.ok(analysis.warningsJa.length > 0);
});

test('Perform Differential Analysis between Bad and Safe Products', () => {
  const badProduct = COSMETICS_DATABASE.find(p => p.id === 'melano_cc_premium_essence');
  const safeProduct1 = COSMETICS_DATABASE.find(p => p.id === 'curel_moisture_cream');
  const safeProduct2 = COSMETICS_DATABASE.find(p => p.id === 'ihada_medicated_lotion');

  assert.ok(badProduct && safeProduct1 && safeProduct2);

  const diff = performDifferentialAnalysis([badProduct], [safeProduct1, safeProduct2]);
  
  assert.ok(diff.culprits.length > 0, 'Should identify culprit ingredients');
  const culpritNames = diff.culprits.map(c => c.nameJa);
  
  // Fragrance or ethanol or pure ascorbic acid should be in culprits
  const hasFragranceOrAlcohol = culpritNames.some(n => n.includes('香料') || n.includes('エタノール') || n.includes('アスコルビン酸'));
  assert.ok(hasFragranceOrAlcohol, 'Culprits must include irritating ingredients not in safe products');
});
