import { CountryOrigin, Product } from './types';
import { CurrentUseEntry, isPersistable } from './current-use';
import { isValidProduct, MAX_ROUTINE_PRODUCTS } from './product-validation';
import { isPlainLabelText } from './utils/safe-text';
import { SITE_URL } from './site';

/**
 * マイルーティンの書き出し・読み込み（ブラウザ側。docs/plans/routine-image.md）
 * - 画像（PNG）のファイルの中のデータ（iTXt）: 3つのリストを成分つきで。自分のバックアップを元どおりに戻す
 * - QR コードのリンク（https://cosmetantei.app/#r=...）: ID・ブランド名・商品名だけ。SNS に投稿した画像からも読める。
 *   # より後ろはサーバーに送られない
 * - 入力・撮影した成分表示の製品は書き出さない（ブラウザに保存しないのと同じ）
 * - 読み込むデータは信頼できない入力として、製品ごとに確かめる（isValidProduct・普通の文字だけの名前・重複・件数）
 */

export interface RoutineSnapshot {
  badProducts: Product[];
  safeProducts: Product[];
  currentUse: CurrentUseEntry[];
}

/** PNG の中のデータのキーワード */
export const ROUTINE_PNG_KEYWORD = 'cosmetantei-routine';
const DATA_VERSION = 1;
/** ファイルの中のデータの上限（文字数）。成分つきの 60 製品でも十分に入る */
const MAX_DATA_CHARS = 3_000_000;
/**
 * QR コードに入れるリンクの上限（バイト）。SNS で縮められた画像からも読めるよう、1マスを 4px 以上で描ける大きさ
 * （src/lib/client/routine-image.ts の QR_SIZE 440px、誤り訂正 M で約 700 文字。テスト 103 で確かめる）
 */
export const MAX_SHARE_URL_BYTES = 700;
const SHARE_PREFIX = '#r=';
/** リンクのデータ（圧縮後）と、展開した後の上限。展開すると巨大になるデータで止まらないように */
const MAX_SHARE_DATA_CHARS = 4_000;
const MAX_SHARE_JSON_BYTES = 64 * 1024;
const MAX_REF_LENGTH = 200;

/** 書き出してよい製品（入力した成分表示を除く）。価格・お店のリンク・画像は入れない（その時だけの情報） */
function exportable(products: Product[]): Product[] {
  return products.filter(isPersistable).map((p) => {
    const copy = { ...p };
    delete copy.shopPrice;
    delete copy.shopLink;
    delete copy.imageUrl;
    return copy;
  });
}

/** 書き出さない製品（入力した成分表示）の数 */
export function excludedCount(snapshot: RoutineSnapshot): number {
  const all = [...snapshot.badProducts, ...snapshot.safeProducts, ...snapshot.currentUse.map((e) => e.product)];
  return all.filter((p) => !isPersistable(p)).length;
}

/** ファイルの中に入れるデータ（JSON） */
export function serializeRoutine(snapshot: RoutineSnapshot, now: number): string {
  return JSON.stringify({
    app: 'cosmetantei',
    v: DATA_VERSION,
    exportedAt: now,
    bad: exportable(snapshot.badProducts),
    safe: exportable(snapshot.safeProducts),
    current: snapshot.currentUse
      .filter((e) => isPersistable(e.product))
      .map((e) => ({ product: exportable([e.product])[0], addedAt: e.addedAt })),
  });
}

const isPlainName = (p: Product): boolean => isPlainLabelText(p.name) && isPlainLabelText(p.brand) && p.name.trim() !== '';
const allPlain = (list: string[] | undefined): boolean => !list || list.every(isPlainLabelText);
const COUNTRIES: readonly CountryOrigin[] = ['JP', 'KR', 'US', 'EU'];

/**
 * 確かめた項目だけを、新しい製品に写す。リンク（Amazon・お店）・価格・画像・説明・知らない項目は持ち込まない
 * （ほかの人が作った画像・リンクから、偽のリンクや文章を画面に出させない）。成分の名前も普通の文字だけ
 */
function sanitizeProduct(item: Product): Product | null {
  if (!isPlainName(item) || !allPlain(item.ingredients) || !allPlain(item.ingredientsEn) || !allPlain(item.activeIngredientsJa)) {
    return null;
  }
  const product: Product = {
    id: item.id,
    name: item.name,
    brand: item.brand,
    country: COUNTRIES.includes(item.country) ? item.country : 'JP',
    category: item.category ?? 'other',
    ingredients: [...item.ingredients],
  };
  if (item.activeIngredientsJa) product.activeIngredientsJa = [...item.activeIngredientsJa];
  if (item.ingredientsEn) product.ingredientsEn = [...item.ingredientsEn];
  if (item.isQuasiDrug !== undefined) product.isQuasiDrug = item.isQuasiDrug;
  if (item.undisclosedIngredientCount !== undefined) product.undisclosedIngredientCount = item.undisclosedIngredientCount;
  if (item.ingredientSource !== undefined) product.ingredientSource = item.ingredientSource;
  if (item.sourceUrl !== undefined && /^https:\/\//i.test(item.sourceUrl) && isPlainLabelText(item.sourceUrl)) product.sourceUrl = item.sourceUrl;
  return product;
}

/** 受け付ける製品だけを、重複・上限を除いて残す（新しいオブジェクトにする） */
function cleanList(list: unknown, exclude: ReadonlySet<string> = new Set()): Product[] {
  if (!Array.isArray(list)) return [];
  const products: Product[] = [];
  const seen = new Set(exclude);
  for (const raw of list) {
    if (!isValidProduct(raw) || !isPersistable(raw) || seen.has(raw.id)) continue;
    const product = sanitizeProduct(raw);
    if (!product) continue;
    seen.add(product.id);
    products.push(product);
    if (products.length >= MAX_ROUTINE_PRODUCTS) break;
  }
  return products;
}

/** 肌荒れ・安全の2つのリスト。同じ製品が両方にあれば肌荒れに残す（控えめな方） */
function comparisonLists(bad: unknown, safe: unknown): Pick<RoutineSnapshot, 'badProducts' | 'safeProducts'> {
  const badProducts = cleanList(bad);
  return { badProducts, safeProducts: cleanList(safe, new Set(badProducts.map((p) => p.id))) };
}

/** ファイルの中のデータを読む。形が違えば null */
export function parseRoutine(text: string, now: number): RoutineSnapshot | null {
  if (text.length > MAX_DATA_CHARS) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const { app, v, bad, safe, current } = data as Record<string, unknown>;
  if (app !== 'cosmetantei' || v !== DATA_VERSION) return null;
  const entries = (Array.isArray(current) ? current : []).map((e) => (e && typeof e === 'object' ? (e as Record<string, unknown>) : {}));
  // 追加した日は ID で引く（cleanList は新しいオブジェクトを返す）。最初の項目の日を使う
  const addedAtById = new Map<string, unknown>();
  for (const e of entries) {
    const id = (e.product as { id?: unknown } | undefined)?.id;
    if (typeof id === 'string' && !addedAtById.has(id)) addedAtById.set(id, e.addedAt);
  }
  const currentUse = cleanList(entries.map((e) => e.product)).map((product) => {
    const addedAt = addedAtById.get(product.id);
    // 追加した日は、今より後・形の違う値なら今にする
    return { product, addedAt: typeof addedAt === 'number' && Number.isFinite(addedAt) && addedAt > 0 && addedAt <= now ? addedAt : now };
  });
  return { ...comparisonLists(bad, safe), currentUse };
}

// ---------- QR コードのリンク ----------

type Ref = [id: string, brand: string, name: string];

const toRef = (p: Product): Ref => [p.id, p.brand, p.name];

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 展開する。上限を超えたら読むのをやめて null */
async function inflate(bytes: Uint8Array<ArrayBuffer>, maxBytes: number): Promise<string | null> {
  try {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(await new Blob(chunks as BlobPart[]).arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * QR コードに入れるリンク。3つのリストの ID・ブランド名・商品名だけ。
 * 上限（MAX_SHARE_URL_BYTES）に入らなければ null（ファイルの中のデータだけで保存する）
 */
export async function encodeShareLink(snapshot: RoutineSnapshot): Promise<string | null> {
  const payload = {
    v: DATA_VERSION,
    b: exportable(snapshot.badProducts).map(toRef),
    s: exportable(snapshot.safeProducts).map(toRef),
    c: exportable(snapshot.currentUse.map((e) => e.product)).map(toRef),
  };
  const url = `${SITE_URL}/${SHARE_PREFIX}${toBase64Url(await deflate(JSON.stringify(payload)))}`;
  return url.length <= MAX_SHARE_URL_BYTES ? url : null;
}

/** リンクの製品は名前だけ（成分はサーバーが ID で持っていれば、分析のときに使う） */
function refsToProducts(list: unknown): Product[] {
  if (!Array.isArray(list)) return [];
  const products = list
    .filter(
      (r): r is Ref =>
        Array.isArray(r) && r.length === 3 && r.every((t) => typeof t === 'string' && t.length > 0 && t.length <= MAX_REF_LENGTH)
    )
    .map(([id, brand, name]): Product => ({ id, brand, name, country: 'JP', category: 'other', ingredients: [] }));
  return products;
}

/** 共有のリンク（#r=...）か。アプリの中のスキャナーで読んだ文字にも使う */
export function shareFragment(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith(SHARE_PREFIX)) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.origin === new URL(SITE_URL).origin && url.hash.startsWith(SHARE_PREFIX) ? url.hash : null;
  } catch {
    return null;
  }
}

/** 共有のリンクの # より後ろ（#r=...）を読む。形が違えば null */
export async function decodeShareFragment(fragment: string, now: number): Promise<RoutineSnapshot | null> {
  if (!fragment.startsWith(SHARE_PREFIX)) return null;
  const data = fragment.slice(SHARE_PREFIX.length);
  if (data.length === 0 || data.length > MAX_SHARE_DATA_CHARS) return null;
  const bytes = fromBase64Url(data);
  const json = bytes && (await inflate(bytes, MAX_SHARE_JSON_BYTES));
  if (!json) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || (payload as { v?: unknown }).v !== DATA_VERSION) return null;
  const { b, s, c } = payload as Record<string, unknown>;
  return {
    ...comparisonLists(refsToProducts(b), refsToProducts(s)),
    currentUse: cleanList(refsToProducts(c)).map((product) => ({ product, addedAt: now })),
  };
}

export function isEmptySnapshot(snapshot: RoutineSnapshot): boolean {
  return snapshot.badProducts.length + snapshot.safeProducts.length + snapshot.currentUse.length === 0;
}

// ---------- PNG のファイルの中のデータ（iTXt） ----------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const isPng = (png: Uint8Array): boolean => png.length > 8 && PNG_SIGNATURE.every((b, i) => png[i] === b);

/** PNG に文字のデータ（iTXt。圧縮なし・UTF-8）を足す。IEND の前に入れる。PNG でなければ null */
export function addPngText(png: Uint8Array, keyword: string, text: string): Uint8Array | null {
  if (!isPng(png)) return null;
  const encoder = new TextEncoder();
  // キーワード \0 圧縮なし(0) 方式(0) 言語 \0 訳したキーワード \0 本文（大きな本文を配列に広げない）
  const key = encoder.encode(keyword);
  const body = encoder.encode(text);
  const data = new Uint8Array(key.length + 5 + body.length);
  data.set(key);
  data.set(body, key.length + 5);
  const typeAndData = new Uint8Array(4 + data.length);
  typeAndData.set(encoder.encode('iTXt'));
  typeAndData.set(data, 4);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeAndData, 4);
  view.setUint32(8 + data.length, crc32(typeAndData));
  const iend = png.length - 12;
  if (new TextDecoder().decode(png.subarray(iend + 4, iend + 8)) !== 'IEND') return null;
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, iend));
  out.set(chunk, iend);
  out.set(png.subarray(iend), iend + chunk.length);
  return out;
}

/** PNG の中の、このキーワードの文字のデータ（iTXt・圧縮なし）。無い・形が違えば null */
export function readPngText(png: Uint8Array, keyword: string): string | null {
  if (!isPng(png)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const decoder = new TextDecoder();
  const wanted = new TextEncoder().encode(keyword);
  let offset = 8;
  while (offset + 12 <= png.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > png.length) return null;
    const type = decoder.decode(png.subarray(offset + 4, offset + 8));
    // 上限より大きなデータは読まない（展開・文字への変換をしてから捨てることのないように）
    if (type === 'iTXt' && length > wanted.length + 5 && length <= MAX_DATA_CHARS * 3) {
      const data = png.subarray(offset + 8, offset + 8 + length);
      const matches = wanted.every((b, i) => data[i] === b) && data[wanted.length] === 0;
      // 圧縮なしだけを読む（圧縮されたデータは、展開すると巨大になることがある）
      if (matches && data[wanted.length + 1] === 0 && crc32(png.subarray(offset + 4, offset + 8 + length)) === view.getUint32(offset + 8 + length)) {
        let p = wanted.length + 3;
        // 言語・訳したキーワードを飛ばす
        for (let skip = 0; skip < 2; skip++) {
          const zero = data.indexOf(0, p);
          if (zero < 0) return null;
          p = zero + 1;
        }
        try {
          return new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(p));
        } catch {
          return null;
        }
      }
    }
    if (type === 'IEND') return null;
    offset = end;
  }
  return null;
}
