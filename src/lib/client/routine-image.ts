import qrcode from 'qrcode-generator';
import { addPngText, ROUTINE_PNG_KEYWORD } from '../routine-share';

/**
 * マイルーティンの画像（1080×1350 の PNG。Instagram・X・LINE の縦長に合う）を canvas で描く。
 * docs/plans/routine-image.md
 * - 見えるのは「肌に合っていた」側のまとめ（気をつけたい成分の候補・合っていたコスメ・件数）。
 *   肌荒れしたコスメの名前は、公開する画像に出さない
 * - 読み込み用のデータ（QR コードのリンクと、PNG の中のデータ）は、利用者が切れる
 */

export interface RoutineImageContent {
  /** 最近の差分分析の「原因の可能性がある成分」（無ければ空） */
  culprits: string[];
  /** 肌に合っていたコスメ（安全リスト） */
  safeProducts: { brand: string; name: string }[];
  badCount: number;
  currentCount: number;
  /** QR コードに入れるリンク（読み込み用のデータを入れないとき・入りきらないときは null） */
  shareUrl: string | null;
  /** PNG の中に入れるデータ（入れないときは null） */
  fileData: string | null;
  date: Date;
}

const WIDTH = 1080;
const HEIGHT = 1350;
const PAD = 72;
const MAX_CULPRITS = 5;
/** 成分のチップは2行まで */
const MAX_CHIP_ROWS = 2;
/** 合っていたコスメの行数（QR コードを入れるときは、その場所を空けるため少なく） */
const MAX_SAFE = 6;
const MAX_SAFE_WITH_QR = 3;
/** QR コードの大きさ。MAX_SHARE_URL_BYTES のリンクでも1マス 4px 以上（SNS で縮められても読める） */
export const QR_SIZE = 440;
const ROW = 68;

// globals.css の色（canvas は CSS 変数を使えないので、同じ値を書く）
const COLORS = {
  background: '#f8faf9',
  card: '#ffffff',
  primary: '#006a4e',
  ink: '#1a2e26',
  muted: '#4b5563',
  line: '#dfe7e1',
  warning: '#9f1239',
  warningTint: '#fff1f2',
  tint: '#eff5f0',
};

/** ページの日本語フォント（next/font の Noto Sans JP）。読み込みが終わってから描く */
function fontFamily(): string {
  const family = getComputedStyle(document.body).fontFamily;
  return family || '"Noto Sans JP", "Hiragino Sans", sans-serif';
}

/** 1文字ずつ測って折り返す（日本語は空白で区切れない）。maxLines を超えた分は「…」 */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch;
      if (lines.length === maxLines) break;
    } else {
      line += ch;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  else if (lines.length === maxLines && (line || lines.join('').length < [...text].length)) {
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function makeQr(url: string) {
  const qr = qrcode(0, 'M');
  qr.addData(url, 'Byte');
  qr.make();
  return qr;
}

/** 周りに 4 マスの余白（読み取りに必要）を入れたときの、1マスのピクセル数（整数にして、縮められてもにじみにくくする） */
export function qrCellSize(url: string, size = QR_SIZE): number {
  return Math.floor(size / (makeQr(url).getModuleCount() + 8));
}

function drawQr(ctx: CanvasRenderingContext2D, url: string, x: number, y: number, size: number): void {
  const qr = makeQr(url);
  const count = qr.getModuleCount();
  const cell = qrCellSize(url, size);
  const offset = Math.floor((size - cell * count) / 2);
  roundRect(ctx, x, y, size, size, 24, '#ffffff');
  ctx.fillStyle = '#000000';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) ctx.fillRect(x + offset + c * cell, y + offset + r * cell, cell, cell);
    }
  }
}

async function loadIcon(): Promise<HTMLImageElement | null> {
  const img = new Image();
  img.src = '/icon-192.png';
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

/** 画像を描いて PNG にする（読み込み用のデータを入れるなら、PNG の中にも入れる） */
export async function renderRoutineImage(content: RoutineImageContent): Promise<Blob> {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas is not available');
  const font = fontFamily();
  const setFont = (size: number, weight = 400) => {
    ctx.font = `${weight} ${size}px ${font}`;
  };
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.textBaseline = 'top';

  // 見出し：アイコン・アプリ名・日付
  const icon = await loadIcon();
  if (icon) ctx.drawImage(icon, PAD, PAD - 4, 72, 72);
  const titleX = icon ? PAD + 92 : PAD;
  ctx.fillStyle = COLORS.primary;
  setFont(30, 700);
  ctx.fillText('コスメ探偵', titleX, PAD - 2);
  ctx.fillStyle = COLORS.ink;
  setFont(44, 700);
  ctx.fillText('マイルーティン', titleX, PAD + 34);
  const d = content.date;
  setFont(26);
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'right';
  ctx.fillText(`${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`, WIDTH - PAD, PAD + 46);
  ctx.textAlign = 'left';

  let y = PAD + 110;
  const contentWidth = WIDTH - PAD * 2;

  // 気をつけたい成分（候補）
  if (content.culprits.length > 0) {
    const names = content.culprits.slice(0, MAX_CULPRITS);
    setFont(30, 700);
    const chipRows: string[][] = [[]];
    let rowWidth = 0;
    for (const name of names) {
      const w = Math.min(ctx.measureText(name).width + 48, contentWidth - 48);
      if (rowWidth + w > contentWidth - 48 && chipRows[chipRows.length - 1].length > 0) {
        chipRows.push([]);
        rowWidth = 0;
      }
      chipRows[chipRows.length - 1].push(name);
      rowWidth += w + 16;
    }
    chipRows.splice(MAX_CHIP_ROWS);
    const cardHeight = 88 + chipRows.length * 64;
    roundRect(ctx, PAD, y, contentWidth, cardHeight, 32, COLORS.card);
    ctx.fillStyle = COLORS.warning;
    setFont(30, 700);
    ctx.fillText('気をつけたい成分（候補）', PAD + 36, y + 28);
    let cy = y + 80;
    for (const row of chipRows) {
      let cx = PAD + 36;
      for (const name of row) {
        setFont(30, 700);
        const label = wrap(ctx, name, contentWidth - 120, 1)[0];
        const w = ctx.measureText(label).width + 48;
        roundRect(ctx, cx, cy, w, 52, 26, COLORS.warningTint);
        ctx.fillStyle = COLORS.warning;
        ctx.fillText(label, cx + 24, cy + 9);
        cx += w + 16;
      }
      cy += 64;
    }
    y += cardHeight + 24;
  }

  // 肌に合っていたコスメ
  const maxSafe = content.shareUrl ? MAX_SAFE_WITH_QR : MAX_SAFE;
  const safe = content.safeProducts.slice(0, maxSafe);
  const more = content.safeProducts.length - safe.length;
  const safeHeight = 88 + Math.max(1, safe.length) * ROW + (more > 0 ? 40 : 0);
  roundRect(ctx, PAD, y, contentWidth, safeHeight, 32, COLORS.card);
  ctx.fillStyle = COLORS.primary;
  setFont(30, 700);
  ctx.fillText('肌に合っていたコスメ', PAD + 36, y + 28);
  let sy = y + 80;
  if (safe.length === 0) {
    ctx.fillStyle = COLORS.muted;
    setFont(28);
    ctx.fillText('まだ登録していません', PAD + 36, sy + 8);
  }
  for (const p of safe) {
    ctx.fillStyle = COLORS.muted;
    setFont(22, 700);
    ctx.fillText(wrap(ctx, p.brand, contentWidth - 72, 1)[0] ?? '', PAD + 36, sy);
    ctx.fillStyle = COLORS.ink;
    setFont(28, 700);
    ctx.fillText(wrap(ctx, p.name, contentWidth - 72, 1)[0] ?? '', PAD + 36, sy + 28);
    sy += ROW;
  }
  if (more > 0) {
    ctx.fillStyle = COLORS.muted;
    setFont(24);
    ctx.fillText(`ほか ${more}点`, PAD + 36, sy + 4);
  }
  y += safeHeight + 24;

  // 下の段：件数と QR コード。フッターの上に寄せる（上の2つは行数を抑えてあるので、QR_SIZE は必ず入る）
  const qrSize = content.shareUrl ? QR_SIZE : 0;
  y = Math.max(y, HEIGHT - PAD - 72 - Math.max(qrSize, 140));
  const statsWidth = content.shareUrl ? contentWidth - qrSize - 32 : contentWidth;
  ctx.fillStyle = COLORS.ink;
  setFont(28, 700);
  ctx.fillText(`肌荒れしたコスメ ${content.badCount}点`, PAD + 8, y + 8);
  ctx.fillText(`今使っているコスメ ${content.currentCount}点`, PAD + 8, y + 52);
  if (content.shareUrl) {
    drawQr(ctx, content.shareUrl, WIDTH - PAD - qrSize, y, qrSize);
    ctx.fillStyle = COLORS.muted;
    setFont(24);
    for (const [i, line] of wrap(ctx, 'QRコードを読み取ると、コスメ探偵にこのルーティンを読み込めます', statsWidth - 16, 3).entries()) {
      ctx.fillText(line, PAD + 8, y + 116 + i * 34);
    }
  }

  // フッター：アドレスと注意書き
  ctx.fillStyle = COLORS.primary;
  setFont(26, 700);
  ctx.fillText('cosmetantei.app', PAD, HEIGHT - PAD - 40);
  ctx.fillStyle = COLORS.muted;
  setFont(22);
  ctx.textAlign = 'right';
  ctx.fillText('成分を比べた候補です。医療的な診断ではありません。', WIDTH - PAD, HEIGHT - PAD - 36);
  ctx.textAlign = 'left';

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('could not encode the image');
  if (!content.fileData) return blob;
  const withData = addPngText(new Uint8Array(await blob.arrayBuffer()), ROUTINE_PNG_KEYWORD, content.fileData);
  return withData ? new Blob([withData as BlobPart], { type: 'image/png' }) : blob;
}
