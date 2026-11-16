import 'server-only';
import { BoundedCache } from '../utils/bounded-cache';
import { getBindings } from './cloudflare';

const memoryKv = new BoundedCache<unknown>(1000);

/** テスト用：KV のメモリの写しを消す（同じキーを、別の内容で読み直すテストのため） */
export function clearMemoryCacheForTests(): void {
  memoryKv.clear();
}
// メモリ層は短期間だけ保持し、他のアイソレートが KV に書いた更新を取りこぼさないようにする
const MEMORY_LAYER_TTL_MS = 60_000;

/** KV キーの上限（512バイト）を超えないよう、可変長の入力は SHA-256 でハッシュ化する */
export async function hashedCacheKey(prefix: string, raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}:${hex}`;
}

/** KV の最小 TTL は 60 秒 */
const MIN_KV_TTL_SECONDS = 60;

/**
 * KV から JSON を読む（同じアイソレートのメモリに 60 秒の写しを持つ）。
 * fresh: メモリの写しを使わず KV を読む（ほかのアイソレートが書いたばかりの値を探すとき）
 */
export async function cacheGetJSON<T>(key: string, { fresh = false }: { fresh?: boolean } = {}): Promise<T | null> {
  const local = fresh ? undefined : memoryKv.get(key);
  if (local !== undefined) return local as T;

  const { APP_CACHE } = await getBindings();
  // KV が無い環境（開発・テスト）では、メモリ層が唯一の保存先（fresh でも読む。cachePutJSON と同じ）
  if (!APP_CACHE) return fresh ? ((memoryKv.get(key) as T | undefined) ?? null) : null;
  try {
    const value = (await APP_CACHE.get(key, 'json')) as T | null;
    if (value !== null) memoryKv.set(key, value, MEMORY_LAYER_TTL_MS);
    return value;
  } catch (err) {
    console.error('KV get failed:', err);
    return null;
  }
}

/**
 * KV から JSON を読む（いつも KV を読む）。読めなかったら例外にする（呼び出し側で「読めないなら使わない」と決めるとき。
 * 自動の保存の有料の回数：src/lib/services/seeding.ts）。KV が無い環境ではメモリ層を読む
 */
export async function cacheGetJSONStrict<T>(key: string): Promise<T | null> {
  const { APP_CACHE } = await getBindings();
  if (!APP_CACHE) return (memoryKv.get(key) as T | undefined) ?? null;
  return (await APP_CACHE.get(key, 'json')) as T | null;
}

/** KV が使えるか（無ければ、メモリ層はこのアイソレートの中だけ） */
export async function hasSharedCache(): Promise<boolean> {
  return !!(await getBindings()).APP_CACHE;
}

/** cachePutJSON と同じ保存。KV に書けなかったら例外にする（書けないなら使わない、と決めるとき） */
export async function cachePutJSONStrict(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const { APP_CACHE } = await getBindings();
  memoryKv.set(key, value, APP_CACHE ? Math.min(ttlSeconds * 1000, MEMORY_LAYER_TTL_MS) : ttlSeconds * 1000);
  if (!APP_CACHE) return;
  await APP_CACHE.put(key, JSON.stringify(value), { expirationTtl: Math.max(MIN_KV_TTL_SECONDS, Math.floor(ttlSeconds)) });
}

export async function cachePutJSON(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const { APP_CACHE } = await getBindings();
  // KV が無い環境ではメモリ層が唯一の保存先なので、指定の TTL で保持する
  memoryKv.set(key, value, APP_CACHE ? Math.min(ttlSeconds * 1000, MEMORY_LAYER_TTL_MS) : ttlSeconds * 1000);
  if (!APP_CACHE) return;
  try {
    await APP_CACHE.put(key, JSON.stringify(value), {
      expirationTtl: Math.max(MIN_KV_TTL_SECONDS, Math.floor(ttlSeconds)),
    });
  } catch (err) {
    console.error('KV put failed:', err);
  }
}
