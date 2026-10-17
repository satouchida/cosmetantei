import type { Metadata, Viewport } from 'next';
import { Noto_Sans_JP } from 'next/font/google';
import './globals.css';

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

export const metadata: Metadata = {
  title: 'コスメ探偵 (CosmeTantei) - 敏感肌向け化粧品成分チェッカー＆AIスキンケア相談',
  description:
    'コスメ探偵 (cosmetantei) があなたの肌荒れ原因成分を特定！日本・韓国・アメリカのコスメ全成分＆JANバーコード対応。安全な成分のみで作られた安心の代替コスメをAmazonから探せます。',
  metadataBase: new URL('https://cosmetantei.com'),
  alternates: {
    canonical: 'https://cosmetantei.com',
  },
  openGraph: {
    title: 'コスメ探偵 (CosmeTantei) - 敏感肌成分チェッカー',
    description: '肌荒れ・ヒリつき・赤みの原因成分を差分であぶり出すAIコスメ探偵。',
    url: 'https://cosmetantei.com',
    siteName: 'コスメ探偵 (CosmeTantei)',
    locale: 'ja_JP',
    type: 'website',
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
