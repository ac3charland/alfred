import * as React from 'react';

/**
 * A decorator for a component that fetches on mount via `lib/api-client` (`PrRatio`,
 * `LocVelocity`, `WeeklyPlanItems`, …): stubs `fetch` for the story's duration so it renders a
 * deterministic answer with no network and no clock — `undefined` body means "never settles",
 * which parks the component in its loading state; `status >= 400` its error state.
 *
 * One shared stub rather than a per-story copy: three near-identical versions had already
 * drifted (one gated the pending branch on `status === 200` too, the others didn't), so a real
 * behaviour difference could silently vary by story file. Every `stubEndpoint` call site should
 * use this. Lives under `lib/`, not `.storybook/`: a story file `import`s it directly, which
 * pulls it into the main tsconfig's program regardless of `.storybook/`'s dot-directory
 * exclusion — placing it there would fight the `allowDefaultProject` escape hatch that exists
 * for the config-only files that stay orphaned from that program (`supabase-ssr-mock.ts`).
 */
export function stubEndpoint(status: number, body?: unknown) {
  return (Story: React.ComponentType) => {
    globalThis.fetch = (() =>
      body === undefined
        ? // Racing zero promises never settles — no no-op executor needed, which sidesteps the
          // `unicorn/no-useless-undefined` ↔ `@typescript-eslint/no-empty-function` tug-of-war a
          // `new Promise(() => {})` idiom hits outside the story/test file globs that exempt it.
          Promise.race([])
        : Promise.resolve({
            ok: status < 400,
            status,
            json: () => Promise.resolve(body),
            text: () => Promise.resolve(JSON.stringify(body)),
          })) as unknown as typeof fetch;
    return <Story />;
  };
}
