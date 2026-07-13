/**
 * iOS only shows a Home-Screen launch ("splash") image when an
 * `apple-touch-startup-image` link matches the device's *exact* point
 * dimensions and pixel ratio via a media query — otherwise it falls back to a
 * blank background. This module is the single source of truth for the modern
 * iPhone lineup we cover, the metadata entries advertised in the root layout,
 * and the size/rendering helpers used by the `/splash` image generator.
 */

/** Navy brand background, matching `apple-icon.tsx` and `icon.svg`. */
export const SPLASH_BACKGROUND = '#1E2A3F';

/** Largest splash dimension we'll generate, guarding the `/splash` route. */
const MAX_SPLASH_DIMENSION = 4096;

export interface AppleSplashDevice {
  /** Human label, for readability of the list. */
  name: string;
  /** CSS-point width (portrait). */
  ptWidth: number;
  /** CSS-point height (portrait). */
  ptHeight: number;
  /** Device pixel ratio. */
  dpr: number;
}

/**
 * Current-generation iPhones (portrait). Physical pixels = points × dpr; the
 * generated image must be that exact pixel size for iOS to display it.
 */
export const APPLE_SPLASH_DEVICES: readonly AppleSplashDevice[] = [
  { name: 'iPhone SE / 8', ptWidth: 375, ptHeight: 667, dpr: 2 },
  { name: 'iPhone 12/13 mini', ptWidth: 375, ptHeight: 812, dpr: 3 },
  { name: 'iPhone 11 / XR', ptWidth: 414, ptHeight: 896, dpr: 2 },
  { name: 'iPhone 11 Pro Max / XS Max', ptWidth: 414, ptHeight: 896, dpr: 3 },
  { name: 'iPhone 12/13/14', ptWidth: 390, ptHeight: 844, dpr: 3 },
  { name: 'iPhone 14 Pro / 15 / 16', ptWidth: 393, ptHeight: 852, dpr: 3 },
  { name: 'iPhone 16 Pro', ptWidth: 402, ptHeight: 874, dpr: 3 },
  { name: 'iPhone 12/13/14 Pro Max, 14 Plus', ptWidth: 428, ptHeight: 926, dpr: 3 },
  { name: 'iPhone 15/16 Pro Max, 15/16 Plus', ptWidth: 430, ptHeight: 932, dpr: 3 },
  { name: 'iPhone 16 Pro Max', ptWidth: 440, ptHeight: 956, dpr: 3 },
];

export interface AppleStartupImage {
  url: string;
  media: string;
}

/**
 * Build the `apple-touch-startup-image` link descriptors for the covered
 * devices — one per device, each pointing at the `/splash` generator sized to
 * that device's physical pixels and gated by a portrait media query.
 */
export function appleStartupImages(
  devices: readonly AppleSplashDevice[] = APPLE_SPLASH_DEVICES,
): AppleStartupImage[] {
  return devices.map(({ ptWidth, ptHeight, dpr }) => ({
    url: `/splash?w=${String(ptWidth * dpr)}&h=${String(ptHeight * dpr)}`,
    media:
      `screen and (device-width: ${String(ptWidth)}px) and (device-height: ${String(ptHeight)}px) ` +
      `and (-webkit-device-pixel-ratio: ${String(dpr)}) and (orientation: portrait)`,
  }));
}

/**
 * Parse and validate the `/splash` route's `w`/`h` query params. Returns the
 * requested pixel size, or `null` when either value is missing, non-integer,
 * or outside `[1, MAX_SPLASH_DIMENSION]`.
 */
export function parseSplashSize(params: URLSearchParams): { width: number; height: number } | null {
  const width = Number(params.get('w'));
  const height = Number(params.get('h'));
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width < 1 || height < 1) return null;
  if (width > MAX_SPLASH_DIMENSION || height > MAX_SPLASH_DIMENSION) return null;
  return { width, height };
}

/**
 * Size the centered "a" for a splash canvas. The glyph is 30% of the smaller
 * edge, and `marginBottom` reproduces the optical-centering shift from
 * `apple-icon.tsx` (34px at fontSize 158) scaled to this size.
 */
export function splashGlyphMetrics(
  width: number,
  height: number,
): { fontSize: number; marginBottom: number } {
  const fontSize = Math.round(Math.min(width, height) * 0.3);
  const marginBottom = Math.round(fontSize * (34 / 158));
  return { fontSize, marginBottom };
}
