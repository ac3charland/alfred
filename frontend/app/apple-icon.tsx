import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// Matches the icon.svg favicon: dark navy rounded square with centred white "a".
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
      <div style={{ color: 'white', fontSize: 158, lineHeight: 1 }}>a</div>
    </div>,
    { width: 180, height: 180 },
  );
}
