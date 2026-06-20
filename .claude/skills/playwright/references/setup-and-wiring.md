# Playwright — setup & wiring (reference)

This holds the **one-time setup material and the gotchas hit wiring the suiteup** — 
the `playwright.config.ts` / `auth.setup.ts` reference, the Storybook test-runner browser config, and the integration-suite wiring gotchas. 
You rarely need any of this for everyday test authoring; reach for it when scaffolding the suite, editing config,
or debugging a setup-level failure. For browser/environment provisioning in Claude Code on the
web, see [`docs/cloud-environment.md`](../../../../docs/cloud-environment.md).

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

> Note: this is the generic single-`webServer` template. alfred's actual `playwright.config.ts`
> runs **two** web servers (the in-memory `scripts/mock-supabase.mjs` mock backend + `next build
> && next start`) with `workers: 1, fullyParallel: false` — see the "Mocking the backend" section
> of the skill and the live config file for the current shape.

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

## Storybook test-runner browser

The Storybook test-runner runs on Playwright's managed Chromium. With a real browser available,
`test-runner-jest.config.cjs` just spreads `getJestConfig()` and sets a timeout — no custom
`launchOptions`:
```js
const { getJestConfig } = require('@storybook/test-runner');
const config = getJestConfig();
module.exports = { ...config, testTimeout: 30_000 };
```
Must be `.cjs`, not `.js` (see ESLint section); the runner discovers it via the
`test-runner-jest*` glob. Run sequence: `setup:chromium` → `storybook:build` → serve static
build → `test-storybook --ci`.

---

## Gotchas hit wiring this up (all real, all cost discovery time)

- **`import.meta` breaks Playwright's config loader.** Playwright compiles `playwright.config.ts` (and its import chain) as **CJS**; any module it imports that uses `import.meta.dirname`/`import.meta.url` dies with `exports is not defined in ES module scope`. In a module imported by the config (e.g. `e2e/support/constants.ts`), resolve paths from `process.cwd()` (Playwright runs from the config dir) instead of `import.meta`.
- **`.ts` import extensions.** The frontend `tsconfig` does **not** set `allowImportingTsExtensions`, so `import … from './x.ts'` fails `tsc` (TS5097). Use **extensionless** relative imports in `e2e/**` — Playwright's loader resolves them. (Only `tools/showboat` allows the `.ts` extension.)
- **Sandbox Chromium + multiple spec files = "Browser closed".** `@sparticuz/chromium`'s args include `--single-process`; Playwright reuses one browser across spec **files**, and a single-process Chromium exits when its first page closes, crashing later files with `browserContext.newPage: Browser closed`. **Filter out `--single-process` and `--no-zygote`** from `chromiumPkg.args` (keep the rest); keep `--disable-dev-shm-usage`. (A single spec file is fine with single-process — multi-file reuse is what breaks, same root cause as the Storybook test-runner note above.) *(Historical: alfred no longer bundles `@sparticuz/chromium` — it uses Playwright's managed Chromium via the custom cloud environment.)*
- **Radix submenu items don't fire `onSelect` from a synthetic pointer click.** A nested `DropdownMenu.Sub` item (e.g. the "Move to…" → folder picker) clicked via `.hover()`+`.click()` races the "safe triangle" and silently closes without selecting — the click "succeeds" but nothing happens. **Drive it by keyboard:** hover the subtrigger, `ArrowRight` (opens submenu, focuses first item), `ArrowDown` to the target, `Enter`. Top-level menu items (e.g. "Delete") click fine — only nested submenu items need this. **Gate the `Enter` on a focus assertion** — `await expect(page.getByRole('menuitem', { name: 'Work' })).toBeFocused()` before pressing it. `ArrowDown` then `Enter` fired back-to-back races the focus move, so under a slightly heavier render it selects the *previous* item (e.g. "Inbox" instead of "Work"); the `toBeFocused()` wait makes it deterministic.
- **Any seed id the server validates must be a real UUID — including a mutated row's _own_ id.** Two validation seams reject a readable id like `'t1'` / `'f1'`: route zod schemas validate body foreign keys (`folder_id` / `parent_id`) as `z.uuid()`, and the dynamic `[id]` route handlers validate the **path param** with `parseUUID` (`items/[id]`, `folders/[id]`, `epics/[id]`, `tasks/[id]/complete`). So the requirement is broad: not just a **move** (`PATCH { folder_id }`) or **add-subtask** (`POST { parent_id }`), but **every** mutation that targets a row by its id — delete, complete/reactivate, classify, inline title/due-date/notes edits, folder rename/delete. A readable id renders fine (navigation/tree-building are client-side) but the mutation 400s → the optimistic store **rolls back** → the row reappears. The tell-tale symptom is a mutation that "looks like it worked then undid itself." Omit the seed `id` so `makeItem`/`makeFolder` mint a `crypto.randomUUID()`, and capture the object to reference its id (`parent.id`, `folder.id`) for a foreign key or URL. The same trap makes an optimistic assertion *pass by luck* (the row is visible/hidden for the instant before the rollback) — so a green test, especially a flaky one, can still be hiding a 400.
- **Optimistic mutation + full reload races the server write.** After a store mutation, `page.goto()` (a full reload) re-fetches from the mock and can read **stale** state because the optimistic UI updated before the server write landed. Prefer **client-side navigation** (click a sidebar link) — it reads the already-reconciled store and reflects the change without a reload. When a full reload is genuinely required (e.g. folder-delete re-parents items only on the server, not in the client store), `await page.waitForResponse(...)` for the mutation **before** reloading.
- **`getByText` is a case-insensitive substring match.** `getByText('Inbox')` also matches "Finished **inbox** task". Use `{ exact: true }` when the string is a substring of other visible text (e.g. a context label vs a task title).
