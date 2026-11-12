import { ChatMessage, Product } from '@/lib/types';
import { ChatResponse } from '@/lib/client/chat-request';
import { withoutEmoji } from '../ui/emoji';
import {
  decodeShareFragment,
  parseRoutine,
  readPngText,
  ROUTINE_PNG_KEYWORD,
  RoutineSnapshot,
  shareFragment,
} from '@/lib/routine-share';
import { MAX_ROUTINE_PRODUCTS } from '@/lib/product-validation';

/* ChatContainer と、その状態を持つフック（useRoutineLists・useRoutineTransfer）が使う、コンポーネントの外の関数と定数 */

let messageSequence = 0;

/** 現在時刻（コンポーネント外の関数にして、描画中の不純な呼び出しとして扱われないようにする） */
export function currentTime(): number {
  return Date.now();
}

/** メッセージの一意な ID とタイムスタンプ（同じミリ秒に複数作っても ID が重複しない） */
export function messageMeta(prefix: string): { id: string; timestamp: number } {
  messageSequence += 1;
  const timestamp = currentTime();
  return { id: `${prefix}-${timestamp}-${messageSequence}`, timestamp };
}

/** 応答待ちの間に、ほかのサーバーへの操作が押されたときの案内 */
export const WAIT_MESSAGE = '前の返答を待っています。届いてから、もう一度お試しください。';
export const DEFAULT_LOADING_TEXT = '成分データベースを解析中...';
/** 検索候補のトレイの id（入力欄の aria-controls） */
export const SEARCH_TRAY_ID = 'search-tray';
/** 画像から QR コードを読むときに html5-qrcode が使う要素（画面には出さない） */
export const ROUTINE_QR_READER_ID = 'routine-qr-reader';
/** 読み込む画像の上限（巨大なファイルを読まない）。作る画像は 1080×1350 なので、スクリーンショットでも十分入る */
const MAX_ROUTINE_IMAGE_BYTES = 8_000_000;
/** 画素数の上限。小さなファイルで巨大な大きさを書いた画像を、QR コードを探すために描かない */
const MAX_ROUTINE_IMAGE_PIXELS = 16_000_000;
export const IMPORT_FAILED = 'この画像からマイルーティンを読み込めませんでした。コスメ探偵で作った画像を選んでください。';

/** 画像を読めなかった理由ごとの案内 */
export const IMPORT_FAILURES = {
  too_large: 'ファイルが大きすぎます（8MBまで）。コスメ探偵で保存した画像を選んでください。',
  not_image: '画像として開けませんでした。PNG・JPEG の画像を選んでください。',
  unreadable: 'この画像の中に、マイルーティンのデータとQRコードが見つかりませんでした。コスメ探偵で作った画像を、切り抜かずに選んでください。',
  failed: '画像を読み込めませんでした。もう一度お試しください。',
} as const;
type ImportFailure = keyof typeof IMPORT_FAILURES;

export type ImportRead = { snapshot: RoutineSnapshot; namesOnly: boolean } | { failure: ImportFailure };

/** 画像から、マイルーティンを読む。ファイルの中のデータを先に、無ければ QR コードを読む。読めなければ理由 */
export async function readRoutineImage(file: File): Promise<ImportRead> {
  if (file.size > MAX_ROUTINE_IMAGE_BYTES) return { failure: 'too_large' };
  const now = currentTime();
  const text = readPngText(new Uint8Array(await file.arrayBuffer()), ROUTINE_PNG_KEYWORD);
  const fromFile = text ? parseRoutine(text, now) : null;
  if (fromFile) return { snapshot: fromFile, namesOnly: false };
  const size = await imageSize(file);
  if (size === 'not_image') return { failure: 'not_image' };
  if (size === 'too_large') return { failure: 'too_large' };
  const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
  const reader = new Html5Qrcode(ROUTINE_QR_READER_ID, { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], verbose: false });
  try {
    const fragment = shareFragment(await reader.scanFile(file, false));
    const fromQr = fragment ? await decodeShareFragment(fragment, now) : null;
    return fromQr ? { snapshot: fromQr, namesOnly: true } : { failure: 'unreadable' };
  } catch {
    return { failure: 'unreadable' };
  } finally {
    reader.clear();
  }
}

/** 画像の大きさ（縦×横）が上限内か。大きさは画像の頭から分かる（全体を描く前に確かめる） */
async function imageSize(file: File): Promise<'ok' | 'too_large' | 'not_image'> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('not an image'));
    });
    return img.naturalWidth * img.naturalHeight <= MAX_ROUTINE_IMAGE_PIXELS ? 'ok' : 'too_large';
  } catch {
    return 'not_image';
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 足す前の数と、足したあとの数から、足さなかった数（重複・上限） */
export function appendStats(list: Product[], incoming: Product[], taken: Set<string>): { added: number; skipped: number } {
  // appendProducts と同じ順に数える（重複・上限）。足す製品は taken に入れる
  const fresh = incoming.filter((p) => !taken.has(p.id) && taken.add(p.id));
  const added = fresh.slice(0, Math.max(0, MAX_ROUTINE_PRODUCTS - list.length));
  return { added: added.length, skipped: incoming.length - added.length };
}

/** 長く待つ操作の案内に足す文（Web を調べるときは1分ほどかかる） */
export const LONG_WAIT_NOTE = '（Webで調べるときは1分ほどかかることがあります）';
/** この時間を過ぎても返事が無ければ、まだ調べていることを伝える */
export const STILL_WORKING_AFTER_MS = 15_000;
/** 失敗の吹き出しに付ける、同じ頼みごとをもう一度送るボタン */
export const RETRY_LABEL = '🔁 もう一度送る';
/** 一度押したら、同じ吹き出しでは調べ直さないボタン（有料の調べもの） */
export const ONCE_PER_MESSAGE_LABELS = new Set(['🔎 Webで成分を調べ直す', '💴 この商品の価格を調べる', RETRY_LABEL]);

/** 頼み直して結果が変わりうる失敗か（通信・時間切れ・中止は null、408、サーバーの問題） */
export const retryable = (status: number | null): boolean => status === null || status === 408 || status >= 500;

/** 今のリストに足す（同じ製品はどのリストにあっても足さない。1つのリストは上限まで） */
export function appendProducts(list: Product[], incoming: Product[], taken: Set<string>): Product[] {
  const added = incoming.filter((p) => !taken.has(p.id));
  for (const p of added) taken.add(p.id);
  return [...list, ...added].slice(0, MAX_ROUTINE_PRODUCTS);
}

type ReplyField = 'productSuggestions' | 'singleAnalysis' | 'differentialAnalysis' | 'priceResult' | 'quickReplies';

/** 返答のうち、この操作で使う項目だけを吹き出しに載せる（形はサーバーの型どおり） */
export function pickReply(data: ChatResponse, keys: ReplyField[]): Partial<ChatMessage> {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (data[key] !== undefined && data[key] !== null) out[key] = data[key];
  return out as Partial<ChatMessage>;
}

/** 返答の、代わりの商品の印とクレジット（形の違う値は使わない） */
export function alternativesOf(data: ChatResponse): Partial<ChatMessage> {
  if (data.suggestionKind !== 'alternatives') return {};
  const credits = Array.isArray(data.alternativeCredits)
    ? data.alternativeCredits.filter((c): c is 'rakuten' | 'yahoo' => c === 'rakuten' || c === 'yahoo')
    : [];
  return { suggestionKind: 'alternatives', ...(credits.length > 0 && { alternativeCredits: credits }) };
}

/** 読み上げる返答の冒頭（カードまで全部は読まない） */
export function announcementOf(content: string): string {
  const text = withoutEmoji(content).replace(/\s+/g, ' ').trim();
  return `返答：${text.length > 120 ? `${text.slice(0, 120)}…` : text}`;
}

/** Tailwind の lg（64rem）未満。rem で書き、ブラウザの文字サイズ設定が違っても CSS のブレークポイントと一致させる */
export const MOBILE_QUERY = '(max-width: 63.999rem)';

// 開発用のサンプル（handleLoadSample が読み込む）
// Load sample irritation scenario (Melano CC as bad, Curel Wash & Ihada Lotion as safe)
export const SAMPLE_MELANO: Product = {
  id: 'sample_melano_cc',
  name: '薬用しみ集中対策 プレミアム美容液',
  brand: 'ロート製薬',
  country: 'JP',
  category: 'serum',
  ingredients: ['アスコルビン酸', 'ピリドキシン塩酸塩', 'アラントイン', 'o-シメン-5-オール', '香料'],
  amazonSearchUrl: 'https://www.amazon.co.jp/s?k=メラノCC+プレミアム美容液&tag=cosmetantei22-22',
  descriptionJa: 'サンプルデータ：ビタミンC高配合美容液',
};
export const SAMPLE_CUREL: Product = {
  id: 'sample_curel_wash',
  name: '潤浸保湿 泡洗顔料',
  brand: 'キュレル',
  country: 'JP',
  category: 'cleanser',
  fragranceFree: true,
  alcoholFree: true,
  ingredients: ['グリチルリチン酸2K', '精製水', 'グリセリン', 'ラウロイルアスパラギン酸Na液'],
  amazonSearchUrl: 'https://www.amazon.co.jp/s?k=キュレル+泡洗顔料&tag=cosmetantei22-22',
  descriptionJa: 'サンプルデータ：セラミドケア洗顔料',
};
export const SAMPLE_IHADA: Product = {
  id: 'sample_ihada_lotion',
  name: '薬用ローション とてもしっとり',
  brand: 'イハダ',
  country: 'JP',
  category: 'toner',
  fragranceFree: true,
  alcoholFree: true,
  ingredients: ['アラントイン', 'グリチルリチン酸ジカリウム', '精製水', '高精製ワセリン'],
  amazonSearchUrl: 'https://www.amazon.co.jp/s?k=イハダ+薬用ローション&tag=cosmetantei22-22',
  descriptionJa: 'サンプルデータ：薬用化粧水',
};
