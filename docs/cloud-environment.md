# Claude Code on the web: custom environment for Chromium E2E

The E2E suite (`playwright test`) needs a real Chromium. On a normal machine Playwright
downloads its managed Chromium and everything just works. In **Claude Code on the web**, the
default **Trusted** network policy allowlists npm and the Ubuntu apt mirrors but **not
Playwright's browser CDN** (`cdn.playwright.dev`), so `playwright install chromium` is blocked
and the E2E half of `check:slow` can't get a browser.

> **Storybook image snapshots don't use this path.** They render inside a pinned Docker image
> (`mcr.microsoft.com/playwright:v<version>-noble`) so the pixels are identical on every OS —
> see the `storybook` skill §7. `npm run test:storybook` shells out to Docker (locally and in
> CI's `npm run check:slow`); CI's slow job runs on an `ubuntu-24.04-arm` runner so its native
> render matches the arm64 baselines. That needs Docker + registry access, not the Playwright
> CDN — so where Docker isn't available, CI is the authoritative snapshot gate.

Rather than bundle a serverless Chromium fallback, a **custom cloud environment** has been
created that allowlists the CDN and installs Chromium once at setup. With it selected, the
normal `playwright install chromium` path works in the cloud exactly as it does locally.

## How the environment is configured

The `alfred` environment was created from the **New cloud environment** dialog (cloud
icon → **Add environment**) with the settings below, recorded here so it can be recreated if
it ever expires:

- **Name:** `alfred`.
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
when it does**, only running `playwright install chromium` otherwise. `test:e2e` invokes it
first, so it self-heals the browser binary in any session (the setup script is what provides
the OS libraries up front). The snapshot runner (`test:storybook:linux`) invokes it too, but
inside the Docker image `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` points at the pre-bundled
browsers, so it's a no-op there.

## Verify

In a session on this environment:

```bash
npm exec -w frontend -- playwright install --with-deps chromium   # downloads cleanly, no 403
npm run check:slow -w frontend                                    # Storybook + Playwright e2e green
```
