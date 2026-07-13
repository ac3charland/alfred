import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ImageResponse } from 'next/og';
import { type NextRequest } from 'next/server';

import { SPLASH_BACKGROUND, parseSplashSize, splashGlyphMetrics } from '@/lib/apple-splash-screens';

const font = readFileSync(path.join(process.cwd(), 'public/fonts/lora.ttf'));

/**
 * iOS Home-Screen launch image: a centered serif "a" on the navy brand
 * background, generated at the exact pixel size requested via `?w=&h=`. Sizes
 * are enumerated per device in `layout.tsx`'s `appleWebApp.startupImage`.
 */
export function GET(request: NextRequest): Response {
  const size = parseSplashSize(new URL(request.url).searchParams);
  if (!size) {
    return new Response('Invalid splash size', { status: 400 });
  }

  const { width, height } = size;
  const { fontSize, marginBottom } = splashGlyphMetrics(width, height);

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        background: SPLASH_BACKGROUND,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          color: 'white',
          fontSize,
          lineHeight: 1,
          fontFamily: 'Serif',
          marginBottom,
        }}
      >
        a
      </div>
    </div>,
    {
      width,
      height,
      fonts: [{ name: 'Serif', data: font, weight: 400, style: 'normal' }],
    },
  );
}
