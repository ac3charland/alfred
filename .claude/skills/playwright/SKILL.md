---
name: playwright
description: >
  Covers Playwright E2E testing: test/expect
  structure, locators (getByRole/getByLabel/getByText/getByTestId), web-first
  auto-retrying assertions, actions (click/fill/press), auto-waiting, fixtures and
  test.use, projects and playwright.config.ts (webServer for the Next.js dev server),
  auth state reuse (storageState / setup project), network mocking (page.route),
  traces and screenshots on failure, and parallelism/isolation. Use before creating
  any *.spec.ts file or touching playwright.config.ts in frontend/. For a single
  component's interaction test in isolation, use a Storybook play function
  (storybook skill) instead.
---

# Playwright (alfred frontend)

Sources used:
- Playwright official docs — playwright.dev (locators, assertions, auth, network, fixtures, parallelism, webServer) — confirmed against GitHub raw docs, microsoft/playwright main branch, June 2026
- Next.js official example — vercel/next.js canary, `examples/with-playwright/playwright.config.ts`
- Next.js testing guide — nextjs.org/docs/pages/guides/testing/playwright, April 2025
- eslint-plugin-playwright README — github.com/mskelton/eslint-plugin-playwright (recommended rules)
- microsoft/playwright release notes — v1.40–v1.60, raw GitHub docs, June 2026

---

## Table of Contents

**This file**
- [Mental Model](#mental-model)
- [Choosing the Right Approach](#choosing-the-right-approach)
  - [Which locator to use?](#which-locator-to-use)
  - [Which assertion style to use?](#which-assertion-style-to-use)
  - [Fixtures vs. beforeEach hooks?](#fixtures-vs-beforeeach-hooks)
- [Plain-English → Pattern Table](#plain-english--pattern-table)
- [Fixtures and Lifecycle](#fixtures-and-lifecycle)
- [Common Pitfalls](#common-pitfalls)
- [Version Gotchas (as of v1.50–v1.60)](#version-gotchas-as-of-v150v160-current-as-of-june-2026)
- [Mocking the backend — the alfred integration suite](#mocking-the-backend--the-alfred-integration-suite-run-authenticated-seeded-tests)
- [Browser availability: Claude Code on the web](#browser-availability-claude-code-on-the-web-cdn-blocked-sandboxes)
- [What's Not in This Skill (and Why)](#whats-not-in-this-skill-and-why)

**References**
- [`references/setup-and-wiring.md`](references/setup-and-wiring.md) — `playwright.config.ts` / `auth.setup.ts` reference, Storybook test-runner browser config, and gotchas hit wiring the integration suite

---

## Mental Model

Playwright drives a real browser. The central insight is that **the DOM is always changing** — a click triggers a re-render, a form fill may show a spinner, async data arrives after paint. Playwright's entire API is designed around this reality through three layered mechanisms:

**1. Locators are lazy.** A `Locator` is not an element — it is a description of how to find an element. Every time you call an action (`click`, `fill`) or an assertion on a locator, Playwright re-queries the DOM from scratch. There is no "stale element" error. This is why the `ElementHandle` API (which *does* hold a reference to a specific DOM node) is deprecated — it breaks the instant React re-renders a component.

**2. Actions auto-wait for actionability.** Before executing `click`, `fill`, `check`, etc., Playwright runs actionability checks: is the element visible? stable (not mid-animation)? enabled? receiving events (not overlapped by another element)? It retries these checks on a polling loop until they pass or the action timeout expires (default 30 s). You do not add `await page.waitForSelector()` before actions — that is the old pattern and creates redundant waits.

**3. Web-first assertions auto-retry.** `expect(locator).toBeVisible()` is not a snapshot check — it polls the locator until the condition becomes true (default 5 s assertion timeout) or fails. This is fundamentally different from `expect(await locator.isVisible()).toBe(true)`, which evaluates once at call time and is racy. The eslint-plugin-playwright `prefer-web-first-assertions` rule enforces this automatically.

The implication for every test you write: **trust the auto-wait chain**. Write the action, then write the web-first assertion. No `waitForTimeout`, no manual polls, no `await locator.isVisible()` in if-branches.

---

## Choosing the Right Approach

### Which locator to use?

```
Does the element have a user-visible role (button, checkbox, heading, link)?
  → getByRole(role, { name: '...' })           ← always first choice

Is it a form field with a label?
  → getByLabel('Label text')

Is it a form field with only placeholder text?
  → getByPlaceholder('placeholder text')

Is it a non-interactive element you want to target by its text content?
  → getByText('text', { exact: true })

Is it an image?
  → getByAltText('alt text')

Is the element purely test-infrastructure with no user-facing label?
  → getByTestId('data-testid value')           ← last resort; not user-facing

Can nothing else uniquely identify it?
  → locator('css selector')                    ← avoid; fragile; never use long chains
```

Priority rationale: getByRole and getByLabel reflect what users and assistive technology see. Tests written against them survive refactors. Tests written against CSS selectors break on markup changes.

### Which assertion style to use?

```
Are you asserting something about a DOM element (visibility, text, attribute)?
  → expect(locator).toBeVisible() / toHaveText() / toHaveAttribute()   ← web-first, auto-retries

Are you asserting a non-DOM value (a string you computed, a count)?
  → expect(value).toBe() / toEqual()                                    ← synchronous, no retry

Are you asserting a URL or title?
  → expect(page).toHaveURL() / toHaveTitle()                            ← web-first on page object
```

Never mix: `expect(await locator.innerText()).toBe('...')` evaluates the innerText once and is racy. Use `expect(locator).toHaveText('...')` instead.

### Fixtures vs. beforeEach hooks?

```
Does the setup produce a reusable object (a page-object, an authed context)?
  → Custom fixture — encapsulates setup + teardown in one place, composable

Is it a one-liner side-effect only this describe block needs?
  → beforeEach — fine for narrowly scoped, non-reusable setup

Is it expensive (e.g. a DB seed that survives across tests in a worker)?
  → Worker-scoped fixture with scope: 'worker'
```

---

## Plain-English → Pattern Table

| When you want to... | Use this pattern | Key things to know |
|---|---|---|
| **Log in once and reuse the session for all tests** | Setup project + `storageState` | Create `tests/auth.setup.ts` that logs in and calls `page.context().storageState({ path: authFile })`. Add a `setup` project in config with `testMatch: /.*\.setup\.ts/`. Other projects declare `dependencies: ['setup']` and `use: { storageState: 'playwright/.auth/user.json' }`. Add `playwright/.auth/` to `.gitignore`. |
| **Fill the capture box and assert the item appears** | `getByLabel` or `getByRole` + `fill` + `press` + `toBeVisible` | `await page.getByLabel('Capture').fill('Buy milk')` then `await page.keyboard.press('Enter')` (or `getByRole('button', { name: 'Add' }).click()`), then `await expect(page.getByText('Buy milk')).toBeVisible()`. |
| **Click a button and confirm a modal appears** | `getByRole('button') + .click()` + `toBeVisible` on modal | `await page.getByRole('button', { name: 'Complete' }).click()` then `await expect(page.getByRole('dialog')).toBeVisible()`. The modal assertion auto-waits — no sleep needed. |
| **Confirm the cascade modal and check parent + subtasks complete** | Sequential actions + multiple web-first assertions | Click the modal's confirm button, then assert `toHaveAttribute('data-status', 'completed')` on the parent row locator AND each subtask locator. Chain them — Playwright retries each independently. |
| **Expand a task row to see subtasks** | Click row / toggle + `toBeVisible` on child locator | `await page.getByTestId('task-row-{id}').click()` then `await expect(page.getByTestId('subtask-list-{id}')).toBeVisible()`. If the row expands by toggling an aria-expanded button, prefer `getByRole('button', { name: 'Expand' })`. |
| **Move an item from Inbox to a folder** | Select/drag action + assert new location | Click the move control (`getByRole('button', { name: 'Move to folder' })`), select folder from dropdown (`getByRole('option', { name: 'Projects' })`), then assert item is no longer in Inbox (`expect(page.getByTestId('inbox-list').getByText('item title')).not.toBeVisible()`) and appears in the folder view. |
| **Wait for async content without a hard timeout** | Web-first assertion as the wait gate | `await expect(page.getByRole('list', { name: 'Tasks' })).toBeVisible()` serves as the wait — it retries for up to 5 s by default. Never use `page.waitForTimeout(2000)`. |
| **Mock an API response** | `page.route(pattern, handler)` | Call before navigation: `await page.route('**/rest/v1/items*', route => route.fulfill({ status: 200, json: mockData }))`. Place in `test.beforeEach` or a fixture so it's set before the page loads. Use `route.fulfill` for mocked data, `route.abort()` to simulate network error. |
| **Assert a POST was made with specific body** | `page.waitForRequest` + request inspection | `const reqPromise = page.waitForRequest(req => req.url().includes('/items') && req.method() === 'POST'); await page.getByRole('button', { name: 'Save' }).click(); const req = await reqPromise; expect(JSON.parse(req.postData())).toMatchObject({ title: 'Buy milk' });` |
| **Run against the Next.js dev server** | `webServer` config in `playwright.config.ts` | `webServer: { command: 'npm run dev', url: 'http://localhost:3000', reuseExistingServer: !process.env.CI, timeout: 120_000 }`. Set `use: { baseURL: 'http://localhost:3000' }` so `page.goto('/')` works. |
| **Capture traces/screenshots on failure only** | `use: { trace: 'on-first-retry', screenshot: 'only-on-failure' }` | This records traces only when a test is retried (i.e., it failed at least once) — no overhead on passing runs. Use `'retain-on-failure'` if you need traces from the final failure too. View with `npx playwright show-trace`. |
| **Group related assertions into a named step** | `test.step('description', async () => { ... })` | Steps appear as named nodes in traces and HTML reports. Wrap multi-action flows: `await test.step('submit capture form', async () => { await page.getByLabel('Capture').fill('Buy milk'); await page.keyboard.press('Enter'); })`. Failures name the step in the output. |
| **Share a logged-in page across tests in a file** | Worker-scoped fixture with `storageState` | Define a fixture `authedPage` that extends the `page` fixture: `const { page } = await browser.newContext({ storageState })`. Use `scope: 'worker'` to create one context per worker, not per test. |
| **Run only the Chromium project locally** | `--project=chromium` CLI flag | `npx playwright test --project=chromium`. The alfred config uses a single project (Desktop Chrome) in CI. Add projects in `playwright.config.ts` to target more browsers. |

---

## Fixtures and Lifecycle

Playwright's built-in test fixtures are the primary mechanism for shared setup. Understand them before writing `beforeEach` hooks — fixtures compose; hooks don't.

**Built-in fixtures (per-test scope by default):**
- `page` — isolated Page in its own BrowserContext. Each test gets a fresh context with no cookies/storage from other tests.
- `context` — the BrowserContext behind `page`. Use this to set extra permissions, override storageState, or add init scripts.
- `browser` — shared across tests in a worker (not reset per-test). Use for worker-scoped setup only.
- `request` — an `APIRequestContext` for direct HTTP calls, independent of the browser.

**Custom fixture pattern:**

```typescript
// fixtures.ts
import { test as base } from '@playwright/test';

type AppFixtures = {
  todoPage: TodoPage;  // your page-object
};

export const test = base.extend<AppFixtures>({
  todoPage: async ({ page }, use) => {
    const todo = new TodoPage(page);
    await todo.goto();
    await use(todo);           // ← test runs here
    await todo.cleanup();      // ← teardown always runs, even on test failure
  },
});

export { expect } from '@playwright/test';
```

Import `test` and `expect` from `fixtures.ts` instead of `@playwright/test` in your spec files.

**`test.use()` for scoped overrides:**

```typescript
test.use({ storageState: 'playwright/.auth/admin.json' });

test('admin can delete items', async ({ page }) => { ... });
```

`test.use()` applies to the enclosing describe block or file. Reset with `test.use({ storageState: undefined })`.

**Auto-use fixtures** for cross-cutting concerns (e.g., log collection on failure):

```typescript
saveLogs: [async ({}, use, testInfo) => {
  const logs: string[] = [];
  // ... collect logs
  await use();
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('logs', { body: logs.join('\n'), contentType: 'text/plain' });
  }
}, { auto: true }],
```

**Auto-waiting lifecycle per action:**
1. Playwright resolves the locator against the current DOM.
2. Runs actionability checks (visible, stable, enabled, receives-events) in a polling loop.
3. Scrolls the element into view if needed.
4. Performs the action.
5. Waits for any triggered navigation or network activity to settle (for navigation-triggering actions).

If the element does not become actionable within the action timeout (default 30 s), the test fails with a descriptive timeout message showing which check failed.

**beforeEach / afterEach** are valid for side effects that don't need composition. For the alfred app:

```typescript
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible(); // wait for app shell
});
```

---

## Common Pitfalls

**Never use `page.waitForTimeout(ms)`** — it is a hard sleep. It causes flakiness in CI (environment slower than local) and hides root causes. The rule `no-wait-for-timeout` in eslint-plugin-playwright enforces this as an error. Use web-first assertions as the wait gate instead.

**Never use `ElementHandle` (`page.$`, `page.$$`, `evaluateHandle` returning handles).** These hold references to specific DOM nodes. React re-renders invalidate them silently. The `no-element-handle` rule enforces this. Always use Locators.

**Never use `expect(await locator.isVisible()).toBe(true)`.** This evaluates once, synchronously, at that instant. It will fail if the element is still loading. Use `expect(locator).toBeVisible()` — the web-first version that retries.

**Wrap a non-locator read (`page.evaluate(...)`) in `expect.poll`, never a one-shot `await`.** `expect.poll(() => getOpenedUrls(page)).toHaveLength(1)` retries the evaluate; `expect(await getOpenedUrls(page))…` reads once and is racy. This bites when an action's side effect lands *after* an awaited write but the UI moved *optimistically* before it — e.g. `openClaudeSession` does `await transitionState(...); window.open(...)`, so the card reaches its new swimlane (passing your `toBeVisible`) while `window.open` hasn't fired yet. A one-shot read of the captured URLs then sees `[]`, only under load (full suite, slower machine) — green in isolation and on CI, red locally. Poll it.

**Never use `expect` inside an `if` block.** The `no-conditional-expect` rule flags this. If you need to branch on DOM state, use `locator.count()` in a setup step, not inside an assertion branch.

**Always `await` every Playwright action and assertion.** Missing `await` on `page.click()` or `expect(locator).toBeVisible()` runs them fire-and-forget. The TypeScript compiler won't catch this; eslint-plugin-playwright's `await-thenable` rule does.

**Always set `baseURL` in config and use relative paths in `page.goto()`.** `page.goto('/')` is cleaner and survives URL changes. Never hardcode `http://localhost:3000` in individual tests.

**Always place `page.route()` calls before `page.goto()`.** Route handlers registered after navigation won't intercept already-started requests. Set up mocks at the top of the test or in `beforeEach`.

**Never rely on test execution order.** Each test must be fully independent. Playwright randomizes file order by default. Use `storageState` for auth reuse, not a global auth cookie you set in test #1 and depend on in test #2.

**Never use `first()`, `last()`, or `nth()` unless the element genuinely has no better discriminator.** These are position-dependent and break when the list order changes. Prefer filtering: `page.getByRole('listitem').filter({ hasText: 'Buy milk' })`.

**The `setup` project must appear before test projects in the `projects` array and must be listed in `dependencies`.** If `dependencies` is omitted, Playwright runs the setup project but test projects will not wait for it — they start immediately.

**Never commit `playwright/.auth/*.json` files.** They contain session cookies. Add `playwright/.auth/` to `.gitignore`.

The Supabase client constructor *throws at startup* when `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are absent ("Your project's URL and Key are required to create a Supabase client!") — so a fresh sandbox with no env would otherwise fail the pre-push hook (`check:slow`) even though no test code is wrong. **This is already handled:** `playwright.config.ts` computes `webServerFallbackEnvironment` and passes it as `webServer.env` — when no real Supabase env is present (no `.env.local`, no `process.env` var) it injects *non-functional placeholders* (`https://placeholder.supabase.co`, `sb_publishable_placeholder`, …) so the server boots; the unreachable host makes `getUser()` return null → middleware redirects to `/login`, exactly what `e2e/home.spec.ts` asserts. Real credentials always win (Next.js never overrides an already-set `process.env` var, and the fallback only fires when none is set), so it can't leak into dev or production. If you add a new env var the server reads *at startup*, add a placeholder to that object too. This is environment setup, not a guardrail bypass — the hook still runs in full.

---

## Version Gotchas (as of v1.50–v1.60, current as of June 2026)

**`Page.type()` was deprecated in v1.38** — agents trained before 2023 will suggest it. Use `locator.fill()` for setting a field's value at once, or `locator.pressSequentially()` if you need to simulate character-by-character typing (rare; only needed for autocomplete inputs that react per keystroke).

**`page.accessibility` was removed in v1.57** — it was deprecated for years. For accessibility assertions use `expect(locator).toMatchAriaSnapshot()` (added v1.50) which compares the aria tree, or integrate Axe externally.

**`ElementHandle` is not removed but is deprecated** — the docs say "use Locator objects and web-first assertions instead." Agents trained before v1.14 (2021) know only the handle-based API. Any pattern with `await page.$('#selector')`, `await handle.click()`, or `expect(await handle.textContent())` is the old way.

**`page.waitForSelector` is still in the API but discouraged** — the recommended replacement is a web-first assertion (`expect(locator).toBeVisible()`) which both waits and asserts in one call.

**Locators replaced `$`/`$$` as the primary element access API in v1.14 (2021)** — but agents frequently still suggest `page.$('selector')`. The `no-element-handle` lint rule catches this.

**`_react` and `_vue` selector engines were removed in v1.58** — if you find any selector like `_react=ComponentName`, replace it with a `getByTestId` or `getByRole` locator.

**`webServer.port` is deprecated** — use `webServer.url` (the full URL) instead. The Next.js example already uses `url`.

**`context.videosPath` / `videoSize` were removed in v1.60** — use `recordVideo: { dir: '...', size: {...} }` in context/use options instead.

**`reducedMotion` is not a top-level `test.use()` / `use` option here** — it's a *context* option. `test.use({ reducedMotion: 'reduce' })` fails typecheck (`'reducedMotion' does not exist in type 'Fixtures<…>'`); set `test.use({ contextOptions: { reducedMotion: 'reduce' } })` instead. It still "works" at runtime if passed at the top level (silently ignored), so the only signal is the type error — easy to miss until the type-check gate catches it.

**`getByRole(role, { name })` matches the name as a case-insensitive _substring_ by default** — so `getByRole('list', { name: 'Tasks' })` also matches a `Subtasks` list, throwing a strict-mode "resolved to 2 elements" once a subtask list is on screen. Pass `{ name: 'Tasks', exact: true }` when one accessible name is a substring of another.

---

## Mocking the backend — the alfred integration suite (run authenticated, seeded tests)

The suite never touches real Supabase. Every Supabase access in alfred is **server-side** (middleware `getUser()`, `lib/data/*` readers in Server Components, the `app/api/**` route handlers) — so **`page.route()` cannot mock it**: Playwright only intercepts *browser* network, but the reads and auth validation happen inside the Next process and arrive as already-rendered HTML. The seam therefore sits at the Supabase **HTTP boundary inside the server**, not in the browser.

**The approach (zero production-code branches):** an in-memory mock of the Supabase HTTP API (`frontend/scripts/mock-supabase.mjs`) implements just the subset alfred uses — GoTrue `POST /auth/v1/token`, `GET /auth/v1/user`, `POST /auth/v1/logout`; PostgREST `GET|POST|PATCH|DELETE /rest/v1/{folders,items}` + `POST /rest/v1/rpc/complete_subtree`; and test-control routes `POST /__mock__/{reset,seed}`. `playwright.config.ts` runs it as a **second `webServer`** and points the Next server's env (`NEXT_PUBLIC_SUPABASE_URL`, anon/service keys, `INGEST_API_KEY`) at it — unconditionally, so a developer's real `.env.local` is never used in tests. The real `@supabase/ssr` client, cookie handling, PostgREST query strings and route handlers all still execute; only the DB+auth backend is faked. These are genuine **integration** tests.

- **Seed per test, not per build.** `e2e/support/fixtures.ts` adds a `seed` fixture that POSTs to `/__mock__/reset` (clean slate) then `/__mock__/seed` before `page.goto()`. The mock is in-memory and the config runs `workers: 1, fullyParallel: false`, so a shared store with per-test reset is deterministic. Build seed rows with `makeItem` / `makeFolder` from `e2e/support/constants.ts`.
- **Auth via the real login + `storageState`.** `e2e/auth.setup.ts` drives the actual login form against the mock and saves the session; the `chromium` project reuses it via `storageState`. **Don't hand-craft the auth cookie** — `@supabase/ssr` derives its name (`sb-<ref>-auth-token`, ref = first URL host label, e.g. `sb-localhost-auth-token`) from `NEXT_PUBLIC_SUPABASE_URL`, and because the browser and the server use the *same* URL the names match and the cookie round-trips. Logging in for real sidesteps the whole derivation. Specs that need the logged-OUT state opt out with `test.use({ storageState: { cookies: [], origins: [] } })` (see `home.spec.ts`).
- **The mock mints a long-lived session** (far-future `expires_at`) so it never expires mid-run and `getUser()` never tries to refresh.

> **Setting up the suite, editing config, or debugging a setup-level failure?** The full
> `playwright.config.ts` / `auth.setup.ts` reference, the Storybook test-runner browser config,
> and the gotchas hit wiring this suite up (CJS / `import.meta`, `.ts` import extensions, UUID
> seed ids, Radix submenu keyboard nav, optimistic-reload races, `getByText` substring matching,
> …) live in [`references/setup-and-wiring.md`](references/setup-and-wiring.md) — pulled out of
> this skill because they're one-time setup, rarely needed for everyday test authoring.

---


## Browser availability: Claude Code on the web (CDN-blocked sandboxes)

Playwright downloads its managed Chromium from `cdn.playwright.dev`. In some environments that
host is blocked — most notably the **default "Trusted" network policy in Claude Code on the
web**, whose allowlist covers npm + Ubuntu apt mirrors but NOT the Playwright browser CDN
(confirmed: `curl -I https://cdn.playwright.dev/` → HTTP 403 under Trusted, while the apt and npm
hosts return 200). There, `playwright install chromium` fails.

We have a custom `alfred` cloud environment in Claude Code on the web that addresses this issue by installing Chromium as part of its setup script. If you are running in Claude Code on the web and do not see chromium, ask the user if they're on the Default environment.

See [`docs/cloud-environment.md`](../../../docs/cloud-environment.md) for additional details on the setup if you need to troubleshoot beyond simply switching environments.

**When the host IS reachable but the download still fails — or the pre-baked browser is a
revision behind the lockfile's Playwright** (base image ships e.g. `chromium-1194` but the pinned
Playwright wants `1223`, so `setup:chromium` re-triggers a download that then fails) — provision it
by hand with `curl`. Through the agent proxy, Playwright's own downloader mishandles the
`cdn.playwright.dev` → `storage.googleapis.com` **307 redirect** and stalls at ~90% ("server closed
connection") on every retry, but `curl -L` (which follows redirects) fetches the same zip in
seconds. Get the exact install dirs + zip URLs from `npx playwright install --dry-run chromium`,
then for **both** the full `chromium-<rev>` and `chromium_headless_shell-<rev>`:
`curl -L --cacert "$NODE_EXTRA_CA_CERTS" -o b.zip <url>` → `unzip b.zip -d <install-dir>` (the zip's
top folder — `chrome-linux64/` / `chrome-headless-shell-linux64/` — already matches
`executablePath()`, no rename) → `touch <install-dir>/INSTALLATION_COMPLETE` so Playwright treats it
as installed and skips the re-download.

**General container tip:** in memory-constrained containers, add `--disable-dev-shm-usage` to
`launchOptions.args` — `/dev/shm` is tiny there and Chromium otherwise dies mid-run with
`page.evaluate: Browser closed`.

**Process.env bracket notation:** TypeScript strict mode (`@tsconfig/strictest`) requires
`process.env['VAR']` not `process.env.VAR` when the property is not a known env var.
`env['BASE_URL']` is correct; `env.BASE_URL` gives TS4111 error.

---

## What's Not in This Skill (and Why)

- **`page.$` / `page.$$` / ElementHandle API** — deprecated; the `no-element-handle` lint rule makes it an error. Excluded to prevent agents from defaulting to the old pattern.
- **Visual/screenshot regression (`toMatchSnapshot`)** — not in alfred's current test plan. Snapshot tests add maintenance overhead (update images on every UI change) that is out of scope for a single-user app.
- **Multi-browser projects (Firefox, WebKit)** — alfred runs against Chromium only. The config template shows one project. Add others when cross-browser coverage is needed.
- **`page.evaluate` / `page.exposeFunction`** — direct JS injection into the page. Occasionally necessary for localStorage manipulation in tests, but often a sign that the test is bypassing the app's real interface. Use only as a last resort. The one sanctioned, scoped use is **frame-by-frame runtime debugging** — sampling a computed value every animation frame to catch a transient glitch (flash/jank). That's wrapped in a helper and documented in the **`debug-animations`** skill; reach for that rather than hand-rolling `page.evaluate`.
- **Component testing (`@playwright/experimental-ct-react`)** — alfred uses Jest + React Testing Library for component tests. Playwright is the E2E layer only.
- **`page.waitForSelector` / `page.waitForFunction`** — still valid API but the recommended replacement is always a web-first assertion. Excluded to steer agents toward `expect(locator).toBeVisible()`.
- **Playwright MCP / Test Agents framework (v1.56+)** — the AI-driven planner/healer/generator agents. Interesting but out of scope for the alfred test suite as currently planned.
