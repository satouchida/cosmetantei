import { COSMETICS_DATABASE, addProductToDynamicCache, isShareable, rememberVerifiedProducts } from '../data/cosmetics-db';
import { Product } from '../types';
import { buildAmazonAffiliateUrl } from './amazon-affiliate';
import { LABEL_FORMAT, LABEL_LIMITS, hasStaleLabel, labelProductFields, parseIngredientLabel } from '../analyzer/label-parser';
import { cacheGetJSON, cachePutJSON } from '../server/cloudflare';

/** Open Beauty Facts の写真の URL：https で、OBF の画像サーバーのものだけ。それ以外は使わない */
function obfImageUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    const u = new URL(raw);
    const plain = u.protocol === 'https:' && !u.username && !u.password && !u.port;
    return plain && /(^|\.)openbeautyfacts\.org$/.test(u.hostname) ? u.href : undefined;
  } catch {
    return undefined;
  }
}
import { researchBarcode, RESEARCH_FAIL_TTL_SECONDS, UNTRUSTED_ONLY_TTL_SECONDS } from './web-research';
import { mayRememberFailure } from '../server/usage';
import { ETHANOL_IN_LABEL } from './label-reader';
import { contactEmail, SITE_URL } from '../site';
import {
  searchCosmeticsLive,
  searchCosmeticsLiveWithCloseMatches,
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
  searchCosmeticsLiveWithCloseMatches,
  searchOpenBeautyFacts,
  isGreetingOrConsultation,
  getServicePurposeExplanation,
  isActualCosmeticProduct,
  isNonCosmeticSearchQuery,
  isGenericCosmeticTerm,
  getDisplayBrand,
};

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
/** 自動の保存で結び付けた JAN コード：保存した製品の一覧と同じ 30 日（cosmetics-db の VERIFIED_TTL_SECONDS） */
const LINKED_BARCODE_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * メモリの製品を、その製品のバーコードで照合してよいか。Yahoo! の商品説明から作った製品（shop_yahoo）のバーコードは
 * 出品者1人が書いた値なので照合に使わない（Open Beauty Facts より先に読まれ、別の製品のバーコードでも出てしまう）。
 * その JAN コードは、2つのストアと Open Beauty Facts の確認を通ったときだけ linkBarcode が結び付ける
 */
function matchesOwnBarcode(p: Product, cleanCode: string, cleanNoZero: string): boolean {
  if (!p.barcode || p.ingredientSource === 'shop_yahoo') return false;
  const pCode = p.barcode.replace(/[^0-9]/g, '');
  return !!pCode && (pCode === cleanCode || pCode.replace(/^0+/, '') === cleanNoZero);
}

/**
 * 保存済みの製品だけからバーコードで探す（メモリ・KV。Open Beauty Facts・Web には問い合わせない。費用なし）。
 * お店の商品の JAN コードから、確かめた成分の製品を見つけるのに使う
 */
export async function findSavedByBarcode(barcode: string): Promise<Product | null> {
  const cleanCode = barcode.trim().replace(/[^0-9]/g, '');
  if (!BARCODE_PATTERN.test(cleanCode)) return null;
  const cleanNoZero = cleanCode.replace(/^0+/, '');
  const local = COSMETICS_DATABASE.find((p) => matchesOwnBarcode(p, cleanCode, cleanNoZero));
  if (local) return local;
  const saved = await cacheGetJSON<Product>(`barcode:v2:${cleanCode}`);
  return saved && isShareable(saved) && !hasStaleLabel(saved) ? saved : null;
}

/**
 * Open Beauty Facts に、そのバーコードの製品が無いと分かったときだけ true（費用なし）。
 * 問い合わせに失敗した・答えが分からないときは false（無いと決めない）
 */
async function unknownToOpenBeautyFacts(cleanCode: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`https://world.openbeautyfacts.org/api/v2/product/${cleanCode}.json?fields=code`, {
      headers: { 'User-Agent': `CosmeTantei/1.0 (${SITE_URL}; ${contactEmail()})`, Accept: 'application/json' },
      signal: controller.signal,
    });
    // 無い製品は 404 と status: 0 で返る
    if (!res.ok && res.status !== 404) {
      await res.body?.cancel();
      return false;
    }
    const data = (await res.json()) as { status?: unknown };
    return data.status === 0;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * JAN コードを、保存した製品に結び付ける（バーコードの読み取りで、費用なしに見つかるように。自動の保存で使う）。
 * そのコードで見つかる製品がすでにあるとき・Open Beauty Facts にその製品があるとき（無いと確かめられないときも）は、
 * 何もしない（保存した結び付けは Open Beauty Facts より先に読まれるので、本当の製品を隠さないように）
 */
export async function linkBarcode(barcode: string, product: Product): Promise<boolean> {
  const cleanCode = barcode.trim().replace(/[^0-9]/g, '');
  if (!BARCODE_PATTERN.test(cleanCode) || !isShareable(product)) return false;
  if (await findSavedByBarcode(cleanCode)) return false;
  if (!(await unknownToOpenBeautyFacts(cleanCode))) return false;
  await cachePutJSON(`barcode:v2:${cleanCode}`, product, LINKED_BARCODE_TTL_SECONDS);
  return true;
}

/**
 * Open Beauty Facts でバーコードの製品を取る（KV・メモリのキャッシュは見ない・書かない）。
 * 見つからなければ null、通信の失敗は undefined。lookupByBarcode と、毎日の調べ直し（seeding.ts）が使う
 */
export async function fetchObfProduct(cleanCode: string): Promise<Product | null | undefined> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(`https://world.openbeautyfacts.org/api/v2/product/${cleanCode}.json`, {
      headers: {
        'User-Agent': `CosmeTantei/1.0 (${SITE_URL}; ${contactEmail()})`,
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
          // 長すぎるものは切らずに使わない（labelProductFields と同じ。末尾の防腐剤・香料が抜けるので）
          if (ingredients.length > LABEL_LIMITS.ingredients) ingredients = [];
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
          // Open Beauty Facts の画像サーバーの https の写真だけ（ほかのサイトを利用者のブラウザから読ませない）
          imageUrl: obfImageUrl(p.image_front_url || p.image_url),
          // 有効成分だけでは全成分がわからないため、その他の成分が無ければ医薬部外品の項目も使わない
          ...(label.ingredients.length > 0 && label),
          labelFormat: LABEL_FORMAT,
          ingredients: ingredients,
          descriptionJa: `バーコード（JAN: ${cleanCode}）から取得した最新商品データです`,
          fragranceFree: !labelled.some(
            (i) => /香料|fragrance|parfum/i.test(i)
          ),
          alcoholFree: !labelled.some(
            (i) => ETHANOL_IN_LABEL.test(i)
          ),
          amazonSearchUrl: buildAmazonAffiliateUrl(brand, productName),
          isEstimatedFromMarketplaces: isEstimated,
          ingredientSource: isEstimated ? undefined : 'open_beauty_facts',
        };

        return product;
      }
    }
    // 見つからない（404・status 0）。ほかの応答は一時的な失敗
    return res.ok || res.status === 404 ? null : undefined;
  } catch {
    return undefined;
  }
}

/**
 * バーコードで製品を探す（保存済み → Open Beauty Facts → Web リサーチ）。
 * webResearch: false なら、有料の Web リサーチをしない（お店の JAN コードから無料で探すとき。src/lib/services/seeding.ts）
 */
export async function lookupByBarcode(barcode: string, { webResearch = true }: { webResearch?: boolean } = {}): Promise<Product | null> {
  const cleanCode = barcode.trim().replace(/[^0-9]/g, '');
  if (!BARCODE_PATTERN.test(cleanCode)) return null;

  // 1. 動的キャッシュ内を検索
  const cleanNoZero = cleanCode.replace(/^0+/, '');
  const localMatch = COSMETICS_DATABASE.find((p) => matchesOwnBarcode(p, cleanCode, cleanNoZero));

  if (localMatch) {
    return localMatch;
  }

  // 2. KV に保存済みのバーコード照合結果
  // v2: Google 検索グラウンディングで推定した v1 の結果は使わない
  const kvKey = `barcode:v2:${cleanCode}`;
  // 共有しない製品（信頼しないサイトの製品。TRUSTED_SITES_MODE=enforce の前に保存したもの）は使わない
  const saved = await cacheGetJSON<Product>(kvKey);
  const stored = saved && isShareable(saved) ? saved : null;
  if (stored && !hasStaleLabel(stored)) {
    addProductToDynamicCache(stored);
    return stored;
  }
  // 直近で見つからなかったバーコードは、外部API・Gemini への再問い合わせを避ける
  if (await cacheGetJSON<boolean>(`${kvKey}:miss`)) return null;
  // 少し前に、信頼しないサイトでしか見つからなかったバーコード（保存できない結果のために、何度も調べない）
  if (await cacheGetJSON<boolean>(`${kvKey}:untrusted`)) return null;
  // 少し前に Web リサーチが一時的に失敗したバーコードは、しばらく調べ直さない（失敗に何度も費用をかけない）
  const recentlyFailed = await cacheGetJSON<boolean>(`${kvKey}:fail`);

  // 3. Open Beauty Facts API 問い合わせ (4秒タイムアウト付き)
  const fromObf = await fetchObfProduct(cleanCode);
  if (fromObf) {
    addProductToDynamicCache(fromObf);
    await cachePutJSON(kvKey, fromObf, BARCODE_TTL_SECONDS);
    await rememberVerifiedProducts([fromObf]);
    return fromObf;
  }

  // Open Beauty Facts で取り直せなかったときは、古い分け方でも保存済みの製品を返す（失うよりよい。次回また取り直す）
  if (stored) return stored;

  // 4. Web リサーチ：バーコードで検索し、同じバーコードが書かれたページの製品だけを採用する
  //    （調べないときは「見つからない」の印も付けない。調べれば見つかるかもしれない）
  if (!webResearch || recentlyFailed) return null;
  const webProduct = await researchBarcode(cleanCode);
  if (webProduct) {
    // 全員で共有するのは、信頼するサイトの製品だけ（それ以外は調べた本人にだけ返す）
    if (isShareable(webProduct)) await cachePutJSON(kvKey, webProduct, BARCODE_TTL_SECONDS);
    else await cachePutJSON(`${kvKey}:untrusted`, true, UNTRUSTED_ONLY_TTL_SECONDS);
    return webProduct;
  }
  // 一時的な失敗（検索・Gemini のエラー）は「見つからない」として保存しない。しばらく調べ直さない印だけ付ける
  // （この利用者が自分の1日の上限に達して失敗したときは付けない）
  if (webProduct === undefined) {
    if (mayRememberFailure()) await cachePutJSON(`${kvKey}:fail`, true, RESEARCH_FAIL_TTL_SECONDS);
    return null;
  }

  // 断られた呼び出しがあった調べものの結果は、全員分の「見つからない」にしない
  if (mayRememberFailure()) await cachePutJSON(`${kvKey}:miss`, true, BARCODE_MISS_TTL_SECONDS);
  return null;
}
