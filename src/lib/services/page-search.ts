import 'server-only';
import { Product } from '../types';
import { runWebSearch, WebSearchItem, WebSearchProvider } from '../server/cloudflare';
import { isPlainLabelText } from '../utils/safe-text';
import { CONTACT_PATTERN, isInstructionLike, PERSONAL_PATTERN } from './research-guards';

/**
 * Web リサーチの検索（web-research.ts）。商品名だけの検索語を作り、Web 検索し、読むページを選ぶ
 */

export const SEARCH_PROVIDERS: WebSearchProvider[] = ['exa', 'linkup'];
export const SEARCH_RESULT_LIMIT = 5;
const MAX_PAGES_TO_READ = 3;

// ---------- 検索語 ----------

/** 検索の依頼文（「〜の成分を教えて」等）。商品名の後ろから取り除く */
const REQUEST_SUFFIX =
  /(?:の|について)?(?:全成分|成分表示?|成分|原材料)?(?:を|は|が)?(?:教えて(?:ください|下さい)?|調べて(?:ください|下さい)?|知りたい(?:です)?|検索して(?:ください|下さい)?|見せて(?:ください|下さい)?|ありますか|何ですか|なに)?[。．.!！?？\s]*$/;
const MAX_PRODUCT_QUERY_LENGTH = 40;
const MAX_PRODUCT_QUERY_WORDS = 8;

/**
 * 利用者の入力から、Web 検索に使ってよい「商品名」だけを取り出す。商品名と言えない入力は null（検索しない）
 * - 依頼の言い回しを除き、短い名詞句だけを残す
 * - 文になっているもの、本人の症状、連絡先・番号を含むものは送らない
 */
export function toProductSearchQuery(text: string): string | null {
  const whole = text.normalize('NFKC');
  if (CONTACT_PATTERN.test(whole)) return null;
  let q = whole.replace(/\s+/g, ' ').trim();
  q = q.replace(REQUEST_SUFFIX, '').trim();
  if (!q || q.length < 2 || q.length > MAX_PRODUCT_QUERY_LENGTH) return null;
  if (/[。!！?？\n、]/.test(q)) return null;
  if (q.split(' ').length > MAX_PRODUCT_QUERY_WORDS) return null;
  if (PERSONAL_PATTERN.test(q) || CONTACT_PATTERN.test(q)) return null;
  if (isInstructionLike(q) || !isPlainLabelText(q)) return null;
  return q;
}

// ---------- 検索 ----------

/**
 * Web 検索（Exa → 失敗・0件なら Linkup）。両方だめなら null
 * accept を渡すと、それに合うページだけを残す（合うページが無ければ次のプロバイダーを試す）
 */
export async function webSearch(
  query: string,
  limit = SEARCH_RESULT_LIMIT,
  accept?: (url: string) => boolean,
  providers: WebSearchProvider[] = SEARCH_PROVIDERS
): Promise<{ provider: WebSearchProvider; items: WebSearchItem[] } | null> {
  let searched = false;
  for (const provider of providers) {
    const found = await runWebSearch(query, provider, limit);
    if (found) searched = true;
    const items = found && accept ? found.filter((i) => accept(i.url)) : found;
    // 読めるページが1件も無ければ（Amazon・SNS だけ等）次のプロバイダーを試す
    if (items && pickPagesToRead(items).length > 0) return { provider, items };
  }
  // accept に合うページが無かっただけなら、検索の失敗ではない
  return accept && searched ? { provider: providers[0], items: [] } : null;
}

/** 検索結果一覧のページ（複数の店・商品が混ざり、店名・商品名を取り違えやすい） */
const SKIP_PATH_PATTERN = /^\/search(\/|$)|\/search(\.php|\.html?)?$/i;
/** 読んでも製品の成分表示が得られないページ（検索結果一覧・SNS・動画・Amazon は読み込みを拒否されやすい） */
const SKIP_HOST_PATTERN =
  /(^|\.)(search\.kakaku\.com|search\.rakuten\.co\.jp|instagram\.com|x\.com|twitter\.com|facebook\.com|tiktok\.com|youtube\.com|youtu\.be|amazon\.[a-z.]+|pinterest\.[a-z.]+)$/;

/** URL を比較用に正規化する（フラグメント・末尾のスラッシュ・ホストの大文字小文字の違いを無視） */
export function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.hash = '';
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return null;
  }
}

/** 検索結果から読むページを選ぶ（検索順を保ち、読めないページと重複を除く） */
export function pickPagesToRead(items: WebSearchItem[], max = MAX_PAGES_TO_READ): string[] {
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const norm = normalizeUrl(item.url);
    if (!norm || seen.has(norm)) continue;
    const { hostname, pathname } = new URL(item.url);
    if (SKIP_HOST_PATTERN.test(hostname.toLowerCase()) || SKIP_PATH_PATTERN.test(pathname)) continue;
    // 正規化した URL を使う（空白・制御文字はエンコードされ、プロンプトに余計な文字が入らない）
    const href = new URL(item.url).href;
    if (/\s/.test(href)) continue;
    seen.add(norm);
    picked.push(href);
    if (picked.length >= max) break;
  }
  return picked;
}

/** 製品を Web で調べるときの商品名（ブランド＋商品名、容量を除く）。商品名と言えなければ null */
export function productSearchQuery(product: Pick<Product, 'brand' | 'name'>): string | null {
  const name = product.name.normalize('NFKC').replace(/\d+(\.\d+)?\s*(ml|g|l)\b/gi, '').trim();
  // 「ちふれ・CHIFURE」「ちふれ化粧品 / ちふれ」のような複数の表記は、最初の表記だけ
  const brand = product.brand.normalize('NFKC').split(/[・･/／]/)[0].trim();
  const full = !brand || name.includes(brand) ? name : `${brand} ${name}`;
  // 長い商品名は先頭の語だけにする（検索結果の製品の確認は呼び出し側で行う）
  return toProductSearchQuery(full) ?? toProductSearchQuery(full.split(/\s+/).slice(0, 4).join(' '));
}
