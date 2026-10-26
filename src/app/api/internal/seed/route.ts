import { SEED_PRODUCTS } from '@/lib/data/seed-products';
import { readJsonBody, TOO_LARGE } from '@/lib/server/api-route';
import { withUsageRoute } from '@/lib/server/usage';
import { seedProduct } from '@/lib/services/seeding';

/**
 * 製品を1つ自動で保存する（毎日の予定の仕事だけが呼ぶ。src/worker/seed-schedule.ts）。
 * - x-seed-secret が SEED_SECRET（wrangler secret）と同じときだけ動く。違う・未設定なら 404（あることを知らせない）
 * - ブラウザの確認（Turnstile）・利用者ごとの予算は通さない（利用者がいない）。全体の予算・1分の件数・1回の要求の
 *   上限（$0.30 = Web リサーチ1回）は効く。有料の Web リサーチは1日3回まで（src/lib/services/seeding.ts）
 * - 調べるのは src/lib/data/seed-products.ts の何番目か（index）だけ。検索語は外から受け取らない
 */

const NOT_FOUND = () => new Response('Not Found', { status: 404 });
const MAX_BODY_BYTES = 256;

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** 長さ・中身で時間の変わらない比べ方（ハッシュ値どうしを全部比べる） */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function POST(request: Request): Promise<Response> {
  const secret = (process.env.SEED_SECRET || '').trim();
  const given = request.headers.get('x-seed-secret') ?? '';
  if (secret.length < 32 || !(await sameSecret(given, secret))) return NOT_FOUND();

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  const index = body !== TOO_LARGE && body && typeof body === 'object' ? (body as { index?: unknown }).index : undefined;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= SEED_PRODUCTS.length) {
    return Response.json({ error: 'index' }, { status: 400 });
  }
  try {
    const outcome = await withUsageRoute('seed', () => seedProduct(SEED_PRODUCTS[index]))();
    return Response.json(outcome);
  } catch (err) {
    // 何番目かだけをログに出す（検索語は一覧にある）
    console.error(`[seed] index ${index} failed:`, err instanceof Error ? err.message : err);
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}
