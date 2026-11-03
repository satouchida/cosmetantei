/** お店の商品名に付く、商品の名前ではない語（検索語を作るときだけ外す。表示する名前は変えない） */
const LISTING_NOISE =
  /【[^】]*】|［[^］]*］|\[[^\]]*\]|＜[^＞]*＞|<[^>]*>|★|☆|送料無料|公式(?:ショップ|ストア)?|正規品|あす楽|期間限定|ポイント\s*\d+\s*倍|\d+\s*%\s*OFF/gi;

/** 商品名から飾りを外す（検索語と、コスメかどうかの確認にだけ使う。表示する名前は変えない） */
export function withoutListingNoise(name: string): string {
  return name.normalize('NFKC').replace(LISTING_NOISE, ' ').replace(/\s+/g, ' ').trim();
}

/** 表示で外す飾り（色番号の［01］などは商品の名前の一部なので残す） */
const DISPLAY_NOISE =
  /【[^】]*】|＜[^＞]*＞|<[^>]*>|★|☆|送料無料|公式(?:ショップ|ストア)?|正規品|あす楽|期間限定|ポイント\s*\d+\s*倍|\d+\s*%\s*OFF/gi;

/**
 * お店の商品名を表示する形にする：飾り（【公式】・送料無料など）と、先頭のブランド名（上の行に出すので）を外す。
 * 何も残らなければ元の名前
 */
export function displayListingName(name: string, brand = ''): string {
  let s = name.normalize('NFKC').replace(DISPLAY_NOISE, ' ').replace(/\s+/g, ' ').trim();
  // 「ちふれ・CHIFURE」のように書き方が複数あるブランドは、最初の書き方
  const b = brand.normalize('NFKC').split(/[・/／]/)[0].trim();
  // ブランド名の後に区切り（空白・／など）があるときだけ（「セザンヌ化粧品」の「セザンヌ」・型番「ABC-123」は外さない）。
  // 残りが色の印（[01]）だけなら外さない
  const rest = b && s.toLowerCase().startsWith(b.toLowerCase()) ? s.slice(b.length) : '';
  if (/^[\s/／|｜・:：]+[^\s[\]]/.test(rest) && !/^[\s/／|｜・:：]+\[[^\]]*\]$/.test(rest)) s = rest.replace(/^[\s/／|｜・:：]+/, '');
  return s || name.trim();
}
