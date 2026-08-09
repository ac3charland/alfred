/**
 * A typed stand-in for `jest.spyOn(globalThis, 'fetch')`, used by the test files in this
 * package. It is not part of the Worker — nothing under the `fetch`/`scheduled` entrypoints
 * imports it, so it is never bundled.
 *
 * Why it has to exist: `@anthropic-ai/sdk` imports `undici-types`, which pulls in the whole of
 * `@types/node` via a `/// <reference types="node" />` that the package's `types` list cannot
 * suppress. `@types/node` declares its OWN global `fetch` alongside the Workers one, so the
 * global becomes an overload set. `jest.spyOn` cannot pick an overload: the spy degrades to an
 * unresolved type, every `.mock` / `.mockImplementation` access on it becomes "unsafe member
 * access", and a stub's callback parameters fall back to implicit `any`.
 *
 * Narrowing the global to the single signature this Worker actually calls fixes that once,
 * here, instead of at every call site — and keeps the reason recorded next to the workaround.
 */

/** The first argument a `fetch` stub receives. */
export type FetchInput = Parameters<typeof globalThis.fetch>[0];

/** The second argument a `fetch` stub receives. */
export type FetchInit = Parameters<typeof globalThis.fetch>[1];

/** The one `fetch` signature this Worker calls, extracted from the overloaded global. */
export type FetchStub = (input: FetchInput, init?: FetchInit) => Promise<Response>;

/** Spy on the global `fetch` with a resolvable type. Restored by jest's `restoreMocks`. */
export function spyOnFetch(): jest.SpyInstance<Promise<Response>, Parameters<FetchStub>> {
  return jest.spyOn(globalThis as unknown as { fetch: FetchStub }, 'fetch');
}
