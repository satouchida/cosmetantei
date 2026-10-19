import type { Metadata, Viewport } from 'next';
import { Noto_Sans_JP } from 'next/font/google';
import './globals.css';
import { SITE_URL } from '@/lib/site';

// デザインシステムの書体。日本語の字形はページで使う分だけ読み込まれるため、先読みはしない
const notoSansJp = Noto_Sans_JP({
  subsets: ['latin'],
  variable: '--font-noto-sans-jp',
  display: 'swap',
  preload: false,
});

export const viewport: Viewport = {
  themeColor: '#006a4e',
};

const SITE_NAME = 'コスメ探偵 (CosmeTantei)';
const TITLE = 'コスメ探偵 | 敏感肌のための化粧品成分チェッカー';
// 診断や「安全」の保証はしない（原因になりうる成分の候補を示す）
const DESCRIPTION =
  '肌荒れ・ヒリつき・赤みが出た化粧品と、問題なく使えている化粧品の全成分を比べて、刺激の原因になりうる成分の候補を示すツールです。日本・韓国・アメリカのコスメとJANバーコードに対応。医療上の診断の代わりにはなりません。';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: '%s | コスメ探偵' },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: '/',
    siteName: SITE_NAME,
    locale: 'ja_JP',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" className={notoSansJp.variable}>
      <body className="antialiased min-h-screen selection:bg-sage-200 selection:text-sage-950">
        {children}
      </body>
    </html>
  );
}
