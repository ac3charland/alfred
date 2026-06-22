import '@testing-library/jest-dom';

// Default-stub the browser Supabase client so any component that mounts `CodeProvider`
// (which opens a `code_items` Realtime channel in an effect) renders under jsdom without a
// live connection or env vars. Returns a no-op channel; tests that exercise the realtime
// handler override this with their own `jest.mock('@/lib/supabase/client', …)` (a file-level
// mock wins over this setup-file one), as the login-form and code-store tests do.
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const channel = { on: () => channel, subscribe: () => channel };
    return { channel: () => channel, removeChannel: () => Promise.resolve('ok') };
  },
}));

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
