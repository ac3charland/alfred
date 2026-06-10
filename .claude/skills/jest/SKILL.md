---
name: jest
description: >
  Use when writing or modifying Jest tests in the alfred monorepo (TypeScript,
  co-located test files). Covers: describe/it/test structure, expect matchers,
  all mock APIs (jest.fn / jest.mock / jest.spyOn), async testing patterns,
  fake timers, snapshots, setup lifecycle hooks, jest.config.ts per package,
  and eslint-plugin-jest constraints. Apply before creating any *.test.ts file
  or touching jest.config.ts in any package.
---

# Jest (alfred monorepo)

Sources used:
- Jest official docs — jestjs.io (configuration, mocking, async, timers, snapshot, setup/teardown)
- "Jest 30: Faster, Leaner, Better" — jest team blog, June 2025
- "From v29 to v30" — jest upgrade guide, jestjs.io
- "Jest Mocking Best Practices" — ISE Developer Blog, Microsoft (Tier 2)
- eslint-plugin-jest docs — jest-community/eslint-plugin-jest on GitHub
- ts-jest docs — kulshekhar.github.io/ts-jest

---

## Mental Model

Jest is a test runner built around **isolation per test file**. Each file runs in its own Node.js module registry (a fresh `require` cache). This is why `jest.mock()` works — it intercepts `require`/`import` before any module is loaded, replacing real implementations with fakes for the duration of that file's run. Mock state (call counts, return values) survives across tests within a file unless you explicitly clear/reset/restore it.

Two concepts underpin almost every Jest decision:

1. **The module registry reset boundary.** `jest.mock()` calls are hoisted to the top of the file (Babel or ts-jest transforms them). Every test in the file shares the same mock. Within a test you can override a mock's behavior with `mockReturnValue` / `mockResolvedValue` — that change persists until you clear it.

2. **The spy vs. replacement distinction.** `jest.spyOn` wraps an existing method and can restore it. `jest.mock` replaces the entire module at the registry level. `jest.fn()` is a standalone function with no original to restore. Choosing wrong between these is the #1 source of "mock didn't work" bugs.

TypeScript note: Jest runs TS files through a transformer (ts-jest or babel with `@babel/preset-typescript`). The transformer does NOT type-check — that is `tsc`'s job. Test files pass the linter and runner even with type errors unless you run `tsc --noEmit` separately (which `check:fast` does).

---

## Decision Tree: Which Mock API?

**Want to replace an entire imported module** (e.g., the Supabase client, a utility file, `node-fetch`)?
→ Use `jest.mock('module-path')` at the top of the file. Jest hoists it automatically.

**Want to intercept one method on an object/class that already exists** (e.g., spy on `console.error`, `Date.now`, or a method on an imported singleton)?
→ Use `jest.spyOn(object, 'methodName')`. Always call `.mockRestore()` in `afterEach` (or use `restoreAllMocks: true` in config).

**Want a standalone callable that records calls with no original to restore**?
→ Use `jest.fn()`. Common for injected dependencies, callback props, or building manual mocks inside a `jest.mock` factory.

**Want type-safe access to a mock's call data in TypeScript**?
→ Wrap with `jest.mocked(fn)` instead of casting. Available since Jest 27. Gives you `.mock.calls` typed correctly.

**Want to replace module for only one test** then restore?
→ Use `jest.spyOn` on the module's export object, or use `jest.isolateModules()` for a fresh registry. `jest.mock` is file-scoped — you cannot undo it per-test.

---

## Plain-English → Pattern Table

| When the agent hears... | Use this pattern | Key things to know |
|---|---|---|
| "co-located test for `utils/format.ts`" | Create `utils/format.test.ts` alongside the source | NEVER put tests in a top-level `__tests__/` dir — alfred convention requires sibling placement. `testMatch` in jest.config.ts uses `**/*.test.ts` |
| "mock this entire module / mock the Supabase client" | `jest.mock('../lib/supabase')` at file top, then use `jest.mocked(supabase)` to access typed mock | Hoisting: `jest.mock()` runs before all imports even if written after them. Factory arg `() => ({...})` lets you define shape. Must set `__esModule: true` for default exports |
| "spy on a method and restore it after" | `const spy = jest.spyOn(obj, 'method').mockReturnValue(...)` in `beforeEach`, `spy.mockRestore()` in `afterEach` | `mockRestore()` only works on spies — not on `jest.fn()`. `jest.restoreAllMocks()` in config's `afterEach` automates this |
| "mock a function that returns a value" | `const fn = jest.fn().mockReturnValue(42)` | For async: use `.mockResolvedValue(data)` not `.mockReturnValue(Promise.resolve(data))` — they're equivalent but the former is cleaner |
| "test an async function that resolves" | `await expect(asyncFn()).resolves.toEqual(...)` or `const result = await asyncFn(); expect(result).toEqual(...)` | Always `await` the assertion or return it. An un-awaited `.resolves` / `.rejects` assertion is a silent pass even if the promise rejects |
| "test an async function that rejects / throws" | `await expect(asyncFn()).rejects.toThrow('message')` | Must `await`. Add `expect.assertions(1)` above to catch cases where the rejection is swallowed and the assertion never runs |
| "mock fetch / HTTP calls" | `jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(data)))` OR use `jest.mock` on a wrapper module | Prefer mocking a thin wrapper (e.g., `src/lib/api.ts`) over global `fetch` — it's simpler and less brittle |
| "mock the Supabase client" | `jest.mock('../lib/supabase', () => ({ supabase: { from: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: [], error: null }) } }))` | Chain methods must each return `this` or the mock — Supabase builder is chainable. Store the mock reference via `jest.mocked` to reassign per-test |
| "fake timers for a setTimeout / setInterval" | `jest.useFakeTimers()` in `beforeEach`, `jest.useRealTimers()` in `afterEach`, then `await jest.advanceTimersByTimeAsync(ms)` | Use the `Async` variant (`advanceTimersByTimeAsync`) when timers interact with Promises — prevents promise/timer deadlock. Sync `advanceTimersByTime` hangs when promises are involved |
| "reset mock call history between tests" | `jest.clearAllMocks()` (in `afterEach` or via `clearMocks: true` in config) | `clearAllMocks` wipes call history but keeps implementation. `resetAllMocks` also removes implementations. `restoreAllMocks` restores spies to originals |
| "test that a function was NOT called" | `expect(mockFn).not.toHaveBeenCalled()` | Ensure mock is cleared before the test — stale call counts from a prior test cause false passes |
| "check an object partially matches expected shape" | `expect(obj).toEqual(expect.objectContaining({ key: value }))` | `toEqual` does deep equality but ignores `undefined`. `toStrictEqual` also checks object types and `undefined` properties — prefer `toStrictEqual` for value objects |
| "snapshot a serialized value" | `expect(value).toMatchInlineSnapshot()` or `.toMatchSnapshot()` | Use sparingly — snapshots should cover stable serialization (e.g., a formatter's output), not component markup. Prefer inline snapshots for small values so diffs are visible in code review |
| "run the same test with multiple inputs" | `test.each(table)(name, fn)` or `describe.each` | Use tagged template literal form for readable test names: `test.each\`...\`` |
| "set up shared state before each test" | `beforeEach(() => { ... })` inside the relevant `describe` block | `beforeEach` inside a `describe` only runs for tests in that block. Top-level `beforeEach` runs for every test in the file |

---

## Test Lifecycle: Hooks and Ordering

Jest runs all `describe` block bodies synchronously first to collect tests, then runs the tests. Hooks execute in this order:

```
(file) beforeAll
  (describe A) beforeAll
    beforeEach          ← outer
      (describe A) beforeEach
        test
      (describe A) afterEach
    afterEach           ← outer
  (describe A) afterAll
(file) afterAll
```

**Rules:**
- `beforeAll` / `afterAll` run once per `describe` scope, not per test.
- `beforeEach` / `afterEach` run for every test in scope — including tests nested in child `describe` blocks.
- Outer `beforeEach` runs before inner `beforeEach`. Outer `afterEach` runs after inner `afterEach`.
- Never put setup logic directly in a `describe` body — it runs during collection, before any hooks. Side effects there are a footgun.
- Async hooks must return a Promise or use `async/await`. Jest waits for them.

**Recommended global config** (in `jest.config.ts`):
```typescript
clearMocks: true,      // wipes call history after each test automatically
restoreAllMocks: true, // restores all spies to originals after each test
```
With these set, you rarely need manual `mockClear` / `mockRestore` calls.

---

## jest.config.ts for an alfred Package

Each code-bearing package has its own `jest.config.ts`. The canonical shape:

```typescript
import type { Config } from 'jest';

const config: Config = {
  // TypeScript transformer — ts-jest for type-safety, @swc/jest for speed
  // alfred uses ts-jest (type errors caught at CI via tsc separately)
  preset: 'ts-jest',

  // Node packages (workers, shared libs): 'node'
  // Frontend (React components): 'jsdom' — requires jest-environment-jsdom package
  testEnvironment: 'node',

  // Match co-located test files only — no __tests__/ dirs
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],

  // Clear call history and restore spies automatically
  clearMocks: true,
  restoreMocks: true,   // ← Jest 30: was "restoreAllMocks" in v29; renamed in v30

  // Path aliases must mirror tsconfig paths
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};

export default config;
```

For the **frontend** package with React Testing Library:
```typescript
testEnvironment: 'jsdom',
setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
```
Where `jest.setup.ts` contains `import '@testing-library/jest-dom'`. RTL is a separate skill — see integration note below.

**Route Handler tests need `@jest-environment node` docblock.** The `frontend/jest.config.ts` sets `testEnvironment: 'jsdom'` for all tests. But Next.js Route Handler tests use the Web Fetch API (`Request`, `Response`) which jsdom does not provide. Add `/** @jest-environment node */` as the first line of each Route Handler test file. Node.js 18+ provides `Request` and `Response` globally, so the test runs correctly in the `node` environment. The per-file docblock overrides the global config without modifying shared tooling.

**Frontend `@/*` alias: no `src/` subdir.** The `frontend/` package has no `src/` directory — files live at the package root. The tsconfig `paths` uses `"@/*": ["./*"]` (not `./src/*`). The jest `moduleNameMapper` must match:
```typescript
moduleNameMapper: {
  '^@/(.*)$': '<rootDir>/$1',  // No /src/ segment
},
```

**ts-jest JSX override for Next.js.** `frontend/tsconfig.json` sets `jsx: "preserve"` (required for the Next.js compiler). But ts-jest needs `jsx: "react-jsx"` to compile `.tsx` test files. Fix: override in the `transform` entry in `jest.config.ts` — do NOT change the tsconfig:
```typescript
transform: {
  '^.+\\.[tj]sx?$': [
    'ts-jest',
    {
      tsconfig: {
        jsx: 'react-jsx',
      },
    },
  ],
},
```

**ts-jest vs babel-jest vs @swc/jest:**
- `ts-jest`: Transforms TS with the TypeScript compiler. Slow on large suites but catches some type-level issues at transform time.
- `babel-jest` + `@babel/preset-typescript`: Fast, zero type checking — types are stripped. Suitable when `tsc` handles type checking separately (alfred's model).
- `@swc/jest`: Fastest option — Rust-based, no type checking. Drop-in for babel-jest.
- alfred default is `ts-jest` for correctness guarantees; switch to `@swc/jest` if test speed becomes a bottleneck.

---

## Common Pitfalls

**Never commit `test.only`, `it.only`, `describe.only`, `fit`, or `fdescribe`.** eslint-plugin-jest's `no-focused-tests` rule fires as an error in alfred. The ESLint gate in `check:fast` will block the commit.

**Never commit `test.skip` or `it.skip`.** alfred's ESLint config treats `no-disabled-tests` as an error. Fix or delete the test.

**Always `await` async assertions.** An un-awaited `expect(p).resolves.toBe(x)` silently passes even if `p` rejects. The `@typescript-eslint/no-floating-promises` rule catches this when the `expect()` result isn't awaited — but only if the test function is `async`.

**Always call `expect.assertions(n)` when testing rejection paths.** If the async function unexpectedly resolves instead of rejects, the `rejects.toThrow` assertion is never reached. `expect.assertions(1)` at the top of the test ensures the test fails if fewer than 1 assertion runs.

**Never hoist logic into `describe` body for side effects.** `describe` bodies run during collection. Mocks set up inside a `describe` body (not inside hooks) can affect other test files depending on Jest's execution order.

**Never use `jest.mock()` inside `beforeEach` or a test body.** It must be at the module's top level — Jest hoists it before imports. Calling it inside a hook is allowed for re-configuring mock behavior but the module replacement has already happened.

**Never forget `__esModule: true` in a factory for default exports.** If a module uses `export default`, the mock factory must include `{ __esModule: true, default: jest.fn() }` or the import will resolve to `undefined`.

**Always use `jest.mocked(fn)` instead of casting `fn as jest.Mock`.** `jest.mocked` is type-safe and doesn't discard the original type. Available since Jest 27; use it everywhere.

**Never mix sync `advanceTimersByTime` with Promises.** When timers and promises interact, always use `await jest.advanceTimersByTimeAsync(ms)`. The sync version cannot flush microtask queues between timer ticks, causing tests to hang.

**Never leave fake timers running across tests.** Call `jest.useRealTimers()` in `afterEach` (or set `fakeTimers: { enableGlobally: false }` and scope `useFakeTimers` per test). Leaked fake timers break unrelated tests that run after.

**Always scope `jest.spyOn` to `beforeEach` + `afterEach` (or rely on `restoreAllMocks: true`).** A spy that isn't restored persists its replacement across tests, producing hard-to-diagnose failures.

---

## Version Gotchas (Jest 29 → Jest 30)

Jest 30 was released June 2025. alfred may be on v29 or v30 — check `package.json`.

- **Removed aliases**: Several deprecated matcher aliases removed in v30. Global find-and-replace if you see "matcher not found" errors after upgrade: `toBeCalled` → `toHaveBeenCalled`, `toBeCalledWith` → `toHaveBeenCalledWith`, `toBeCalledTimes` → `toHaveBeenCalledTimes`, `toThrowError` → `toThrow`.
- **`jest.genMockFromModule` removed**: Use `jest.createMockFromModule` — identical behavior.
- **`jest.SpyInstance` type removed**: Use `jest.Spied<typeof fn>` for spy type annotations.
- **`jest-environment-jsdom` upgraded to jsdom 26**: `window.location` mocking behavior changed — assign `delete window.location` then reassign no longer works in jsdom 26; use `Object.defineProperty` instead.
- **Minimum TypeScript 5.4** for Jest 30. ts-jest versions must match.
- **glob v10**: Pattern matching for `testMatch` is stricter. If tests suddenly don't run after upgrade, double-check glob patterns.
- **`using` keyword for spies** (Jest 30 + TS 5.4+): `using spy = jest.spyOn(obj, 'method')` auto-restores when the block exits (explicit resource management). Optional but clean.
- **`restoreAllMocks` config key renamed to `restoreMocks` in Jest 30.** Writing `restoreAllMocks: true` in `jest.config.ts` causes a TypeScript error (`Object literal may only specify known properties`) under `@tsconfig/strictest`. Use `restoreMocks: true`. Same behavior — the name changed to match the `clearMocks` / `resetMocks` naming pattern.

> Source: Jest team, "Jest 30: Faster, Leaner, Better" (June 2025) and "From v29 to v30" migration guide, jestjs.io

---

## RTL Integration Point (frontend package only)

For tests under `frontend/`, `testEnvironment` is `jsdom` and React Testing Library is installed. RTL has its own skill — use it for `render`, `screen`, `userEvent`, `waitFor`, and async RTL queries. This skill covers the Jest layer (matchers, mocks, lifecycle) that sits beneath RTL, not RTL's component-level API.

The `jest-environment-jsdom` package must be installed separately from Jest 27+ (it was bundled before). `setupFilesAfterEnv` wires `@testing-library/jest-dom` matchers (`toBeInTheDocument`, `toHaveValue`, etc.).

---

## What Was Deliberately Left Out

- **`jest.mock` automatic mocking** (`jest.enableAutomock()`): The auto-mock feature generates mocks from the module shape automatically. Not used in alfred — manual factory mocks are more predictable. Including it would tempt agents to reach for it.
- **`jest.isolateModules`**: Useful for re-requiring modules with different env state per-test. Not a common alfred pattern; covering it would add complexity without payoff.
- **`jest.fn().mockImplementation` with complex stateful logic**: If a mock needs stateful multi-call behavior, prefer extracting a real implementation into a test helper. Complex mock implementations defeat the purpose of isolation.
- **Module `__mocks__` directory (manual mocks)**: Jest supports a `__mocks__/` sibling directory for automatic mock hoisting. alfred's convention prohibits top-level `__tests__/` dirs and does not use `__mocks__/` dirs — co-located manual mocks via `jest.mock` factory are preferred.
- **`jest.config.js` / `jest.config.cjs` format**: alfred is TypeScript-first; always use `jest.config.ts`.
- **Vitest**: Not used in alfred. If you see Vitest patterns, they do not apply here.
- **React Testing Library API** (render, screen, userEvent, waitFor): Covered in the RTL skill, not here.
- **Coverage configuration detail**: `collectCoverageFrom`, `coverageThreshold`, reporters are valid config keys but not a day-to-day authoring concern — not detailed here.
