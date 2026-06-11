# Claude Code on the web: custom environment for Chromium E2E

The E2E (`playwright test`) and Storybook test-runner suites need a real Chromium. On a
normal machine Playwright downloads its managed Chromium and everything just works. In
**Claude Code on the web**, the default **Trusted** network policy allowlists npm and the
Ubuntu apt mirrors but **not Playwright's browser CDN** (`cdn.playwright.dev`), so
`playwright install chromium` is blocked and `check:slow` can't get a browser.

Rather than bundle a serverless Chromium fallback, configure a **custom environment** that
allowlists the CDN and installs Chromium once at setup. Then the normal
`playwright install chromium` path works in the cloud exactly as it does locally.

## Create the environment

In the **New cloud environment** dialog (cloud icon → **Add environment**):

- **Name:** e.g. `alfred-e2e`.
- **Network access:** select **Custom**.
  - Tick **"Also include default list of common package managers"** (keeps npm + the
    Ubuntu apt mirrors that `--with-deps` needs).
  - In **Allowed domains**, add Playwright's browser CDN:
    ```
    cdn.playwright.dev
    *.playwright.dev
    ```
  - If a browser download still fails on a redirect to another host, switch to **Full**.
- **Environment variables:** none required. `frontend/playwright.config.ts` injects
  placeholder Supabase vars when `.env.local` is absent, so the production `webServer`
  (`next build && next start`) boots and `e2e/home.spec.ts` asserts the `/login` redirect.
  (Anything entered here is visible to whoever can edit the environment — no secrets.)
- **Setup script:** point it at the committed script so the real logic stays in the repo:
  ```bash
  #!/bin/bash
  bash scripts/cloud-setup.sh
  ```

## What the setup script does

[`scripts/cloud-setup.sh`](../scripts/cloud-setup.sh) runs as root in the environment's
(cached) setup step:

```bash
npm ci
npm exec -w frontend -- playwright install --with-deps chromium
```

`--with-deps` uses apt to install Chromium's system libraries (needs root, which setup
scripts have). The result is snapshotted by environment caching, so later sessions start
with Chromium already on disk.

## How the test scripts use it

`frontend` exposes `setup:chromium` → [`scripts/setup-chromium.mjs`](../frontend/scripts/setup-chromium.mjs),
which checks whether Playwright's Chromium binary already exists and **skips the install
when it does**, only running `playwright install chromium` otherwise. `test:e2e` and
`test:storybook` invoke it first, so they self-heal the browser binary in any session
(the setup script is what provides the OS libraries up front).

## Verify

In a session on this environment:

```bash
npm exec -w frontend -- playwright install --with-deps chromium   # downloads cleanly, no 403
npm run check:slow -w frontend                                    # Storybook + Playwright e2e green
```
