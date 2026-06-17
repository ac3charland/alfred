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
 * This wrapper bind-mounts the repo, runs the real `test:storybook:linux[:update]` script
 * inside the image, and shadows every workspace's `node_modules` with a named cache volume
 * so the container's Linux binaries never clobber the host's darwin ones (and stay cached
 * between runs). Baselines under `frontend/__image_snapshots__/` are written back to the host
 * through the bind mount.
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

// --- node_modules shadow volumes (one per workspace + root) ------------------
// Reading the workspace globs from the root package.json keeps this correct when a workspace
// is added. Each gets a named volume mounted over its node_modules so `npm ci` inside the
// container writes Linux binaries into the volume, never onto the host's darwin install.
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
const volumeArgs = nodeModulesPaths.flatMap((rel) => {
  const volName = `alfred-snap-nm-${archKey}-${rel.replaceAll('/', '-')}`;
  return ['-v', `${volName}:/work/${rel}`];
});

// --- assemble docker run -----------------------------------------------------
const innerScript = update ? 'test:storybook:linux:update' : 'test:storybook:linux';
// `npm ci` is guarded by a marker so repeat runs reuse the cached volume; set REINSTALL=1
// (or change package-lock) to force a clean reinstall.
const containerCmd = [
  'set -e',
  'cd /work',
  '[ -z "$REINSTALL" ] && [ -e node_modules/.snapshot-deps ] || { npm ci && touch node_modules/.snapshot-deps; }',
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

// On Linux without a Docker socket (e.g. cloud sandbox / CI without Docker-in-Docker), the
// wrapper can't launch the container — but running test:storybook:linux directly is equivalent
// because we're already on the same FreeType + Chromium stack the container provides. Fall back
// instead of failing so pre-push still validates the snapshots in these environments.
const dockerSocket = '/var/run/docker.sock';
if (process.platform === 'linux' && !existsSync(dockerSocket)) {
  console.log(
    `▶ Docker socket not found at ${dockerSocket}; running ${innerScript} directly (Linux host)`,
  );
  execFileSync('npm', ['run', innerScript, '-w', 'frontend'], { stdio: 'inherit', cwd: repoRoot });
} else {
  console.log(
    `▶ snapshots in ${image} (${platform || `host/${archKey}`}) — ${update ? 'update' : 'verify'}`,
  );
  try {
    execFileSync('docker', dockerArgs, { stdio: 'inherit', cwd: repoRoot });
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(
        '\n✖ Docker is required to run snapshots consistently but `docker` was not found.',
      );
      console.error('  Install Docker Desktop and ensure it is running, then retry.');
      process.exitCode = 127;
    } else {
      // Surface the container's own exit code (test-storybook failure, build error, …).
      process.exitCode = error.status ?? 1;
    }
  }
}
