import '@testing-library/jest-dom';

// jsdom does not implement `matchMedia`. Provide a minimal stub (defaults to
// "no match", i.e. motion allowed) so components that read a media query — e.g.
// prefers-reduced-motion via `useSyncExternalStore` — can render under jsdom.
const createMatchMedia = (query: string): MediaQueryList =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }) as unknown as MediaQueryList;

globalThis.matchMedia = createMatchMedia;
