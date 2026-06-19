---
branch: claude/storybook-tests-docker-w6tunb
---

# Storybook snapshots self-heal Docker (auto-start daemon + bind-mount node_modules)

*2026-06-19T15:20:04.638Z*

This cloud sandbox ships the docker client but no running daemon, and the playwright image's npm 11 crashes on `npm ci` ("Exit handler never called"). The `test:storybook` wrapper now handles both: on Linux it starts `dockerd` itself when none is reachable, and it bind-mounts the host's node_modules straight into the container (same platform + arch) instead of reinstalling them — so no `npm ci` runs at all. macOS is unchanged: no `dockerd` to launch (hard-fail, start Docker Desktop) and host darwin binaries still need the named-volume + `npm ci` path.

When no daemon is reachable, the wrapper starts one on Linux and hard-fails on macOS:

```bash
grep -nE 'starting dockerd|process.platform === .darwin.|Start Docker Desktop' frontend/scripts/snapshot-docker.mjs
```

```output
171:  console.log('▶ no Docker daemon reachable — starting dockerd…');
184:  if (process.platform === 'darwin') {
188:    console.error('  Start Docker Desktop and retry.');
```

On a Linux host the outer node_modules are bind-mounted and used as-is — the npm ci step is gated out (it only runs on macOS, where host binaries are darwin):

```bash
grep -nE 'linuxHost|npm ci' frontend/scripts/snapshot-docker.mjs
```

```output
16: * node_modules are already the right platform+arch, so they're used as-is (no `npm ci`); on
17: * macOS each workspace's node_modules is shadowed by a named cache volume that `npm ci` fills
76:// `npm ci`. That's faster and sidesteps an "Exit handler never called" crash in the
78:// load, so each workspace's node_modules is shadowed by a named volume that `npm ci`
80:const linuxHost = process.platform === 'linux';
93:const volumeArgs = linuxHost
103:// `npm ci` into the shadow volumes first, guarded by a marker so repeat runs reuse them;
108:  ...(linuxHost
111:        '[ -z "$REINSTALL" ] && [ -e node_modules/.snapshot-deps ] || { npm ci && touch node_modules/.snapshot-deps; }',
```

End-to-end proof from a real cold run in this Docker-less sandbox — `npm run test:storybook` with the daemon stopped first. The wrapper logged `▶ no Docker daemon reachable — starting dockerd…` then `dockerd ready after 1s`, rendered in `mcr.microsoft.com/playwright:v1.60.0-noble (host/amd64)`, and reported **Snapshots: 34 passed, 34 total** (Tests: 68 passed, 68 total; Test Suites: 15 passed) at exit 0 — daemon auto-started, host node_modules bind-mounted, no `npm ci`, no npm crash.
