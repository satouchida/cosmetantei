/**
 * Base64URL（= を付けない）の変換。サーバーの署名つき Cookie（src/lib/server/session.ts・owner.ts）と、
 * ブラウザの共有のリンク（src/lib/routine-share.ts）で使うので、server-only にしない
 */

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Base64URL の文字だけでできていなければ・読めなければ null */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
