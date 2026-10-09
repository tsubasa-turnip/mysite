import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Inner Weather — 心の天気を、観察する',
    short_name: 'Inner Weather',
    description: '日記と過去の会話から、心の変化をやさしく観察するプライベートジャーナル。',
    lang: 'ja',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f6f2',
    theme_color: '#f7f6f2',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
