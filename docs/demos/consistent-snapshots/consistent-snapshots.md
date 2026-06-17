---
branch: claude/snapshot-gate-full-scope
---

# Storybook snapshots render consistently in a pinned Docker image

*2026-06-17T20:44:59.800Z*

Image snapshots used to render with whatever Chromium + fonts the host had, so macOS produced a different text width than the Linux baselines — a hard image-size mismatch that made the pre-push snapshot gate unpassable on macOS. They now always render inside one pinned Playwright Docker image (at the host arch, so it's native everywhere — never emulated). `npm run test:storybook` shells out to that image via `frontend/scripts/snapshot-docker.mjs`; Docker is the only new local dependency.

The wrapper derives the image tag from the *resolved* Playwright version, so the renderer can never drift from the Chromium our tests actually launch:

```bash
node -e "console.log('mcr.microsoft.com/playwright:v'+require('playwright/package.json').version+'-noble')"
```

```output
mcr.microsoft.com/playwright:v1.60.0-noble
```

CI runs the **same, full-scope** root check command (`npm run check:slow`, which fans out to every workspace — not narrowed to one), on an arm64 runner so its native render matches the committed arm64 baselines:

```bash
grep -E 'runs-on: ubuntu-24.04-arm|run: npm run check:slow' .github/workflows/ci.yml
```

```output
    runs-on: ubuntu-24.04-arm
        run: npm run check:slow
```

Inside the wrapper: the platform defaults to the host arch (so it's native — no QEMU, which segfaults Chromium), the image tag is derived from the Playwright version, and each arch gets its own node_modules cache volume (native bindings are arch-specific):

```bash
grep -E "SNAPSHOT_PLATFORM|playwright/package.json|alfred-snap-nm-" frontend/scripts/snapshot-docker.mjs
```

```output
const platform = platformArg ?? process.env.SNAPSHOT_PLATFORM ?? '';
const playwrightVersion = require('playwright/package.json').version;
  const volName = `alfred-snap-nm-${archKey}-${rel.replaceAll('/', '-')}`;
```

Verified on this macOS machine: `npm run test:storybook` rendered all 34 snapshots through the wrapper and matched the committed baselines — the gate that was previously unpassable on macOS.
