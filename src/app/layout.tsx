import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Inner Weather — 心の天気を、観察する',
  description: '日記と過去の会話をつなぎ、心の変化をやさしく観察するプライベートジャーナル。',
  robots: { index: false, follow: false },
  applicationName: 'Inner Weather',
  icons: { icon: '/inner-weather.svg' },
  appleWebApp: { capable: true, title: 'Inner Weather', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f7f6f2',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
