import type { Metadata } from 'next';
import localFont from 'next/font/local';

import { appleStartupImages } from '@/lib/apple-splash-screens';

import './globals.css';

// Use locally-bundled Geist fonts so the build works in air-gapped environments.
// The woff2 files are copied from next/dist/next-devtools/server/font/ and
// committed to public/fonts/. In production (Vercel), the network is available
// so next/font/google could be used instead, but local files work everywhere.
const geistSans = localFont({
  src: '../public/fonts/geist-sans.woff2',
  variable: '--font-geist-sans',
  display: 'swap',
});

const geistMono = localFont({
  src: '../public/fonts/geist-mono.woff2',
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Alfred',
  description: 'A capture-first personal task system',
  // Standalone ("Add to Home Screen") web-app support: `capable` opts into the
  // full-screen chrome, and each startup image is the navy centered-"a" splash
  // shown while the app launches, matched per iPhone by media query.
  appleWebApp: {
    capable: true,
    title: 'Alfred',
    startupImage: appleStartupImages(),
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} min-h-dvh antialiased scrollbar-gutter-stable`}
    >
      <body className="min-h-dvh flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
