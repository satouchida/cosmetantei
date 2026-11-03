import 'server-only';
import { categoryFromText } from '../analyzer/product-category';

/**
 * 決まったサイトの製品ページを、Gemini を使わずにコードで読む（オーナーの判断 2026-11-03）。
 * Gemini は全成分表示の書き写しを「著作物の引用に似ている」（RECITATION）として止めることが多い。
 * これらのサイトは全成分をページの HTML に載せているので、決まった場所から取り出す（費用もかからない）。
 * - 読むのは robots.txt で許された製品ページだけ（2026-11-03 に確かめた）。それ以外の URL は Gemini で読む
 * - 返すのは Gemini の読み取りと同じ形の項目。成分の確かめ方（長さ・件数・書式）は readProductPages で同じにする
 * - 色・種類ごとに成分が違う製品は、最初の色の成分と、その色の名前（分かれば）を使う。
 *   色ごとの成分がページにあるサイト（キャンメイク）は、調べた商品名にある色を使う
 * - 読めなかった（通信・形が変わった）ら null。呼び出し側は Gemini で読む
 */

/** 読み取った項目（Gemini の読み取りの JSON と同じ名前） */
export type SiteItem = {
  brand: string;
  name: string;
  category: string;
  ingredients: string[];
  activeIngredients: string[];
  quasiDrug: boolean;
  ingredientsFoundOnPage: boolean;
  barcode: string;
};

const FETCH_TIMEOUT_MS = 8_000;
/** これより大きいページは読まない（製品ページは 0.3MB ほど） */
const MAX_HTML_LENGTH = 2_000_000;
const USER_AGENT = 'cosmetantei/1.0 (+https://cosmetantei.app)';

interface SiteReader {
  /** 読む製品ページか。返すのは取りに行く URL（読む場所が同じなら、問い合わせの部分を外す） */
  pageUrl(u: URL): string | null;
  /** target: 調べた商品名（色を選ぶのに使う。無ければ最初の色） */
  read(html: string, target: string): SiteItem | null;
}

const READERS: Record<string, SiteReader> = {
  // LIPS：製品・色の製品ページ。成分は「成分情報」の欄に1成分ずつ（全成分の順）
  'lipscosme.com': {
    pageUrl: (u) => (/^\/(products|product_patterns)\/\d+\/?$/.test(u.pathname) ? `https://lipscosme.com${u.pathname}` : null),
    read(html) {
      // 成分の欄が2つ以上ある（別の色・製品の成分が混ざる）ページは読まない（Gemini で読む）
      if ((html.match(/class="LipsModal (?:ProductElementsModal|ProductPatternElementsModal)"/g) ?? []).length !== 1) return null;
      const product = jsonLdProduct(html);
      const names = [...html.matchAll(/(?:ProductPatternElementsModal|ProductElementsModal)__element-name">([^<]*)</g)].map((m) =>
        decodeEntities(m[1])
      );
      if (!product || names.length === 0) return null;
      const category = typeof product.category === 'string' ? product.category : '';
      return item(product.name, brandName(product.brand), category, names.join('\n'));
    },
  },
  // 資生堂オンラインストア：「詳細情報」の色ごとの表の「成分」の行。色の名前は選ぶ欄の文字
  'www.shiseido.co.jp': {
    pageUrl: (u) =>
      /^\/sw\/onlinestore\/products\/[A-Za-z0-9]+\.html$/.test(u.pathname) ? `https://www.shiseido.co.jp${u.pathname}` : null,
    read(html) {
      const product = jsonLdProduct(html);
      const table = html.match(/<dl id="select-contents1"[\s\S]*?<\/dl>/)?.[0];
      const label = table?.match(/<span>成分<\/span>[\s\S]*?<div class="text__tertiary">([\s\S]*?)(?:<p\b|<\/div>)/)?.[1];
      if (!product || !label) return null;
      const variant = html.match(/<option value="select-contents1">([^<]*)<\/option>/)?.[1];
      const variants = (html.match(/<dl id="select-contents\d+"/g) ?? []).length;
      // 「ブランド｜商品名｜種類｜資生堂オンラインストア」の種類
      const kind = html.match(/<title>[^<|｜]*[|｜][^<|｜]*[|｜]([^<|｜]*)/)?.[1] ?? '';
      // バーコードは、色が1つの製品だけ（どの色のバーコードか分からないため）
      const sku = variants === 1 && typeof product.sku === 'string' ? product.sku : '';
      return item(variant ? decodeEntities(variant) : product.name, brandName(product.brand), decodeEntities(kind), textOf(label), sku);
    },
  },
  // @cosme SHOPPING：商品の表の「成分」の行（* は有効成分）と「JANコード」の行
  'www.cosme.com': {
    pageUrl: (u) => {
      const id = u.searchParams.get('product_id');
      return u.pathname === '/products/detail.php' && id && /^\d+$/.test(id)
        ? `https://www.cosme.com/products/detail.php?product_id=${id}`
        : null;
    },
    read(html) {
      const name = html.match(/<h1 itemprop="name"[^>]*>([^<]*)<\/h1>/)?.[1];
      const brand = html.match(/itemprop="brand"[^>]*>\s*<span itemprop="name">([^<]*)<\/span>/)?.[1];
      const label = html.match(/<dt>成分<\/dt>\s*<dd>([\s\S]*?)<\/dd>/)?.[1];
      if (!name || !brand || !label) return null;
      const jan = html.match(/<dt>JANコード<\/dt>\s*<dd>\s*<meta itemprop="sku" content="(\d{8,14})"/)?.[1] ?? '';
      // パンくず（「化粧水」など）から種類
      const crumbs = [...html.matchAll(/itemprop="name">([^<]{1,30})<\/span>/g)].map((m) => decodeEntities(m[1])).join(' ');
      return item(decodeEntities(name), decodeEntities(brand), crumbs, textOf(label), jan);
    },
  },
  // キャンメイク：色ごとの成分がページの colorGroups（JSON）にある（色の多い製品の多くで、色ごとに成分が違う）
  'www.canmake.com': {
    pageUrl: (u) => (/^\/item\/detail\/[a-z0-9-]+\/?$/.test(u.pathname) ? `https://www.canmake.com${u.pathname}` : null),
    read(html, target) {
      const name = html.match(/<h1 class="p-item-basic__name">([^<]*)<\/h1>/)?.[1];
      // 「商品名 | CANMAKE（キャンメイク）」のブランド
      const brand = html.match(/<title>[^<|｜]*[|｜]\s*([^<|｜]+)/)?.[1];
      // JSON の文字列には改行が入らないので、「];」の後の改行（か </script>）までが配列
      const json = html.match(/(?:const|let|var)\s+colorGroups\s*=\s*(\[[\s\S]*?\])\s*;\s*(?:\n|<\/script>)/)?.[1];
      if (!name || !brand || !json) return null;
      let groups: unknown;
      try {
        groups = JSON.parse(json);
      } catch {
        return null;
      }
      if (!Array.isArray(groups)) return null;
      const colors = groups.map((g) => {
        const c = (g ?? {}) as { item_color_name?: unknown; item_color_ingredients?: unknown };
        return {
          name: typeof c.item_color_name === 'string' ? c.item_color_name.trim() : '',
          label: typeof c.item_color_ingredients === 'string' ? c.item_color_ingredients.trim() : '',
        };
      });
      const product = decodeEntities(name).trim();
      // 調べた色を先に決める。その色の成分が無ければ、別の色の成分を返さない（Gemini で読む）
      const color = colorNamedIn(colors, target, product) ?? colors.find((c) => c.label);
      if (!color?.label) return null;
      // パンくず（「アイメイク」など）から種類
      const crumbs = [...html.matchAll(/class="c-breadcrumbs__item"><a [^>]*>([^<]{1,30})<\/a>/g)].map((m) => decodeEntities(m[1])).join(' ');
      // 色が1つでも色の名前を付ける（キャンメイクの商品名は「メタルックマスカラ [01]ブラック」の形）
      const full = color.name ? `${product} ${decodeEntities(color.name)}` : product;
      return item(full, decodeEntities(brand), `${crumbs} ${product}`, textOf(color.label));
    },
  },
};

/**
 * 調べた商品名（から商品名を外した残り）にある色。色の名前そのもの（「[01]ブラック」）が最優先、次に番号を除いた色の名前（長いほう。
 * 「スウィートブラック」と「ブラック」なら長いほう）。無ければ undefined
 */
function colorNamedIn<T extends { name: string }>(colors: T[], target: string, product: string): T | undefined {
  const squash = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  // 商品名にある語（「クリアラッシュ」の「クリア」）は色の指定ではないので、商品名を外した残りで探す
  const p = squash(product);
  const t = p ? squash(target).split(p).join(' ') : squash(target);
  let best: { color: T; score: number } | undefined;
  for (const color of colors) {
    const full = squash(color.name);
    if (!full) continue;
    const text = full.replace(/^\[[^\]]*\]/, '');
    const score = t.includes(full) ? 1000 + full.length : text.length >= 2 && t.includes(text) ? text.length : 0;
    if (score > 0 && (!best || score > best.score)) best = { color, score };
  }
  return best?.color;
}

/** コードで読めるページなら、その読み取り。読まないページは undefined */
function readerFor(url: string): { reader: SiteReader; fetchUrl: string } | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'https:' || !Object.hasOwn(READERS, u.hostname)) return undefined;
  const reader = READERS[u.hostname];
  const fetchUrl = reader.pageUrl(u);
  return fetchUrl ? { reader, fetchUrl } : undefined;
}

export function isSiteReadable(url: string): boolean {
  return readerFor(url) !== undefined;
}

/**
 * コードで読むページの、問い合わせの部分（?ref= など）を外した URL。出典として保存し、製品の ID もこれから作る
 * （同じページを別の URL で見つけても、同じ製品にする）。読まないページは undefined
 */
export function canonicalSiteUrl(url: string): string | undefined {
  return readerFor(url)?.fetchUrl;
}

/** ページをコードで読む。target は調べた商品名（色を選ぶ）。読まないページ・読めなかったページは null */
export async function readSitePage(url: string, target = ''): Promise<SiteItem | null> {
  const found = readerFor(url);
  if (!found) return null;
  try {
    const res = await fetch(found.fetchUrl, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ja' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    // 別のサイトへ転送されたページは読まない
    if (!res.ok || readerFor(res.url || found.fetchUrl)?.reader !== found.reader) return null;
    if (!(res.headers.get('content-type') ?? '').includes('text/html')) return null;
    if (Number(res.headers.get('content-length')) > MAX_HTML_LENGTH) {
      await res.body?.cancel();
      return null;
    }
    const html = await res.text();
    if (html.length > MAX_HTML_LENGTH) return null;
    const read = found.reader.read(html, target);
    if (!read) console.warn(`[site-read] ${JSON.stringify({ outcome: 'no_label', host: new URL(found.fetchUrl).hostname })}`);
    return read;
  } catch (err) {
    console.warn(`[site-read] ${JSON.stringify({ outcome: 'failed', host: new URL(found.fetchUrl).hostname, error: err instanceof Error ? err.name : 'error' })}`);
    return null;
  }
}

// ---------- 読み取りの部品 ----------

/** 成分表示の文字列を、読み取り（parseIngredientLabel）に渡せる形にする */
function item(name: string, brand: string, kind: string, label: string, barcode = ''): SiteItem | null {
  const cleaned = label
    // 資生堂の処方の番号（「マイカ <M104203-202>」）
    .replace(/<\s*[A-Z]\d{3,}(?:-\d+)?\s*>/g, ' ')
    // @cosme の印の説明の後半（「*は「有効成分」無表示は「その他の成分」」の後ろ）
    .replace(/無表示は「その他の成分」/g, ' ')
    .trim();
  const n = name.trim();
  const b = brand.trim();
  if (!n || !b || !cleaned) return null;
  return {
    brand: b,
    name: n,
    category: categoryFromText(`${kind} ${n}`) ?? 'other',
    ingredients: [cleaned],
    activeIngredients: [],
    quasiDrug: false,
    ingredientsFoundOnPage: true,
    // 検査数字の合う JAN/EAN だけ（お店の社内の番号をバーコードにしない）
    barcode: isValidGtin(barcode) ? barcode : '',
  };
}

/** ページの JSON-LD の Product（name は文字列のときだけ） */
function jsonLdProduct(html: string): { name: string; brand?: unknown; category?: unknown; sku?: unknown } | null {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }
    for (const o of Array.isArray(data) ? data : [data]) {
      if (o && typeof o === 'object' && (o as { '@type'?: unknown })['@type'] === 'Product') {
        const p = o as { name?: unknown; brand?: unknown; category?: unknown; sku?: unknown };
        if (typeof p.name === 'string') return { ...p, name: decodeEntities(p.name) };
      }
    }
  }
  return null;
}

function brandName(brand: unknown): string {
  if (typeof brand === 'string') return decodeEntities(brand);
  const name = brand && typeof brand === 'object' ? (brand as { name?: unknown }).name : undefined;
  return typeof name === 'string' ? decodeEntities(name) : '';
}

/** タグを外した文字列（<br> は改行） */
function textOf(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** JAN/EAN（8・13桁）の検査数字が合うか */
function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{13})$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((total, d, i) => total + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  reg: '®',
  copy: '©',
  trade: '™',
  hellip: '…',
  middot: '·',
  yen: '¥',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      // サロゲートの範囲は1文字にならない（壊れた文字を保存しない）
      return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : whole;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}
