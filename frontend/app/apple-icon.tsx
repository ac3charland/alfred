import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

const font = readFileSync(path.join(process.cwd(), 'public/fonts/liberation-serif.ttf'));

// Matches the icon.svg favicon: dark navy rounded square with white serif "a".
// marginBottom shifts the letter upward in flexbox centering so dark space above
// and below the glyph is equal (measured: 52px each at 180×180).
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#1E2A3F',
        borderRadius: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          color: 'white',
          fontSize: 158,
          lineHeight: 1,
          fontFamily: 'Serif',
          marginBottom: 34,
        }}
      >
        a
      </div>
    </div>,
    {
      width: 180,
      height: 180,
      fonts: [{ name: 'Serif', data: font, weight: 400, style: 'normal' }],
    },
  );
}
