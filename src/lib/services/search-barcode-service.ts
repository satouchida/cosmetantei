import { COSMETICS_DATABASE, addProductToDynamicCache, rememberVerifiedProducts } from '../data/cosmetics-db';
import { Product } from '../types';
import { buildAmazonAffiliateUrl } from './amazon-affiliate';
import { labelProductFields, parseIngredientLabel } from '../analyzer/label-parser';
import { cacheGetJSON, cachePutJSON } from '../server/cloudflare';
import { researchBarcode } from './web-research';
import {
  searchCosmeticsLive,
  searchOpenBeautyFacts,
  normalizeSearchString,
  isGreetingOrConsultation,
  getServicePurposeExplanation,
  isActualCosmeticProduct,
  isNonCosmeticSearchQuery,
  isGenericCosmeticTerm,
  getDisplayBrand,
} from './live-cosmetics-service';

export {
  normalizeSearchString,
  searchCosmeticsLive,
  searchOpenBeautyFacts,
  isGreetingOrConsultation,
  getServicePurposeExplanation,
  isActualCosmeticProduct,
  isNonCosmeticSearchQuery,
  isGenericCosmeticTerm,
  getDisplayBrand,
};

const CATEGORY_SYNONYMS: Record<string, string[]> = {
  lip: ['リップ', '口紅', 'ルージュ', 'ティント', 'リップクリーム', 'リップバーム', 'リップジェル'],
  cleanser: ['洗顔', 'クレンジング', 'ウォッシュ', '石鹸', 'せっけん', 'メイク落とし'],
  toner: ['化粧水', 'ローション', 'トナー', 'スキン'],
  cream: ['クリーム', '乳液', 'ミルク', '保湿クリーム', 'ジェルクリーム'],
  serum: ['美容液', 'セラム', 'エッセンス', 'アンプル'],
  sunscreen: ['日焼け止め', '日やけ止め', 'サンプロテクト', 'uvカット', 'uv'],
  mask: ['パック', 'マスク', 'シートマスク'],
};

/**
 * コスメの高速キャッシュ検索（即時応答用）
 * - 特定ブランド固定DBに依存せず、動的キャッシュ内を走査
 * - 該当が無い場合も架空の候補は生成しない
 */
export function searchCosmetics(query: string, limit = 6): Product[] {
  if (!query || query.trim().length === 0) {
    return COSMETICS_DATABASE.slice(0, limit);
  }

  const cleanInput = query.replace(/\u3000/g, ' ').trim();
  const numericOnly = cleanInput.replace(/[^0-9]/g, '');

  // バーコード番号の場合
  if (numericOnly.length >= 8 && numericOnly.length <= 14) {
    const barcodeMatch = COSMETICS_DATABASE.filter(
      (p) =>
        p.barcode &&
        (p.barcode.replace(/[^0-9]/g, '') === numericOnly ||
          p.barcode.replace(/^0+/, '') === numericOnly.replace(/^0+/, ''))
    );
    if (barcodeMatch.length > 0) {
      return barcodeMatch.slice(0, limit);
    }
  }

  const tokens = cleanInput
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => normalizeSearchString(t));

  const fullNormalizedQuery = normalizeSearchString(cleanInput);

  const scored = COSMETICS_DATABASE.map((item) => {
    let score = 0;
    const nameNorm = normalizeSearchString(item.name);
    const brandNorm = normalizeSearchString(item.brand);
    const descNorm = normalizeSearchString(item.descriptionJa || '');

    const catSyns = CATEGORY_SYNONYMS[item.category] || [];
    const catNorm = catSyns.map((s) => normalizeSearchString(s)).join(' ');

    const combinedSearchTarget = `${brandNorm} ${nameNorm} ${catNorm} ${descNorm}`;

    if (nameNorm === fullNormalizedQuery || brandNorm === fullNormalizedQuery) {
      score += 250;
    } else if (nameNorm.includes(fullNormalizedQuery) || brandNorm.includes(fullNormalizedQuery)) {
      score += 150;
    } else if (combinedSearchTarget.includes(fullNormalizedQuery)) {
      score += 80;
    }

    let matchedTokenCount = 0;

    for (const token of tokens) {
      let tokenMatched = false;

      if (brandNorm.includes(token)) {
        score += 80;
        tokenMatched = true;
      }
      if (nameNorm.includes(token)) {
        score += 80;
        tokenMatched = true;
      }
      if (catNorm.includes(token)) {
        score += 50;
        tokenMatched = true;
      }
      if (descNorm.includes(token)) {
        score += 20;
        tokenMatched = true;
      }

      if (tokenMatched) {
        matchedTokenCount++;
      }
    }

    if (tokens.length > 1 && matchedTokenCount === tokens.length) {
      score += 200;
    }

    return { item, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.item)
    .filter(isActualCosmeticProduct)
    .slice(0, limit);
}

/**
 * バーコード（JANコード・EAN・UPC）から製品情報を検索する
 * 1. 動的キャッシュを検索
 * 2. KV に保存済みの照合結果を検索
 * 3. Open Beauty Facts API へ問い合わせ
 * 4. Google Search Grounding で最新の成分・商品情報をWeb検索
 */
/** JAN / EAN / UPC は 8〜14 桁 */
export const BARCODE_PATTERN = /^[0-9]{8,14}$/;
const BARCODE_TTL_SECONDS = 60 * 60 * 24 * 7;
const BARCODE_MISS_TTL_SECONDS = 60 * 60;

export async function lookupByBarcode(barcode: string): Promise<Product | null> {
  const cleanCode = barcode.trim().replace(/[^0-9]/g, '');
  if (!BARCODE_PATTERN.test(cleanCode)) return null;

  // 1. 動的キャッシュ内を検索
  const cleanNoZero = cleanCode.replace(/^0+/, '');
  const localMatch = COSMETICS_DATABASE.find((p) => {
    if (!p.barcode) return false;
    const pCode = p.barcode.replace(/[^0-9]/g, '');
    const pNoZero = pCode.replace(/^0+/, '');
    return pCode === cleanCode || pNoZero === cleanNoZero;
  });

  if (localMatch) {
    return localMatch;
  }

  // 2. KV に保存済みのバーコード照合結果
  // v2: Google 検索グラウンディングで推定した v1 の結果は使わない
  const kvKey = `barcode:v2:${cleanCode}`;
  const stored = await cacheGetJSON<Product>(kvKey);
  if (stored) {
    addProductToDynamicCache(stored);
    return stored;
  }
  // 直近で見つからなかったバーコードは、外部API・Gemini への再問い合わせを避ける
  if (await cacheGetJSON<boolean>(`${kvKey}:miss`)) return null;

  // 3. Open Beauty Facts API 問い合わせ (4秒タイムアウト付き)
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(`https://world.openbeautyfacts.org/api/v2/product/${cleanCode}.json`, {
      headers: {
        'User-Agent': 'CosmeTantei/1.0 (https://cosmetantei.com; contact@cosmetantei.com)',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data.status === 1 && data.product) {
        const p = data.product;
        const productName =
          p.product_name_ja ||
          p.product_name ||
          p.product_name_en ||
          p.generic_name_ja ||
          p.generic_name ||
          `製品 (JAN: ${cleanCode})`;
        const brand = p.brands || p.brand || 'ブランド未登録';

        const labelText = p.ingredients_text_ja || p.ingredients_text;
        const label = labelProductFields(parseIngredientLabel(typeof labelText === 'string' ? labelText : ''));
        let ingredients = label.ingredients;
        if (ingredients.length === 0 && Array.isArray(p.ingredients)) {
          ingredients = p.ingredients
            .map((ing: { text?: string; id?: string }) => ing.text || ing.id?.replace('en:', '') || '')
            .filter(Boolean);
        }

        const isEstimated = ingredients.length === 0;
        if (isEstimated) {
          ingredients = ['成分情報はGoogle検索およびオンラインマーケットプレイスより補完'];
        }

        // 医薬部外品の有効成分も含めて香料・エタノールの有無を見る
        const labelled = [...(label.activeIngredientsJa ?? []), ...ingredients];

        const country: 'JP' | 'KR' | 'US' | 'EU' =
          cleanCode.startsWith('45') || cleanCode.startsWith('49')
            ? 'JP'
            : cleanCode.startsWith('880')
            ? 'KR'
            : 'US';

        const product: Product = {
          id: `obf_${cleanCode}`,
          name: productName,
          brand: brand,
          country: country,
          category: 'other',
          barcode: cleanCode,
          imageUrl: p.image_front_url || p.image_url,
          // 有効成分だけでは全成分がわからないため、その他の成分が無ければ医薬部外品の項目も使わない
          ...(label.ingredients.length > 0 && label),
          ingredients: ingredients,
          descriptionJa: `バーコード（JAN: ${cleanCode}）から取得した最新商品データです`,
          fragranceFree: !labelled.some(
            (i) => /香料|fragrance|parfum/i.test(i)
          ),
          alcoholFree: !labelled.some(
            (i) => /エタノール|alcohol denat/i.test(i)
          ),
          amazonSearchUrl: buildAmazonAffiliateUrl(brand, productName),
          isEstimatedFromMarketplaces: isEstimated,
          ingredientSource: isEstimated ? undefined : 'open_beauty_facts',
        };

        addProductToDynamicCache(product);
        await cachePutJSON(kvKey, product, BARCODE_TTL_SECONDS);
        await rememberVerifiedProducts([product]);
        return product;
      }
    }
  } catch {
    // ignore
  }

  // 4. Web リサーチ：バーコードで検索し、同じバーコードが書かれたページの製品だけを採用する
  const webProduct = await researchBarcode(cleanCode);
  if (webProduct) {
    await cachePutJSON(kvKey, webProduct, BARCODE_TTL_SECONDS);
    return webProduct;
  }
  // 一時的な失敗（検索・Gemini のエラー）は「見つからない」として保存しない
  if (webProduct === undefined) return null;

  await cachePutJSON(`${kvKey}:miss`, true, BARCODE_MISS_TTL_SECONDS);
  return null;
}
