// pnpm check:responsive: 画面の幅ごとに、レイアウトの崩れを確かめる（docs/plans/responsive-design.md の Part B）。
// 開発用の画面一覧（/dev/gallery）の全画面と、トップ・規約・プライバシーポリシーを、スマホ〜デスクトップの
// 大きさで開き、次を調べる：横スクロール、はみ出し・切れ（横・縦）、文字の重なり、小さすぎるタップ領域。
// 画面ごとのスクリーンショットと結果を responsive-report/ に保存する。
// 終了コード：0 崩れなし / 1 崩れあり / 2 調べられなかった（サーバーが無い・指定の誤りなど）
//
// 使い方：別の端末で pnpm dev を動かしてから
//   pnpm check:responsive                       すべて
//   pnpm check:responsive -- --only=tray        画面の名前・パスに "tray" を含むものだけ
//   pnpm check:responsive -- --size=iphone      大きさの名前で絞る
//   BASE_URL=http://localhost:3001 で開く先を変えられる
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, webkit, devices } from 'playwright';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3001';
const OUT_DIR = 'responsive-report';

function fail(message) {
  console.error(message);
  process.exit(2);
}

const args = {};
for (const a of process.argv.slice(2)) {
  if (a === '--self-test') {
    args.selfTest = true;
    continue;
  }
  const m = /^--(only|size)=(.+)$/.exec(a);
  if (!m) fail(`分からない指定です：${a}（使えるのは --only=…・--size=…・--self-test）`);
  args[m[1]] = m[2];
}

/** 確かめる大きさ（docs/plans/responsive-design.md の「Target sizes」） */
const SIZES = [
  { name: 'small-320', engine: 'chromium', context: { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { name: 'android-360', engine: 'chromium', context: { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
  { name: 'iphone-390', engine: 'webkit', context: devices['iPhone 13'] },
  { name: 'landscape-844x390', engine: 'chromium', context: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
  { name: 'tablet-768', engine: 'chromium', context: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
  { name: 'desktop-1280', engine: 'chromium', context: { viewport: { width: 1280, height: 800 } } },
  // ブラウザの文字の大きさ 200%（rem で決めた大きさが2倍になる。WCAG 1.4.4）
  { name: 'text-200', engine: 'chromium', textZoom: true, context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } },
];

// 同意は、テスト用のブラウザの中だけで済ませる。版は規約の版（src/lib/site.ts）から読む（写すと古くなる）
const legalVersion = /LEGAL_VERSION\s*=\s*'([^']+)'/.exec(readFileSync('src/lib/site.ts', 'utf8'))?.[1];
if (!legalVersion) fail('src/lib/site.ts に LEGAL_VERSION が見つかりません。');
const CONSENT = { key: 'cosmetantei:consent:v1', version: legalVersion };

/** ページの中で実行する検査。見つけた崩れの一覧を返す（ページを上から下へスクロールしながら調べる） */
async function inspectPage() {
  const problems = [];
  const vw = document.documentElement.clientWidth;

  const describe = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      if (e.id) s += `#${e.id}`;
      const cls = typeof e.className === 'string' ? e.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
      if (cls) s += `.${cls}`;
      parts.unshift(s);
    }
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${parts.join(' > ')}${text ? ` 「${text}」` : ''}`;
  };
  const hiddenFromView = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return true;
      if (e.classList?.contains('sr-only')) return true;
    }
    return false;
  };
  const isLineClamped = (cs) => !!cs.webkitLineClamp && cs.webkitLineClamp !== 'none';

  // 1. 横スクロール（ページの幅が画面より広い）
  const pageWidth = document.documentElement.scrollWidth;
  if (pageWidth > vw + 1) {
    const wide = [...document.body.querySelectorAll('*')]
      .filter((el) => el.getBoundingClientRect().right > vw + 1 && !hiddenFromView(el))
      .filter((el) => ![...el.children].some((c) => c.getBoundingClientRect().right > vw + 1))
      .slice(0, 3);
    problems.push({ kind: 'horizontal-scroll', detail: `page is ${pageWidth}px wide in a ${vw}px viewport`, at: wide.map(describe) });
  }

  // 2. はみ出し・切れ（横）：中身が箱より広い。スクロールする箱・省略記号（truncate）・行数の制限は意図したもの。
  // 0.5rem（ふつう 8px）までは数えない（閉じるボタンの -mr-2 など、余白に食い込ませるデザインがある。
  // rem で決めた余白なので、文字を大きくすると広がる）
  const SLACK = Math.max(8, parseFloat(getComputedStyle(document.documentElement).fontSize) / 2);
  for (const el of document.body.querySelectorAll('*')) {
    if (el.scrollWidth <= el.clientWidth + SLACK || el.clientWidth === 0) continue;
    const cs = getComputedStyle(el);
    if (['auto', 'scroll'].includes(cs.overflowX)) continue;
    if (cs.textOverflow === 'ellipsis' || isLineClamped(cs)) continue;
    if (cs.display === 'inline' || hiddenFromView(el)) continue;
    // 子がはみ出しているときは、いちばん内側の箱だけを報告する
    if ([...el.children].some((c) => c.scrollWidth > c.clientWidth + SLACK)) continue;
    const kind = cs.overflowX === 'visible' ? 'overflow' : 'clipped';
    problems.push({ kind, detail: `content ${el.scrollWidth}px in a ${el.clientWidth}px box`, at: [describe(el)] });
  }

  // 縦の切れの余裕は丸めの分だけ（横の SLACK は余白に食い込ませるデザインのため。縦に 8px 切れると1行の半分が隠れる）
  const SLACK_Y = 2;
  // 2b. 切れ（縦）：高さを決めた箱が中身を隠す。横向きのスマホ・文字 200% で起きやすい。
  // scrollHeight だけでは決めない（中のスクロールする箱の sticky な要素が、外の箱の scrollHeight を増やすことがある）。
  // 箱の下からはみ出している子孫が、間にスクロールする箱をはさまずにあるときだけ数える
  const scrollsY = (e) => ['auto', 'scroll'].includes(getComputedStyle(e).overflowY);
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (!['hidden', 'clip'].includes(cs.overflowY) || isLineClamped(cs)) continue;
    if (el.clientHeight === 0 || el.scrollHeight <= el.clientHeight + SLACK_Y || hiddenFromView(el)) continue;
    const bottom = el.getBoundingClientRect().bottom;
    const cut = [...el.querySelectorAll('*')].find((d) => {
      if (d.getBoundingClientRect().bottom <= bottom + SLACK_Y || hiddenFromView(d)) return false;
      for (let e = d.parentElement; e && e !== el; e = e.parentElement) if (scrollsY(e)) return false;
      return true;
    });
    if (!cut) continue;
    problems.push({ kind: 'clipped-y', detail: `content ${el.scrollHeight}px in a ${el.clientHeight}px box`, at: [describe(el), describe(cut)] });
  }
  // 画面より高いダイアログは、中でスクロールできないと下のボタンに届かない
  for (const d of document.querySelectorAll('dialog[open], [role="dialog"]')) {
    if (hiddenFromView(d)) continue;
    const b = d.getBoundingClientRect();
    const scrolls = [d, ...d.querySelectorAll('*')].some(
      (e) => ['auto', 'scroll'].includes(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight
    );
    if (b.height > innerHeight + 1 && !scrolls) {
      problems.push({ kind: 'dialog-taller-than-viewport', detail: `${Math.round(b.height)}px in ${innerHeight}px`, at: [describe(d)] });
    }
  }

  // 3. 文字の重なり：見えている文字（上に別のものが重なっていない文字）どうしが重なる。
  // elementFromPoint は画面の中しか調べられないので、ページを1画面ずつスクロールして集める
  /** その点が、はみ出しを切る箱（line-clamp・overflow: hidden）の中にあるか。切られた行は見えていない */
  const insideClips = (el, x, y) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const b = e.getBoundingClientRect();
      if (x < b.left || x > b.right || y < b.top || y > b.bottom) return false;
    }
    return true;
  };
  /** 文字の箱を、はみ出しを切る箱（自分と祖先）で切った残り。見えなければ null */
  const clipToAncestors = (el, r) => {
    let { left, right, top, bottom } = r;
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const b = e.getBoundingClientRect();
      left = Math.max(left, b.left);
      right = Math.min(right, b.right);
      top = Math.max(top, b.top);
      bottom = Math.min(bottom, b.bottom);
    }
    return right - left > 1 && bottom - top > 1 ? { left, right, top, bottom } : null;
  };
  /** 要素そのものが文字を持っているか（子の要素の文字は数えない） */
  const hasOwnText = (e) => [...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
  const modal = [...document.querySelectorAll('dialog[open]')].find((d) => d.matches(':modal')) ?? null;
  /** 画面に固定される要素の中か（スクロールしても同じ位置に出るので、いちばん上でだけ集める） */
  const pinned = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const pos = getComputedStyle(e).position;
      if (pos === 'fixed' || pos === 'sticky') return true;
      if (e.tagName === 'DIALOG' && e.open) return true;
    }
    return false;
  };
  const runs = [];
  const seen = new Set();
  const pageHeight = document.documentElement.scrollHeight;
  const step = Math.max(innerHeight - 40, 100);
  for (let y = 0; y < pageHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const atTop = window.scrollY === 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const el = node.parentElement;
      if (!el || hiddenFromView(el)) continue;
      if (!atTop && pinned(el)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width < 2 || r.height < 2) continue;
        const cx = Math.min(Math.max(r.left + r.width / 2, 0), vw - 1);
        const cy = r.top + r.height / 2;
        if (cy < 0 || cy >= innerHeight) continue;
        if (!insideClips(el, cx, cy)) continue;
        // 開いたモーダルのダイアログの後ろの文字は見えない（重なりとして比べない）
        if (modal && !modal.contains(el)) continue;
        const top = document.elementFromPoint(cx, cy);
        if (!top) continue;
        // 上にあるのが別の文字なら、それこそ重なり（残して比べる）。文字のない箱（暗い幕など）の下なら隠れている
        const related = el === top || el.contains(top) || top.contains(el);
        // 文字・画像・アイコンが上にあれば重なり。文字のない箱（暗い幕など）の下なら隠れている
        const isPicture = top instanceof SVGElement || ['IMG', 'CANVAS', 'VIDEO'].includes(top.tagName);
        if (!related && !hasOwnText(top) && !isPicture) continue;
        // 画像・アイコンが文字の上にある：画像は文字の一覧に入らないので、ここで重なりとして報告する
        if (!related && isPicture) {
          const pic = top.closest('svg') ?? top;
          const key = `${describe(el)}|${describe(pic)}`;
          if (!seen.has(key)) {
            seen.add(key);
            problems.push({ kind: 'text-overlap', detail: 'covered by an image or icon', at: [describe(el), describe(pic)] });
          }
          continue;
        }
        // 見えている部分だけにする：truncate などで切られた先は、隣の要素と重なっても見えない
        const c = clipToAncestors(el, r);
        if (!c) continue;
        // ページの上からの位置にして、別のスクロール位置で集めたものと比べられるようにする
        runs.push({ el, r: { left: c.left, right: c.right, top: c.top + window.scrollY, bottom: c.bottom + window.scrollY } });
      }
    }
    if (window.scrollY + innerHeight >= pageHeight) break;
  }
  window.scrollTo(0, 0);
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i];
      const b = runs[j];
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      // 字の箱は行の高さより大きいので、行を詰めた見出しと次の行は、字が重ならなくても箱が数 px 重なる。
      // 低いほうの行の高さの 1/4 を超えて重なるときだけ数える（12px の行が 4px 重なれば数える）
      const minHeight = Math.min(a.r.bottom - a.r.top, b.r.bottom - b.r.top);
      if (w > 2 && h > 2 && h > minHeight / 4) {
        const key = `${describe(a.el)}|${describe(b.el)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        problems.push({ kind: 'text-overlap', detail: `${Math.round(w)}×${Math.round(h)}px`, at: [describe(a.el), describe(b.el)] });
      }
    }
  }

  // 4. タップ領域：44×44 以上（文中のリンクは除く。WCAG 2.5.8 の例外）
  for (const el of document.querySelectorAll('button, a[href], [role="button"], input:not([type="hidden"]), select, summary')) {
    if (hiddenFromView(el)) continue;
    // ラベルの中のチェックボックスは、ラベル全体が押せる範囲
    const label = el.tagName === 'INPUT' ? el.closest('label') : null;
    const r = (label ?? el).getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.tagName === 'A') {
      // 文中のリンク：行内に置かれ、同じ行の流れ（いちばん近いブロックの箱の中の、行内の要素）にリンク以外の文字が
      // 2 文字以上ある（「出典: <a>」「…のきまり: <a>、<a>」など）。別のブロック（見出し・段落）の文字は数えない。
      // 区切りの「・」「|」だけなら文中ではない
      let block = el.parentElement;
      while (block && getComputedStyle(block).display.startsWith('inline')) block = block.parentElement;
      const otherText = block
        ? [...block.childNodes].reduce(function count(n, node) {
            if (node === el) return n;
            if (node.nodeType === Node.TEXT_NODE) return n + node.textContent.replace(/\s/g, '').length;
            if (node.nodeType !== Node.ELEMENT_NODE || node.tagName === 'A' || node.classList.contains('sr-only')) return n;
            if (!getComputedStyle(node).display.startsWith('inline')) return n;
            return [...node.childNodes].reduce(count, n);
          }, 0)
        : 0;
      if (getComputedStyle(el).display === 'inline' && otherText >= 2) continue;
    }
    if (el.closest('[data-allow-small-target]')) continue;
    if (r.width < 44 - 0.5 || r.height < 44 - 0.5) {
      problems.push({ kind: 'small-target', detail: `${Math.round(r.width)}×${Math.round(r.height)}px`, at: [describe(el)] });
    }
  }
  return problems;
}

async function listPages(browser) {
  const page = await browser.newPage();
  let res;
  try {
    res = await page.goto(`${BASE_URL}/dev/gallery`, { waitUntil: 'load' });
  } catch (e) {
    throw new Error(`${BASE_URL} が開けません（${e.message.split('\n')[0]}）。別の端末で pnpm dev を動かしてから実行してください。`);
  }
  if (!res?.ok()) throw new Error(`/dev/gallery が HTTP ${res?.status()} です（開けるのは pnpm dev のときだけ）。`);
  const screens = await page.$$eval('a[data-screen]', (as) => as.map((a) => a.dataset.screen));
  await page.close();
  if (screens.length === 0) throw new Error('/dev/gallery に画面がありません。');
  return [
    { name: 'home', path: '/' },
    { name: 'terms', path: '/terms' },
    { name: 'privacy', path: '/privacy' },
    ...screens.map((s) => ({ name: `gallery-${s}`, path: `/dev/gallery?screen=${s}`, screen: s })),
  ];
}

/** ダイアログそのものを見せる画面（同意の確認画面が開いていてよい） */
const showsDialog = (target) => /^gallery-(dialog-|scanner)/.test(target.name);

/** 1つの大きさで全画面を調べる。出力は大きさごとにまとめて返す（並べて動かしても混ざらない） */
async function checkSize(browser, size, pagesToCheck) {
  const context = await browser.newContext({ ...size.context, locale: 'ja-JP', reducedMotion: 'reduce' });
  context.setDefaultTimeout(20_000);
  await context.addInitScript(({ key, version }) => localStorage.setItem(key, version), CONSENT);
  const results = [];
  const lines = [];
  try {
    for (const target of pagesToCheck) {
      const page = await context.newPage();
      const shot = `${OUT_DIR}/${target.name}--${size.name}.png`;
      let problems = [];
      try {
        // networkidle は使わない（開発サーバーの再読み込みの接続がずっと開いている）
        const res = await page.goto(`${BASE_URL}${target.path}`, { waitUntil: 'load' });
        if (!res?.ok()) throw new Error(`HTTP ${res?.status()}`);
        if (target.screen && !(await page.$(`[data-gallery-screen="${target.screen}"]`))) {
          throw new Error(`gallery screen "${target.screen}" did not render`);
        }
        await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((res) => setTimeout(res, 5000))]));
        if (size.textZoom) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        await page.waitForTimeout(300);
        if (!showsDialog(target) && (await page.$('dialog[open]'))) {
          throw new Error('同意の確認画面が開いています（保存した同意の版が古い）');
        }
        problems = await page.evaluate(inspectPage);
      } catch (e) {
        problems.push({ kind: 'page-error', detail: e.message.split('\n')[0], at: [target.path] });
      }
      // 並べて動かすと、縦に長いページの全体のスクリーンショットに失敗することがある。そのときは見えている範囲だけ
      await page
        .screenshot({ path: shot, fullPage: true })
        .catch(() => page.screenshot({ path: shot }))
        .catch((e) => problems.push({ kind: 'screenshot-error', detail: e.message.split('\n')[0], at: [target.path] }));
      results.push({ page: target.name, path: target.path, size: size.name, problems, screenshot: shot });
      const mark = problems.length ? `✖ ${problems.length}` : '✓';
      lines.push(`${mark.padEnd(5)} ${size.name.padEnd(18)} ${target.name}`);
      for (const p of problems.slice(0, 5)) lines.push(`        ${p.kind}: ${p.detail}\n          ${p.at.join('\n          ')}`);
      if (problems.length > 5) lines.push(`        …ほか ${problems.length - 5} 件（${OUT_DIR}/report.json）`);
      await page.close();
    }
  } finally {
    await context.close();
    console.log(lines.join('\n'));
  }
  return results;
}

const engines = { chromium, webkit };
const browsers = {};
const closeAll = () => Promise.all(Object.values(browsers).map((b) => b.close().catch(() => {})));

/**
 * --self-test：検査そのものを確かめる（サーバーは要らない）。わざと崩したページで、それぞれの崩れが見つかり、
 * 崩れていない見本（切られた truncate の文・文中のリンク・ラベルの中のチェックボックス）は見逃されることを確かめる。
 * 誤検出を減らすために検査を変えたら、これで見落としが増えていないか確かめる
 */
async function selfTest() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(`<!doctype html><html lang="ja"><body style="margin:0;font:16px sans-serif;overflow-wrap:anywhere">
    <div id="ok">
      <div style="display:flex;width:300px"><div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">とても長い商品名がここで省略記号になって切れる、とても長い商品名</div><button style="min-width:44px;min-height:44px">見る</button></div>
      <p>出典: <a href="#">文中のリンク</a></p>
      <label style="display:flex;min-height:44px;align-items:center"><input type="checkbox">ラベル全体が押せる</label>
      <h2 style="font-size:24px;line-height:1.1;margin:0">詰めた行の見出し</h2><p style="font-size:12px;margin:0">すぐ下の行（字は重ならない）</p>
    </div>
    <div id="bad">
      <div style="width:200px"><span style="display:inline-block;white-space:nowrap">はみ出す長い一行の文字はみ出す長い一行の文字</span></div>
      <div style="position:relative;height:40px"><span style="position:absolute;left:0;top:0">重なる文字その一</span><span style="position:absolute;left:10px;top:4px">重なる文字その二</span></div>
      <button style="width:30px;height:30px">小</button>
      <div><h3>見出しの文字</h3><a href="#">単独のリンク</a></div>
      <div style="position:relative;height:30px"><span style="position:absolute;top:0;font-size:12px;line-height:14px">上の行の文字です</span><span style="position:absolute;top:8px;font-size:12px;line-height:14px">下の行の文字です</span></div>
      <div style="position:relative"><span>アイコンに隠れる文字</span><svg style="position:absolute;left:0;top:0" width="200" height="20"><rect width="60" height="20"/></svg></div>
      <div style="height:7px;overflow:hidden;font-size:14px;line-height:14px"><span>半分隠れる行</span></div>
      <div style="height:40px;overflow:hidden"><p style="margin:0;height:120px">隠れる</p></div>
      <div style="width:1200px;height:10px"></div>
    </div>
  </body></html>`);
  const found = await page.evaluate(inspectPage);
  await browser.close();
  const kinds = new Set(found.map((p) => p.kind));
  const expected = ['horizontal-scroll', 'overflow', 'text-overlap', 'small-target', 'clipped-y'];
  const missing = expected.filter((k) => !kinds.has(k));
  // （下で、個々の見本も足す）
  const falseAlarms = found.filter((p) => p.at.some((a) => /省略記号|文中のリンク|ラベル全体|詰めた行|すぐ下の行/.test(a)));
  // 個々の見本が見つかったか（種類だけでなく、どれが見つかったか）
  const mustFind = [
    ['small-target', /単独のリンク/],
    ['text-overlap', /下の行の文字/],
    ['text-overlap', /アイコンに隠れる/],
    ['clipped-y', /半分隠れる/],
  ].filter(([kind, re]) => !found.some((p) => p.kind === kind && p.at.some((a) => re.test(a))));
  missing.push(...mustFind.map(([kind, re]) => `${kind} ${re.source}`));
  if (missing.length || falseAlarms.length) {
    console.error(`自己テストに失敗：見つからなかった崩れ ${missing.join('、') || 'なし'} / 崩れていないのに報告 ${falseAlarms.length} 件`);
    for (const p of falseAlarms) console.error(`  ${p.kind}: ${p.at.join(' / ')}`);
    process.exit(1);
  }
  console.log(`自己テスト：${expected.join('、')} を見つけ、崩れていない見本は報告しませんでした`);
  process.exit(0);
}
if (args.selfTest) await selfTest();

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

let report;
try {
  browsers.chromium = await chromium.launch();
  const pages = await listPages(browsers.chromium);
  const pagesToCheck = args.only ? pages.filter((p) => p.name.includes(args.only) || p.path.includes(args.only)) : pages;
  const sizes = args.size ? SIZES.filter((s) => s.name.includes(args.size)) : SIZES;
  if (pagesToCheck.length === 0) throw new Error(`--only=${args.only} に当てはまる画面がありません。`);
  if (sizes.length === 0) throw new Error(`--size=${args.size} に当てはまる大きさがありません（${SIZES.map((s) => s.name).join('、')}）。`);

  // 開発サーバーは初めて開いたページをその場でビルドする。並べて開く前に1回ずつ開いておく（待ち時間切れを防ぐ）
  for (const p of pagesToCheck) await fetch(`${BASE_URL}${p.path}`).catch(() => {});
  for (const size of sizes) browsers[size.engine] ??= await engines[size.engine].launch();

  // 1つの大きさで失敗しても、ほかの大きさの結果は残す
  const settled = await Promise.allSettled(sizes.map((size) => checkSize(browsers[size.engine], size, pagesToCheck)));
  report = settled.flatMap((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : [{ page: '*', path: '*', size: sizes[i].name, screenshot: null, problems: [{ kind: 'page-error', detail: String(s.reason?.message ?? s.reason).split('\n')[0], at: [] }] }]
  );
} catch (e) {
  await closeAll();
  fail(e.message);
}
await closeAll();

writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2));
const failed = report.filter((r) => r.problems.length > 0);
const byKind = {};
for (const r of failed) for (const p of r.problems) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
console.log(
  `\n${report.length} 画面×大きさのうち ${failed.length} 件に崩れ` +
    (failed.length ? `（${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join('、')}）` : '') +
    `。スクリーンショットと詳細：${OUT_DIR}/`
);
process.exit(failed.length ? 1 : 0);
