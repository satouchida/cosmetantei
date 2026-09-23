import { COSMETICS_DATABASE, addProductToDynamicCache } from '../data/cosmetics-db';
import { Product } from '../types';
import { buildAmazonAffiliateUrl } from './amazon-affiliate';
import {
  searchCosmeticsLive,
  searchOpenBeautyFacts,
  searchGoogleGroundedGemini,
  synthesizeDynamicCandidate,
  normalizeSearchString,
  isGreetingOrConsultation,
  getServicePurposeExplanation,
  isActualCosmeticProduct,
  isNonCosmeticSearchQuery,
  isGenericCosmeticTerm,
  judgeGenericOrBrandWithGemini,
  getDisplayBrand,
} from './live-cosmetics-service';

export {
  normalizeSearchString,
  searchCosmeticsLive,
  searchOpenBeautyFacts,
  searchGoogleGroundedGemini,
  isGreetingOrConsultation,
  getServicePurposeExplanation,
  isActualCosmeticProduct,
  isNonCosmeticSearchQuery,
  isGenericCosmeticTerm,
  judgeGenericOrBrandWithGemini,
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
 * - 0件の場合は動的推測候補を生成
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

  const results = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.item);

  if (results.length >= limit) {
    return results.slice(0, limit);
  }

  // キャッシュ未ヒットや件数不足の場合：実在するコスメのみを返却（架空商品は捏造しない）
  const enriched = [...results];

  if (isGreetingOrConsultation(cleanInput)) {
    const cached = COSMETICS_DATABASE.filter(isActualCosmeticProduct);
    if (cached.length > 0) return cached.slice(0, limit);
    return [
      synthesizeDynamicCandidate('キュレル 泡洗顔料'),
      synthesizeDynamicCandidate('ちふれ 口紅'),
      synthesizeDynamicCandidate('無印良品 化粧水'),
    ].slice(0, limit);
  }

  // 実在コスメキャッシュから追加で探索
  const cached = COSMETICS_DATABASE.filter(isActualCosmeticProduct);
  for (const c of cached) {
    if (enriched.length >= limit) break;
    if (!enriched.some((p) => p.id === c.id || p.name === c.name)) {
      const b = normalizeSearchString(c.brand);
      const n = normalizeSearchString(c.name);
      if (b.includes(fullNormalizedQuery) || n.includes(fullNormalizedQuery) || fullNormalizedQuery.includes(b)) {
        enriched.push(c);
      }
    }
  }

  // もし件数が不足している場合、動的コスメ合成から補完
  if (enriched.length < limit && cleanInput.length >= 1) {
    let varIdx = 0;
    while (enriched.length < limit && varIdx < limit * 3) {
      const matched = synthesizeDynamicCandidate(cleanInput, varIdx);
      if (isActualCosmeticProduct(matched) && !enriched.some((p) => p.name === matched.name)) {
        enriched.push(matched);
      }
      varIdx++;
    }
  }

  return enriched.filter(isActualCosmeticProduct).slice(0, limit);
}

/**
 * バーコード（JANコード・EAN・UPC）から製品情報を検索する
 * 1. 動的キャッシュを検索
 * 2. Open Beauty Facts API へ問い合わせ
 * 3. Google Search Grounding で最新の成分・商品情報をWeb検索
 */
export async function lookupByBarcode(barcode: string): Promise<Product | null> {
  const cleanCode = barcode.trim().replace(/[^0-9]/g, '');
  if (!cleanCode) return null;

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

  // 2. Open Beauty Facts API 問い合わせ (4秒タイムアウト付き)
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

        let ingredients: string[] = [];
        if (p.ingredients_text_ja) {
          ingredients = p.ingredients_text_ja
            .split(/[,、・\n\r/]/)
            .map((s: string) => s.trim())
            .filter(Boolean);
        } else if (p.ingredients_text) {
          ingredients = p.ingredients_text
            .split(/[,、・\n\r/]/)
            .map((s: string) => s.trim())
            .filter(Boolean);
        } else if (Array.isArray(p.ingredients)) {
          ingredients = p.ingredients
            .map((ing: any) => ing.text || ing.id?.replace('en:', '') || '')
            .filter(Boolean);
        }

        const isEstimated = ingredients.length === 0;
        if (isEstimated) {
          ingredients = ['成分情報はGoogle検索およびオンラインマーケットプレイスより補完'];
        }

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
          ingredients: ingredients,
          descriptionJa: `バーコード（JAN: ${cleanCode}）から取得した最新商品データです`,
          fragranceFree: !ingredients.some(
            (i) => /香料|fragrance|parfum/i.test(i)
          ),
          alcoholFree: !ingredients.some(
            (i) => /エタノール|alcohol denat/i.test(i)
          ),
          amazonSearchUrl: buildAmazonAffiliateUrl(brand, productName),
          isEstimatedFromMarketplaces: isEstimated,
        };

        addProductToDynamicCache(product);
        return product;
      }
    }
  } catch (err) {
    // ignore
  }

  // 3. Google Search Grounding でバーコード番号から商品を探索
  try {
    const googleResults = await searchGoogleGroundedGemini(`JANコード ${cleanCode}`);
    if (googleResults.length > 0) {
      const p = googleResults[0];
      p.barcode = cleanCode;
      addProductToDynamicCache(p);
      return p;
    }
  } catch (err) {
    // ignore
  }

  return null;
}
