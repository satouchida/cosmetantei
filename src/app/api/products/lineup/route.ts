import { NextRequest, NextResponse } from 'next/server';
import { COSMETICS_DATABASE, hydrateVerifiedProducts } from '@/lib/data/cosmetics-db';
import { getClientIp, isRateLimited, RATE_LIMIT_MESSAGE_JA } from '@/lib/server/cloudflare';
import { withUsageRoute } from '@/lib/server/usage';
import { buildBrandIndex, findBrand } from '@/lib/services/brand-suggest';
import { brandLineup } from '@/lib/services/shop-lineup';

/**
 * ブランドの製品一覧（楽天市場・Yahoo!ショッピングの商品検索）。入力途中の候補で、ブランドが決まったときに1回呼ぶ
 * - brand は候補に出したブランド名だけ（一覧のブランド、または調べた製品のブランド）。それ以外は 400
 * - 結果はサーバーに保存しない。ブラウザがそのページの間だけ持ち、残りの語で絞り込む
 * docs/walkthroughs/2026-10-15-shop-lineups.md
 */
const MAX_BRAND_LENGTH = 60;

async function handleGet(request: NextRequest) {
  if (await isRateLimited('search', getClientIp(request.headers))) {
    return NextResponse.json({ error: RATE_LIMIT_MESSAGE_JA, products: [], credits: [] }, { status: 429 });
  }
  const name = (new URL(request.url).searchParams.get('brand') || '').trim().slice(0, MAX_BRAND_LENGTH);
  await hydrateVerifiedProducts();
  const brand = name && findBrand(name, buildBrandIndex(COSMETICS_DATABASE));
  if (!brand) {
    return NextResponse.json({ products: [], credits: [] }, { status: 400 });
  }
  const lineup = await brandLineup(brand);
  // お店の API が失敗して何も無いときは 503（ブラウザは少し待ってから取り直す。空の一覧として覚えさせない）
  if (lineup.incomplete && lineup.products.length === 0) {
    return NextResponse.json({ products: [], credits: [] }, { status: 503, headers: { 'Retry-After': '30' } });
  }
  // ブラウザ自身の HTTP キャッシュだけを許す（共有のキャッシュには置かせない。楽天の規約）
  return NextResponse.json(
    { brand: brand.entry.name, products: lineup.products, credits: lineup.credits },
    { headers: { 'Cache-Control': 'private, max-age=600' } }
  );
}

export const GET = withUsageRoute('product_lineup', handleGet);
