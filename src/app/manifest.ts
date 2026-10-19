import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'コスメ探偵 (CosmeTantei)',
    short_name: 'コスメ探偵',
    description: '化粧品の全成分を比べて、肌荒れ・ヒリつき・赤みの原因になりうる成分の候補を示すツール。',
    id: '/',
    lang: 'ja',
    scope: '/',
    start_url: '/',
    display: 'standalone',
    background_color: '#f8faf9',
    theme_color: '#006a4e',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
