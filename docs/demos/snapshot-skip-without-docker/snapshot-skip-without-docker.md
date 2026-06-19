---
branch: claude/storybook-tests-docker-w6tunb
---

# Storybook snapshots skip without a Docker daemon (Docker required only on macOS)

*2026-06-19T01:36:38.628Z*

check:slow renders Storybook image snapshots inside a pinned Playwright Docker image so pixels are identical everywhere. This sandbox has the docker client but no daemon, so the gate used to hard-fail here. The wrapper now branches: it skips with a notice on a daemon-less host (cloud/CI) and stays a hard requirement on macOS — letting CI be the authoritative snapshot gate. It never falls back to native rendering, which diverges from the committed baselines.

There is no reachable Docker daemon on this host:

```bash
docker info >/dev/null 2>&1 && echo "daemon reachable" || echo "no reachable docker daemon"
```

```output
no reachable docker daemon
```

On this Linux sandbox the snapshot wrapper now skips with a notice and exits 0 instead of failing the gate:

```bash
npm run test:storybook -w frontend
```

```output

> frontend@0.1.0 test:storybook
> node scripts/snapshot-docker.mjs

⊘ Skipping Storybook image snapshots: no reachable Docker daemon on this host.
  They render in a pinned Docker image for pixel-identical output, and native rendering
  diverges from the committed baselines (different font stack → text-width shift).
  CI runs this same wrapper with Docker on every PR and is the authoritative gate.
```

macOS keeps Docker as a hard requirement — the wrapper hard-fails there instead of skipping (it is the only supported local renderer):

```bash
grep "process.platform === 'darwin'" frontend/scripts/snapshot-docker.mjs
```

```output
  if (process.platform === 'darwin') {
```
