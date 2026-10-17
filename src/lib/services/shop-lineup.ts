import 'server-only';
import { Product, PriceApiCredit, SHOP_ID_PREFIX } from '../types';
import { IndexedBrand, textHasBrand } from './brand-suggest';
import { isActualCosmeticProduct } from './live-cosmetics-service';
import { NOT_SINGLE_ITEM } from './price-service';
import { rakutenItemSearch, ShopItem, yahooItemSearch } from './shop-apis';
import { shopLink } from './shops';
import { searchKey } from '../search/product-match';
import { productSearchQuery } from './web-research';

/**
 * ブランドの製品一覧を、楽天市場・Yahoo!ショッピングの商品検索から作る（docs/walkthroughs/2026-10-15-shop-lineups.md）
 * - 検索語はブランド名だけ。利用者が入力した文はお店に送らない
 * - 結果はサーバーに保存しない（KV・メモリのキャッシュ・共有の製品キャッシュのどれにも入れない）。楽天の規約
 *   （第10条 (9)：不特定多数と共有できる場所に保存しない）による。ブラウザがそのページの間だけ持つ
 * - 商品名は API が返したまま（第10条 (7)：改変しない）
 * - 商品ページへのリンクは shopLink で作る。楽天は楽天アフィリエイトのリンク（第3条・第10条 (4)(5)：楽天アフィリエイト
 *   以外で収益を得ない）。楽天の ID が無ければリンクは出さない
 * - 成分はここでは分からない。選ばれたら JAN コード、無ければ名前で調べる（チャットの lookup_product）
 */

export interface BrandLineup {
  products: Product[];
  /** 表示するクレジット（使った API） */
  credits: PriceApiCredit[];
  /** キーがあるのに、お店の API の呼び出しが失敗した・回数の上限で呼ばなかった */
  incomplete: boolean;
}

const MAX_LINEUP = 40;

/** お店の商品名に付く、商品の名前ではない語（検索語を作るときだけ外す。表示する名前は変えない） */
const LISTING_NOISE =
  /【[^】]*】|［[^］]*］|\[[^\]]*\]|＜[^＞]*＞|<[^>]*>|★|☆|送料無料|公式(?:ショップ|ストア)?|正規品|あす楽|期間限定|ポイント\s*\d+\s*倍|\d+\s*%\s*OFF/gi;

/** 商品名から飾りを外す（検索語と、コスメかどうかの確認にだけ使う。表示する名前は変えない） */
function withoutListingNoise(name: string): string {
  return name.normalize('NFKC').replace(LISTING_NOISE, ' ').replace(/\s+/g, ' ').trim();
}


function toProduct(item: ShopItem, brand: IndexedBrand): Product {
  return {
    id: `${SHOP_ID_PREFIX}${item.shopId}_${item.code}`.slice(0, 120),
    name: item.name,
    brand: brand.entry.name,
    country: 'JP',
    category: 'other',
    ...(item.janCode && { barcode: item.janCode }),
    // 候補には写真と価格を出し、商品名（【公式】・送料無料などが付く）は出さない。お店の名前も出さない
    ...(item.imageUrl && { imageUrl: item.imageUrl }),
    ...(item.priceYen && { shopPrice: { yen: item.priceYen, taxIncluded: item.taxIncluded } }),
    ...linkOf(item),
    ingredients: [],
    isEstimatedFromMarketplaces: true,
  };
}

/** 商品ページへのリンク。楽天は楽天アフィリエイトのリンクのときだけ出す（そのままの楽天のページへのリンクは出さない） */
function linkOf(item: ShopItem): { shopLink?: Product['shopLink'] } {
  const link = shopLink(item.shopId, item.url);
  return item.shopId === 'rakuten' && !link.sponsored ? {} : { shopLink: link };
}

/** このブランドの商品か：Yahoo! はブランド名（親ブランドを含む）、楽天は商品名で確かめる */
function itemIsOfBrand(item: ShopItem, brand: IndexedBrand): boolean {
  return item.brands.some((b) => textHasBrand(b, brand)) || textHasBrand(item.name, brand);
}

export async function brandLineup(brand: IndexedBrand): Promise<BrandLineup> {
  // 1つのアプリ ID に1秒1回までなので、楽天と Yahoo! は別々の ID。並べて呼んでよい
  const [yahoo, rakuten] = await Promise.all([yahooItemSearch(brand.entry.name), rakutenItemSearch(brand.entry.name)]);
  const credits: PriceApiCredit[] = [];
  const products: Product[] = [];
  const seenJan = new Set<string>();
  const seenName = new Set<string>();
  // JAN コードのある Yahoo! を先に（選んだときに JAN コードで成分を調べられる）
  for (const [shop, items] of [
    ['yahoo', yahoo],
    ['rakuten', rakuten],
  ] as const) {
    if (!items) continue;
    let used = false;
    for (const item of items) {
      if (products.length >= MAX_LINEUP) break;
      if (!itemIsOfBrand(item, brand) || NOT_SINGLE_ITEM.test(item.name)) continue;
      const nameKey = searchKey(item.name);
      if (seenName.has(nameKey) || (item.janCode && seenJan.has(item.janCode))) continue;
      const product = toProduct(item, brand);
      // 「公式」「送料無料」などは検索語の除外に当たるので、外した名前で確かめる
      if (!isActualCosmeticProduct({ ...product, name: withoutListingNoise(item.name) })) continue;
      seenName.add(nameKey);
      if (item.janCode) seenJan.add(item.janCode);
      products.push(product);
      used = true;
    }
    if (used) credits.push(shop);
  }
  return { products, credits, incomplete: yahoo === null || rakuten === null };
}

/** お店の商品検索の製品の成分を調べるための検索語（ブランド名と、飾りを外した商品名） */
export function shopProductQuery(product: Pick<Product, 'brand' | 'name'>): string | null {
  const name = withoutListingNoise(product.name);
  return name ? productSearchQuery({ brand: product.brand, name }) : null;
}
