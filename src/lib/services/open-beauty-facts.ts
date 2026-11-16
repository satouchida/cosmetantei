import { Product } from '../types';
import { reserveSpend } from '../server/spend-cap';
import { addProductToDynamicCache, rememberVerifiedProducts } from '../data/cosmetics-db';
import { buildAmazonAffiliateUrl } from './amazon-affiliate';
import { LABEL_FORMAT, labelProductFields, parseIngredientLabel } from '../analyzer/label-parser';
import { isGreetingOrConsultation, isNonCosmeticSearchQuery } from './query-check';
import { isActualCosmeticProduct } from './product-filter';
import { contactEmail, SITE_URL } from '../site';

/** Open Beauty Facts の名前での検索（バーコードでの取得は search-barcode-service.ts の fetchObfProduct） */

/** Open Beauty Facts の応答待ち（2026-10-13 の評価で nivea が 2.3 秒かかった。結果は検索 API で1時間キャッシュする） */
const OBF_TIMEOUT_MS = 4_000;

/**
 * 1. Open Beauty Facts API から実在コスメを検索
 */
export async function searchOpenBeautyFacts(query: string, limit = 4): Promise<Product[]> {
  const clean = query.replace(/\u3000/g, ' ').trim();
  if (!clean || isGreetingOrConsultation(clean) || isNonCosmeticSearchQuery(clean)) return [];
  // 検索 API の回数を全員で数える（1人の大量の検索で、OBF にこのアプリを止められないように。金額は 0）
  if (!(await reserveSpend('open_beauty_facts', 0))) return [];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OBF_TIMEOUT_MS);
  try {

    const url = `https://world.openbeautyfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(
      clean
    )}&search_simple=1&action=process&json=1&page_size=${limit}`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': `CosmeTantei/1.0 (${SITE_URL}; ${contactEmail()})`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!res.ok) return [];

    // 本文の読み込みもタイムアウトの対象にする（clearTimeout は finally）
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

      const labelText = p.ingredients_text_ja || p.ingredients_text;
      const label = labelProductFields(parseIngredientLabel(typeof labelText === 'string' ? labelText : ''));
      const { ingredients } = label;

      const hasIngredients = ingredients.length > 0;
      const product: Product = {
        id: `obf_${barcode || Math.random().toString(36).substring(2, 9)}`,
        name,
        brand,
        country: 'JP',
        category: 'other',
        barcode,
        // 有効成分だけでは全成分がわからないため、その他の成分が無ければ医薬部外品の項目も使わない
        ...(hasIngredients && label),
        labelFormat: LABEL_FORMAT,
        ingredients: hasIngredients ? ingredients : ['成分情報はオンラインマーケットプレイスより探索'],
        descriptionJa: p.generic_name_ja || p.generic_name || `${brand}のコスメアイテム`,
        amazonSearchUrl: buildAmazonAffiliateUrl(brand, name),
        isEstimatedFromMarketplaces: !hasIngredients,
        ingredientSource: hasIngredients ? 'open_beauty_facts' : undefined,
      };

      if (isActualCosmeticProduct(product)) {
        addProductToDynamicCache(product);
        results.push(product);
      }
    }

    await rememberVerifiedProducts(results);
    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}
