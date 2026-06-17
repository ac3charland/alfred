# Storybook snapshots render consistently in a pinned Docker image

*2026-06-17T19:23:15.185Z*

Image snapshots used to render with whatever Chromium + fonts the host had, so macOS produced a different text width than the Linux baselines — a hard image-size mismatch that made the pre-push snapshot gate unpassable on macOS. They now always render inside one pinned Playwright Docker image, pinned to a single arch, so the renderer is identical on every machine and in CI. `npm run test:storybook` shells out to that image via `frontend/scripts/snapshot-docker.mjs`; Docker is the only new local dependency.

The wrapper derives the image tag from the *resolved* Playwright version, so the renderer can never drift from the Chromium our tests actually launch:

```bash
node -e "console.log('mcr.microsoft.com/playwright:v'+require('playwright/package.json').version+'-noble')"
```

```output
mcr.microsoft.com/playwright:v1.60.0-noble
```

CI renders in that exact image on a matching arm64 runner — same image, same arch as the local wrapper, so there is one rendering environment everywhere:

```bash
grep -E 'runs-on: ubuntu-24.04-arm|image: mcr.microsoft.com/playwright' .github/workflows/ci.yml
```

```output
    runs-on: ubuntu-24.04-arm
      image: mcr.microsoft.com/playwright:v1.60.0-noble
```

Inside the wrapper, three lines fix the rendering environment: the arch is pinned to linux/arm64 (native on Apple Silicon and the CI runner — no QEMU, which segfaults Chromium), the image tag is derived from the Playwright version, and each arch gets its own node_modules cache volume (native bindings are arch-specific):

```bash
grep -E "const (platform|playwrightVersion|image|volName) =" frontend/scripts/snapshot-docker.mjs
```

```output
const platform = platformArg ?? process.env.SNAPSHOT_PLATFORM ?? 'linux/arm64';
const playwrightVersion = require('playwright/package.json').version;
const image = `mcr.microsoft.com/playwright:v${playwrightVersion}-noble`;
  const volName = `alfred-snap-nm-${archKey}-${rel.replaceAll('/', '-')}`;
```

Verified on this macOS machine: `npm run test:storybook` rendered all 34 snapshots through the wrapper and matched the committed Linux-generated baselines — the gate that was previously unpassable on macOS. The 19 changed baseline PNGs moved because the renderer changed (pinned image vs the old cloud Chromium), not because any component did.
