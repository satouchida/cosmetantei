// pnpm dev: .dev.vars（AI Gateway のトークン等）を読み込んでから next dev を起動する。
// Next 16 は Node の起動フラグを NODE_OPTIONS 経由で子プロセスに渡すため、
// --env-file 系のフラグ（NODE_OPTIONS では使用不可）ではなく、ここで環境変数に読み込む。
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// どのディレクトリから実行してもプロジェクトのルートで動かす
process.chdir(fileURLToPath(new URL('..', import.meta.url)));

if (existsSync('.dev.vars')) {
  process.loadEnvFile('.dev.vars');
}

const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, 'dev', '-p', '3001', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (err) => {
  console.error('next dev を起動できませんでした:', err);
  process.exit(1);
});

// Ctrl+C（SIGINT）は端末から子プロセスにも届くため、ここで転送しない（二重に送ると Next が強制終了する）
process.on('SIGINT', () => {});
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
