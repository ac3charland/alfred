import {
  APPLE_SPLASH_DEVICES,
  SPLASH_BACKGROUND,
  appleStartupImages,
  parseSplashSize,
  splashGlyphMetrics,
} from './apple-splash-screens';

describe('APPLE_SPLASH_DEVICES', () => {
  it('covers a modern iPhone lineup, all portrait with plausible pixel ratios', () => {
    expect(APPLE_SPLASH_DEVICES.length).toBeGreaterThanOrEqual(8);
    for (const device of APPLE_SPLASH_DEVICES) {
      expect(device.ptHeight).toBeGreaterThan(device.ptWidth);
      expect([2, 3]).toContain(device.dpr);
    }
  });

  it('has no duplicate device-width/device-height/dpr combinations', () => {
    const keys = APPLE_SPLASH_DEVICES.map(
      (d) => `${String(d.ptWidth)}x${String(d.ptHeight)}@${String(d.dpr)}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('appleStartupImages', () => {
  it('emits one portrait startup image per device, sized to physical pixels', () => {
    const images = appleStartupImages();
    expect(images).toHaveLength(APPLE_SPLASH_DEVICES.length);

    for (const [i, { ptWidth, ptHeight, dpr }] of APPLE_SPLASH_DEVICES.entries()) {
      const image = images[i];
      if (!image) throw new Error(`missing startup image at index ${String(i)}`);
      expect(image.url).toBe(`/splash?w=${String(ptWidth * dpr)}&h=${String(ptHeight * dpr)}`);
      expect(image.media).toContain(`(device-width: ${String(ptWidth)}px)`);
      expect(image.media).toContain(`(device-height: ${String(ptHeight)}px)`);
      expect(image.media).toContain(`(-webkit-device-pixel-ratio: ${String(dpr)})`);
      expect(image.media).toContain('(orientation: portrait)');
    }
  });

  it('resolves a known device (390×844 @3) to a 1170×2532 image', () => {
    const images = appleStartupImages([{ name: 'test', ptWidth: 390, ptHeight: 844, dpr: 3 }]);
    expect(images).toEqual([
      {
        url: '/splash?w=1170&h=2532',
        media:
          'screen and (device-width: 390px) and (device-height: 844px) ' +
          'and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)',
      },
    ]);
  });
});

describe('parseSplashSize', () => {
  it('accepts positive integer dimensions', () => {
    expect(parseSplashSize(new URLSearchParams('w=1170&h=2532'))).toEqual({
      width: 1170,
      height: 2532,
    });
  });

  it.each([
    ['missing params', ''],
    ['non-numeric', 'w=abc&h=2532'],
    ['zero', 'w=0&h=2532'],
    ['negative', 'w=1170&h=-1'],
    ['non-integer', 'w=1170.5&h=2532'],
    ['oversized', 'w=99999&h=2532'],
  ])('rejects %s', (_label, query) => {
    expect(parseSplashSize(new URLSearchParams(query))).toBeNull();
  });
});

describe('splashGlyphMetrics', () => {
  it('sizes the glyph to 30% of the smaller (portrait width) edge', () => {
    expect(splashGlyphMetrics(1170, 2532).fontSize).toBe(351);
  });

  it('scales the optical-centering margin with the font size', () => {
    const { fontSize, marginBottom } = splashGlyphMetrics(1170, 2532);
    expect(marginBottom).toBe(Math.round(fontSize * (34 / 158)));
    expect(marginBottom).toBeGreaterThan(0);
  });
});

describe('SPLASH_BACKGROUND', () => {
  it('is the navy brand color', () => {
    expect(SPLASH_BACKGROUND).toBe('#1E2A3F');
  });
});
