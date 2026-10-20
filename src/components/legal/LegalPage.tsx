import React from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { AFFILIATE_DISCLOSURE } from '@/lib/site';

/** 利用規約・プライバシーポリシーの見出しと本文の体裁 */
export const LegalPage: React.FC<{ title: string; enactedOn: string; children: React.ReactNode }> = ({
  title,
  enactedOn,
  children,
}) => (
  <div className="min-h-screen bg-surface text-ink">
    <header className="border-b border-sand-200 bg-white">
      <div className="max-w-[760px] mx-auto px-4 py-3 flex items-center gap-3">
        <Link
          href="/"
          className="min-h-11 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden />
          コスメ探偵に戻る
        </Link>
      </div>
    </header>
    <main className="max-w-[760px] mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-ink">{title}</h1>
      <p className="mt-1 text-sm text-ink-muted">制定日：{enactedOn}</p>
      <div
        className={[
          'mt-6 space-y-4 text-[15px] leading-relaxed',
          '[&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-ink',
          '[&_h3]:mt-6 [&_h3]:font-bold [&_h3]:text-ink',
          '[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1',
          '[&_ol_ol]:list-[lower-roman] [&_ol_ol]:mt-2',
          '[&_a]:text-primary [&_a]:underline [&_a]:[overflow-wrap:anywhere]',
          '[&_table]:w-full [&_table]:text-sm [&_th]:text-left [&_th]:align-top [&_td]:align-top',
          '[&_th]:border [&_td]:border [&_th]:border-sand-200 [&_td]:border-sand-200 [&_th]:p-2 [&_td]:p-2 [&_th]:bg-surface-container-low',
        ].join(' ')}
      >
        {children}
      </div>
    </main>
    <footer className="border-t border-sand-200 bg-white">
      <div className="max-w-[760px] mx-auto px-4 py-4">
        <LegalLinks />
        <p className="text-xs text-ink-muted">{AFFILIATE_DISCLOSURE}</p>
      </div>
    </footer>
  </div>
);

/** 表は狭い画面では横にスクロールさせる（ページ全体は横にはみ出さない） */
export const LegalTable: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  // 横にスクロールする部分はキーボードでもスクロールできるよう、フォーカスできる領域にする
  <div
    role="region"
    aria-label="表（横にスクロールできます）"
    tabIndex={0}
    className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-primary"
  >
    <table className="min-w-[880px]">{children}</table>
  </div>
);

/** 外部のページへのリンク（新しいタブで開く） */
export const ExternalLink: React.FC<{ href: string; children?: React.ReactNode }> = ({ href, children }) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {children ?? href}
  </a>
);

/** トップ画面と規約のページの下に出す、規約へのリンク（電気通信事業法の外部送信規律：1回の操作で届く位置） */
export const LegalLinks: React.FC<{ className?: string }> = ({ className = '' }) => (
  <nav aria-label="規約" className={`flex flex-wrap gap-x-4 text-xs text-ink-muted ${className}`}>
    <Link href="/terms" className="inline-flex min-h-11 items-center hover:underline">
      利用規約
    </Link>
    <Link href="/privacy" className="inline-flex min-h-11 items-center hover:underline">
      プライバシーポリシー（外部送信について）
    </Link>
  </nav>
);
