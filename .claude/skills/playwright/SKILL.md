---
name: playwright
description: >
  Use when writing or modifying Playwright E2E tests in the alfred frontend/
  package. Covers: test/expect structure, locators (getByRole/getByLabel/
  getByText/getByTestId), web-first auto-retrying assertions, actions
  (click/fill/press), auto-waiting, fixtures and test.use, projects and
  playwright.config.ts (webServer for Next.js dev server), authentication state
  reuse (storageState / setup project), network mocking (page.route), traces
  and screenshots on failure, and parallelism/isolation. Apply before creating
  any *.spec.ts file or touching playwright.config.ts in frontend/.
---

# Playwright (alfred frontend)

Sources used:
- Playwright official docs — playwright.dev (locators, assertions, auth, network, fixtures, parallelism, webServer) — confirmed against GitHub raw docs, microsoft/playwright main branch, June 2026
- Next.js official example — vercel/next.js canary, `examples/with-playwright/playwright.config.ts`
- Next.js testing guide — nextjs.org/docs/pages/guides/testing/playwright, April 2025
- eslint-plugin-playwright README — github.com/mskelton/eslint-plugin-playwright (recommended rules)
- microsoft/playwright release notes — v1.40–v1.60, raw GitHub docs, June 2026

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

---

## Browser availability: Claude Code on the web (CDN-blocked sandboxes)

Playwright downloads its managed Chromium from `cdn.playwright.dev`. In some environments that
host is blocked — most notably the **default "Trusted" network policy in Claude Code on the
web**, whose allowlist covers npm + Ubuntu apt mirrors but NOT the Playwright browser CDN
(confirmed: `curl -I https://cdn.playwright.dev/` → HTTP 403 under Trusted, while the apt and npm
hosts return 200). There, `playwright install chromium` fails.

**Preferred fix — open the CDN, don't bundle a fallback.** Configure a custom cloud environment
that allowlists the CDN and installs the browser at setup:
- **Network access: Custom**, "include defaults" ticked, plus `cdn.playwright.dev` (and
  `*.playwright.dev`). Fall back to **Full** only if a download redirect host is still blocked.
- **Setup script** (runs as root, so `apt` works; cached across sessions):
  `npm exec -w frontend -- playwright install --with-deps chromium`.

See [`docs/cloud-environment.md`](../../../docs/cloud-environment.md). alfred uses exactly this:
`scripts/setup-chromium.mjs` then just runs the standard `playwright install chromium`, guarded
by an `existsSync(chromium.executablePath())` check so it skips the download when the browser is
already present.

**General container tip:** in memory-constrained containers, add `--disable-dev-shm-usage` to
`launchOptions.args` — `/dev/shm` is tiny there and Chromium otherwise dies mid-run with
`page.evaluate: Browser closed`.

**Last resort (truly air-gapped CI where the CDN is unreachable at all):**
`@sparticuz/chromium` bundles a serverless Chromium `.br` you `inflate()` to `/tmp`, point
Playwright at via `launchOptions.executablePath`, and back with hand-compiled NSS/NSPR stub
`.so` libraries on `LD_LIBRARY_PATH`. It's fragile (single-process crashes, missing shared libs,
SwiftShader args) — prefer the allowlist approach above. alfred carried this until the
custom-environment switch and no longer needs it.

**Process.env bracket notation:** TypeScript strict mode (`@tsconfig/strictest`) requires
`process.env['VAR']` not `process.env.VAR` when the property is not a known env var.
`env['BASE_URL']` is correct; `env.BASE_URL` gives TS4111 error.

---

## Storybook test-runner browser

The Storybook test-runner runs on Playwright's managed Chromium. With a real browser available
(see the section above), `test-runner-jest.config.cjs` just spreads `getJestConfig()` and sets a
timeout — no custom `launchOptions`:
```js
const { getJestConfig } = require('@storybook/test-runner');
const config = getJestConfig();
module.exports = { ...config, testTimeout: 30_000 };
```
Must be `.cjs`, not `.js` (see ESLint section); the runner discovers it via the
`test-runner-jest*` glob. Run sequence: `setup:chromium` → `storybook:build` → serve static
build → `test-storybook --ci`.

---

## playwright.config.ts Reference for alfred

```typescript
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env['BASE_URL'] ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,         // fail CI if test.only left in
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'html',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // 1. Auth setup runs first
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    // 2. Test project depends on setup
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],

  webServer: {
    command: 'npm run dev',              // starts Next.js dev server
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

**auth.setup.ts pattern for Supabase email/password login:**

```typescript
import { test as setup, expect } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '../playwright/.auth/user.json');

setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.E2E_USER_EMAIL!);
  await page.getByLabel('Password').fill(process.env.E2E_USER_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Wait for successful redirect — the Supabase auth gate redirects to /
  await page.waitForURL('/');
  await expect(page.getByRole('main')).toBeVisible();
  await page.context().storageState({ path: authFile });
});
```

Credentials come from env vars (`.env.local` for local dev, CI secrets for CI). Never hardcode them.

---

## What's Not in This Skill (and Why)

- **`page.$` / `page.$$` / ElementHandle API** — deprecated; the `no-element-handle` lint rule makes it an error. Excluded to prevent agents from defaulting to the old pattern.
- **Visual/screenshot regression (`toMatchSnapshot`)** — not in alfred's current test plan. Snapshot tests add maintenance overhead (update images on every UI change) that is out of scope for a single-user app.
- **Multi-browser projects (Firefox, WebKit)** — alfred runs against Chromium only. The config template shows one project. Add others when cross-browser coverage is needed.
- **`page.evaluate` / `page.exposeFunction`** — direct JS injection into the page. Occasionally necessary for localStorage manipulation in tests, but often a sign that the test is bypassing the app's real interface. Use only as a last resort.
- **Component testing (`@playwright/experimental-ct-react`)** — alfred uses Jest + React Testing Library for component tests. Playwright is the E2E layer only.
- **`page.waitForSelector` / `page.waitForFunction`** — still valid API but the recommended replacement is always a web-first assertion. Excluded to steer agents toward `expect(locator).toBeVisible()`.
- **Playwright MCP / Test Agents framework (v1.56+)** — the AI-driven planner/healer/generator agents. Interesting but out of scope for the alfred test suite as currently planned.
