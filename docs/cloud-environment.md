# Claude Code on the web: custom environment for Chromium E2E

The E2E (`playwright test`) and Storybook test-runner suites need a real Chromium. On a
normal machine Playwright downloads its managed Chromium and everything just works. In
**Claude Code on the web**, the default **Trusted** network policy allowlists npm and the
Ubuntu apt mirrors but **not Playwright's browser CDN** (`cdn.playwright.dev`), so
`playwright install chromium` is blocked and `check:slow` can't get a browser.

Rather than bundle a serverless Chromium fallback, a **custom cloud environment** has been
created that allowlists the CDN and installs Chromium once at setup. With it selected, the
normal `playwright install chromium` path works in the cloud exactly as it does locally.

## How the environment is configured

The `alfred-e2e` environment was created from the **New cloud environment** dialog (cloud
icon → **Add environment**) with the settings below, recorded here so it can be recreated if
it ever expires:

- **Name:** `alfred-e2e`.
- **Network access: Custom**, with **"Also include default list of common package managers"**
  ticked, and these **Allowed domains**:
  ```
  cdn.playwright.dev
  *.playwright.dev
  ppa.launchpadcontent.net
  ```
  `cdn.playwright.dev` is Playwright's browser CDN. `ppa.launchpadcontent.net` is required
  because `playwright install --with-deps` runs `apt-get update` across *every* apt source in the
  base image — including the deadsnakes / ondrej-php PPAs served from that host, which are **not**
  in the default package-manager allowlist. A single 403 there aborts `apt-get update` (exit 100)
  and the setup script fails with `Failed to install browsers`. The default list covers the
  Ubuntu mirrors (`archive`/`security.ubuntu.com`) and Docker that Chromium's actual libraries
  come from.

  > **Simplest alternative:** set **Network access** to **Full** instead — then every apt repo is
  > reachable and you don't have to enumerate hosts.
- **Environment variables:** none. `frontend/playwright.config.ts` runs the Next test server
  against an in-memory mock Supabase backend (`scripts/mock-supabase.mjs`) with its own injected
  env, so no real credentials are needed. (Anything entered here is visible to whoever can edit
  the environment — no secrets.)
- **Setup script:** points at the committed script so the real logic stays in the repo:
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
scripts have, and every apt repo reachable — see the network note above). The result is
snapshotted by environment caching, so later sessions start with Chromium already on disk.

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
