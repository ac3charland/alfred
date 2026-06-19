/**
 * Run the Storybook image-snapshot suite inside the pinned Playwright container so the
 * rendered pixels are identical on every host (macOS, Linux CI, the cloud sandbox).
 *
 * WHY THIS EXISTS
 * ---------------
 * Image snapshots capture Chromium's rasterised output. Text width and antialiasing depend
 * on the OS font stack + rasteriser, so macOS (CoreText) renders text at a *different width*
 * than Linux (FreeType) — a hard image-SIZE mismatch the percent-threshold can't absorb.
 * The only way to make the baselines portable is to always render them in the same place: a
 * pinned Linux container. `mcr.microsoft.com/playwright:v<version>-noble` bundles exactly the
 * Chromium our Playwright launches plus the Noble font packages, so the renderer is frozen.
 *
 * This wrapper bind-mounts the repo and runs the real `test:storybook:linux[:update]` script
 * inside the image. node_modules strategy depends on the host: on Linux the bind-mounted
 * node_modules are already the right platform+arch, so they're used as-is (no `npm ci`); on
 * macOS each workspace's node_modules is shadowed by a named cache volume that `npm ci` fills
 * with Linux binaries, so the container never clobbers the host's darwin ones. Baselines under
 * `frontend/__image_snapshots__/` are written back to the host through the bind mount.
 *
 * USAGE
 *   node scripts/snapshot-docker.mjs                      # verify against committed baselines
 *   node scripts/snapshot-docker.mjs --update             # (re)generate baselines
 *   node scripts/snapshot-docker.mjs --platform=linux/amd64  # force an arch (default: host arch)
 *
 * The image runs at the HOST arch so it's always native (arm64 on Apple Silicon, amd64 on the
 * Linux CI runner) — emulating the other arch under QEMU segfaults Chromium. The pinned image
 * fixes the fonts + Chromium so text width is identical across arches; only sub-pixel AA can
 * differ, which the snapshot threshold absorbs. CI just runs `npm run check:slow`, which calls
 * this wrapper the same way (see .github/workflows/ci.yml).
 *
 * NO DOCKER DAEMON? On Linux (a headless cloud sandbox / CI runner) the wrapper STARTS one
 * itself — `dockerd` is a real daemon we can launch as root — then runs the gate, the way
 * setup:chromium self-heals the browser binary. On macOS there's no `dockerd` to launch
 * (Docker Desktop owns the VM), so it hard-fails and asks the dev to start Docker Desktop —
 * Docker stays required on macOS. It never falls back to native rendering, which diverges
 * from the baselines by whole pixels. Pre-pulling the image in the cloud setup script keeps
 * the first auto-started run fast (see docs/cloud-environment.md).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(frontendDir, '..');

// --- args -------------------------------------------------------------------
const argv = process.argv.slice(2);
const update = argv.includes('--update');
const platformArg = argv.find((a) => a.startsWith('--platform='))?.split('=', 2)[1];
// Default to the host arch so the container runs natively everywhere (never emulated). Override
// with --platform only for experiments.
const platform = platformArg ?? process.env.SNAPSHOT_PLATFORM ?? '';
// node_modules holds platform-specific native bindings (@oxc-parser, lightningcss, …), so each
// arch needs its OWN cache volume — a shared one feeds the wrong arch's binaries to the
// container and crashes the Storybook build mid-render.
const archKey = platform
  ? platform.split('/').pop()
  : process.arch === 'x64'
    ? 'amd64'
    : process.arch;

// --- image tag derived from the *resolved* Playwright version ----------------
// The image tag must match the Chromium that `test-storybook` actually launches, which is
// our installed `playwright` package — derive it so a Playwright bump never silently drifts
// the renderer away from its matching font stack.
const playwrightVersion = require('playwright/package.json').version;
const image = `mcr.microsoft.com/playwright:v${playwrightVersion}-noble`;

// --- node_modules strategy: bind-mount on Linux, shadow + reinstall on macOS -
// A Linux host's node_modules are already the container's platform AND arch (the image
// runs native at host arch), so we just bind-mount the repo and use them as-is — no
// `npm ci`. That's faster and sidesteps an "Exit handler never called" crash in the
// image's npm 11. On macOS the host install is darwin binaries the Linux container can't
// load, so each workspace's node_modules is shadowed by a named volume that `npm ci`
// fills with Linux binaries inside the container (never clobbering the host's darwin ones).
const linuxHost = process.platform === 'linux';
const rootPkg = require(path.join(repoRoot, 'package.json'));
const workspaceDirs = (rootPkg.workspaces ?? []).flatMap((pattern) => {
  if (!pattern.endsWith('/*')) return existsSync(path.join(repoRoot, pattern)) ? [pattern] : [];
  const base = pattern.slice(0, -2);
  return readdirSync(path.join(repoRoot, base), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => `${base}/${d.name}`);
});

const nodeModulesPaths = ['', ...workspaceDirs].map((ws) =>
  ws ? `${ws}/node_modules` : 'node_modules',
);
const volumeArgs = linuxHost
  ? []
  : nodeModulesPaths.flatMap((rel) => {
      const volName = `alfred-snap-nm-${archKey}-${rel.replaceAll('/', '-')}`;
      return ['-v', `${volName}:/work/${rel}`];
    });

// --- assemble docker run -----------------------------------------------------
const innerScript = update ? 'test:storybook:linux:update' : 'test:storybook:linux';
// On Linux the bind-mounted node_modules are used as-is (no install step). On macOS, run
// `npm ci` into the shadow volumes first, guarded by a marker so repeat runs reuse them;
// set REINSTALL=1 (or change package-lock) to force a clean reinstall.
const containerCmd = [
  'set -e',
  'cd /work',
  ...(linuxHost
    ? []
    : [
        '[ -z "$REINSTALL" ] && [ -e node_modules/.snapshot-deps ] || { npm ci && touch node_modules/.snapshot-deps; }',
      ]),
  `npm run ${innerScript} -w frontend`,
].join(' && ');

const dockerArgs = [
  'run',
  '--rm',
  process.stdout.isTTY ? '-it' : '-i',
  ...(platform ? ['--platform', platform] : []),
  // Chromium needs a real /dev/shm or it crashes mid-render; --ipc=host is Playwright's
  // documented fix. --init reaps the browser/server child processes the test-runner spawns.
  '--ipc=host',
  '--init',
  '-e',
  'CI=1',
  '-e',
  'REINSTALL',
  // Use the image's pre-installed browsers instead of re-downloading into ~/.cache.
  '-e',
  'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
  '-v',
  `${repoRoot}:/work`,
  ...volumeArgs,
  '-w',
  '/work',
  image,
  'bash',
  '-c',
  containerCmd,
];

// --- daemon: the pinned image is the ONLY reproducible renderer --------------
// Snapshots match the committed baselines only when rendered inside the pinned image
// (frozen Chromium + Noble font packages). Rendering natively is NOT a fallback: even on
// Ubuntu Noble, a bare host lacks the image's exact fonts, so text width shifts and every
// text-bearing crop mismatches by whole pixels (e.g. a 175px field renders 216px wide). So
// we always need a Docker daemon. When none is reachable we branch on host:
//   • Linux (headless cloud sandbox / CI) — `dockerd` is a real daemon we can launch
//     ourselves, so START it and proceed (it self-heals the gate the way setup:chromium
//     self-heals the browser binary). Needs root, which the cloud session and CI have.
//   • macOS — Docker Desktop owns the VM; there's no `dockerd` to launch, so hard-fail and
//     tell the dev to start Docker Desktop (Docker stays required on macOS).
function dockerDaemonReachable() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    // Both a missing `docker` binary (ENOENT) and an unreachable daemon land here.
    return false;
  }
}

// Block the main thread without busy-spinning or adding a dependency.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Launch dockerd detached (survives this process via setsid) and wait for the socket.
function startDockerDaemon() {
  console.log('▶ no Docker daemon reachable — starting dockerd…');
  execFileSync('bash', ['-c', 'setsid dockerd >/tmp/dockerd.log 2>&1 &'], { stdio: 'ignore' });
  for (let i = 1; i <= 30; i++) {
    if (dockerDaemonReachable()) {
      console.log(`  dockerd ready after ${i}s`);
      return true;
    }
    sleepSync(1000);
  }
  return false;
}

if (!dockerDaemonReachable()) {
  if (process.platform === 'darwin') {
    console.error(
      '\n✖ Docker is required to render snapshots consistently on macOS, but the Docker daemon is not reachable.',
    );
    console.error('  Start Docker Desktop and retry.');
    process.exitCode = 127;
  } else if (!startDockerDaemon()) {
    console.error(
      '\n✖ Could not start a Docker daemon (need `dockerd` + root). See /tmp/dockerd.log.',
    );
    process.exitCode = 127;
  }
}

if (process.exitCode === undefined && dockerDaemonReachable()) {
  console.log(
    `▶ snapshots in ${image} (${platform || `host/${archKey}`}) — ${update ? 'update' : 'verify'}`,
  );
  try {
    execFileSync('docker', dockerArgs, { stdio: 'inherit', cwd: repoRoot });
  } catch (error) {
    // Surface the container's own exit code (test-storybook failure, build error, …).
    process.exitCode = error.status ?? 1;
  }
}
