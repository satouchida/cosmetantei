/** お店の商品名に付く、商品の名前ではない語（検索語を作るときだけ外す。表示する名前は変えない） */
const LISTING_NOISE =
  /【[^】]*】|［[^］]*］|\[[^\]]*\]|＜[^＞]*＞|<[^>]*>|★|☆|送料無料|公式(?:ショップ|ストア)?|正規品|あす楽|期間限定|ポイント\s*\d+\s*倍|\d+\s*%\s*OFF/gi;

/** 商品名から飾りを外す（検索語と、コスメかどうかの確認にだけ使う。表示する名前は変えない） */
export function withoutListingNoise(name: string): string {
  return name.normalize('NFKC').replace(LISTING_NOISE, ' ').replace(/\s+/g, ' ').trim();
}
