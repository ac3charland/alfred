/**
 * Storybook stand-in for `@supabase/ssr` (aliased in `main.ts`). Stories that mount
 * `CodeProvider` call `createBrowserClient` via `@/lib/supabase/client` to open a `code_items`
 * Realtime channel; Storybook has no Supabase env vars or live backend, so return a no-op
 * channel instead. Aliasing the bare package (not the `@/…` path) reliably wins over the Next
 * path-resolution plugin. (Lives at `.storybook/*.ts` so the ESLint project service picks it up.)
 *
 * It also exposes `globalThis.emitCodeItemsUpdate(row)` so a story can simulate the out-of-band
 * Worker write — the demo's "second writer" — and show a card move swimlanes live.
 */
const updateHandlers: ((payload: { new: unknown }) => void)[] = [];

function fakeClient() {
  const channel = {
    on: (_event: string, _filter: unknown, handler: (payload: { new: unknown }) => void) => {
      updateHandlers.push(handler);
      return channel;
    },
    subscribe: () => channel,
  };
  return { channel: () => channel, removeChannel: () => Promise.resolve('ok') };
}

export function createBrowserClient() {
  return fakeClient();
}

export function createServerClient() {
  return fakeClient();
}

(globalThis as Record<string, unknown>).emitCodeItemsUpdate = (row: unknown) => {
  for (const handler of updateHandlers) handler({ new: row });
};
