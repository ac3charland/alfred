import type { Metadata } from 'next';
import localFont from 'next/font/local';

import { ToastProvider } from '@/lib/stores/toast-store';

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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased scrollbar-gutter-stable`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/* App-global toast queue. Mounted above both module layouts so any provider
            beneath it — including the code module's realtime subscription in
            CodeProvider — can fire a toast. The viewport itself lives in AppShell. */}
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
