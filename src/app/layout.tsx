import type { Metadata } from 'next';
import './globals.css';

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
    <html lang="ja">
      <body className="antialiased min-h-screen selection:bg-sage-200 selection:text-sage-900">
        {children}
      </body>
    </html>
  );
}
