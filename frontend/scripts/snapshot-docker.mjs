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
 *
 * NO DOCKER DAEMON? Docker is required on macOS (the only supported local renderer) — this
 * hard-fails there so the dev starts Docker Desktop. On any other host (a headless cloud
 * sandbox / CI runner without a daemon) the gate can't run at all, so it SKIPS with a notice
 * instead of failing; CI remains the authoritative snapshot gate (see docs/cloud-environment.md).
 * It never falls back to native rendering — that diverges from the baselines by whole pixels.
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

// --- guard: the pinned image is the ONLY reproducible renderer ---------------
// Snapshots match the committed baselines only when rendered inside the pinned image
// (frozen Chromium + Noble font packages). Rendering natively is NOT a fallback: even on
// Ubuntu Noble, a bare host lacks the image's exact fonts, so text width shifts and every
// text-bearing crop mismatches by whole pixels (e.g. a 175px field renders 216px wide). So
// when no Docker daemon is reachable we never silently render natively — we branch on host:
//   • macOS — Docker Desktop is the only supported *local* path, so hard-fail and tell the
//     dev to start it (Docker is required on macOS).
//   • elsewhere — a headless cloud/CI host without a daemon can't run the gate at all, so
//     skip it with a notice. CI runs this same wrapper *with* Docker on every PR and is the
//     authoritative snapshot gate where Docker is unavailable (see docs/cloud-environment.md).
function dockerDaemonReachable() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    // Both a missing `docker` binary (ENOENT) and an unreachable daemon land here.
    return false;
  }
}

if (dockerDaemonReachable()) {
  console.log(
    `▶ snapshots in ${image} (${platform || `host/${archKey}`}) — ${update ? 'update' : 'verify'}`,
  );
  try {
    execFileSync('docker', dockerArgs, { stdio: 'inherit', cwd: repoRoot });
  } catch (error) {
    // Surface the container's own exit code (test-storybook failure, build error, …). A
    // missing binary / dead daemon was already handled by the reachability guard above.
    process.exitCode = error.status ?? 1;
  }
} else {
  if (process.platform === 'darwin') {
    console.error(
      '\n✖ Docker is required to render snapshots consistently on macOS, but the Docker daemon is not reachable.',
    );
    console.error('  Start Docker Desktop and retry.');
    process.exitCode = 127;
  } else {
    console.log('⊘ Skipping Storybook image snapshots: no reachable Docker daemon on this host.');
    console.log(
      '  They render in a pinned Docker image for pixel-identical output, and native rendering',
    );
    console.log(
      '  diverges from the committed baselines (different font stack → text-width shift).',
    );
    console.log(
      '  CI runs this same wrapper with Docker on every PR and is the authoritative gate.',
    );
    // exitCode stays 0 — a daemon-less host can't run the gate, so don't block check:slow.
  }
}
