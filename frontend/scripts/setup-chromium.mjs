/**
 * Ensure a Chromium binary is available for Playwright + the Storybook test-runner.
 *
 * Portable strategy:
 *   1. If a sandbox binary already sits at <tmpdir>/chromium, reuse it.
 *   2. Otherwise try Playwright's standard browser install (works on dev machines / CI).
 *   3. If that fails (e.g. the Playwright download CDN is blocked, as in some sandboxes),
 *      fall back to extracting the @sparticuz/chromium binary to <tmpdir>.
 *
 * When the sandbox binary is used, also ensure its NSS/NSPR shared-library
 * dependencies resolve — minimal containers often lack libnspr4/libnss3/libnssutil3.
 * See ensureNssStubs below and the playwright skill, "NSS/NSPR stub libraries".
 *
 * playwright.config.ts and test-runner-jest.config.cjs point the browser at
 * <tmpdir>/chromium ONLY when that file exists; otherwise they use Playwright's
 * own managed browser. So on a normal machine this installs standard Chromium and
 * no sandbox-specific path is ever used.
 */
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { join, dirname, resolve } = path;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const chromiumBin = join(tmpdir(), 'chromium');
const glLibrary = join(tmpdir(), 'libGLESv2.so');

function tryStandardInstall() {
  try {
    execSync('npx playwright install chromium', { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

async function extractSparticuz() {
  if (existsSync(chromiumBin) && existsSync(glLibrary)) {
    process.stdout.write('Sandbox chromium already extracted at ' + chromiumBin + '\n');
    return;
  }
  const { inflate } = await import('@sparticuz/chromium');
  const localBin = resolve(scriptDirectory, '../node_modules/@sparticuz/chromium/bin');
  const rootBin = resolve(scriptDirectory, '../../node_modules/@sparticuz/chromium/bin');
  const binDirectory = existsSync(join(localBin, 'chromium.br')) ? localBin : rootBin;
  process.stdout.write('Playwright CDN unavailable; extracting sandbox chromium\n');
  await Promise.all([
    inflate(join(binDirectory, 'chromium.br')),
    inflate(join(binDirectory, 'swiftshader.tar.br')),
  ]);
  process.stdout.write('Sandbox chromium ready at ' + chromiumBin + '\n');
}

/**
 * The @sparticuz/chromium binary dynamically links libnspr4 / libnss3 / libnssutil3.
 * Minimal sandboxes lack them, so the binary fails to load ("error while loading shared
 * libraries: libnspr4.so"). Chromium only needs their *symbols* resolved at load time —
 * headless + SwiftShader never enters NSS for non-TLS pages — so we emit stub `.so`
 * files exporting exactly the symbols this binary imports (versioned NSS_/NSSUTIL_ and
 * unversioned PR_/PL_) into <tmpdir>, which playwright.config.ts / the test-runner config
 * already add to LD_LIBRARY_PATH. No-op on machines where the real libs (or gcc/nm) are
 * absent. See the playwright skill, "NSS/NSPR stub libraries".
 */
function ensureNssStubs() {
  const targets = ['libnspr4.so', 'libnss3.so', 'libnssutil3.so'];
  if (targets.every((lib) => existsSync(join(tmpdir(), lib)))) {
    process.stdout.write('NSS/NSPR stub libraries already present\n');
    return;
  }
  const linkPath = tmpdir() + ':' + (process.env['LD_LIBRARY_PATH'] ?? '');
  let ldd = '';
  try {
    ldd = execSync('ldd ' + chromiumBin + ' 2>&1 || true', {
      encoding: 'utf8',
      env: { ...process.env, LD_LIBRARY_PATH: linkPath },
    });
  } catch {
    ldd = '';
  }
  const missing = targets.filter((lib) =>
    new RegExp(lib + String.raw`\s*=>\s*not found`).test(ldd),
  );
  if (missing.length === 0) return;

  let nm = '';
  try {
    nm = execSync('nm -D ' + chromiumBin, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  } catch {
    process.stdout.write('nm/gcc unavailable; skipping NSS stub generation\n');
    return;
  }

  const versioned = { 'libnss3.so': {}, 'libnssutil3.so': {}, 'libnspr4.so': {} };
  const unversioned = { 'libnspr4.so': new Set() };
  for (const line of nm.split('\n')) {
    const versionedMatch = /^\s+[Uw]\s+([^@\s]+)@+(\S+)$/.exec(line);
    if (versionedMatch) {
      const [, sym, ver] = versionedMatch;
      let lib;
      if (ver.startsWith('NSS_')) lib = 'libnss3.so';
      else if (ver.startsWith('NSSUTIL_')) lib = 'libnssutil3.so';
      else if (ver.startsWith('NSPR_')) lib = 'libnspr4.so';
      else continue;
      (versioned[lib][ver] ??= new Set()).add(sym);
      continue;
    }
    const plainMatch = /^\s+[Uw]\s+((?:PR_|PL_|PLC|PLDS)[A-Za-z0-9_]+)\s*$/.exec(line);
    if (plainMatch) unversioned['libnspr4.so'].add(plainMatch[1]);
  }

  try {
    for (const lib of missing) {
      const byVersion = versioned[lib] ?? {};
      const plain = unversioned[lib] ?? new Set();
      const all = new Set(plain);
      for (const set of Object.values(byVersion)) for (const sym of set) all.add(sym);

      const cPath = join(tmpdir(), lib + '.c');
      const soPath = join(tmpdir(), lib);
      let cSource = '';
      for (const sym of all) cSource += 'void ' + sym + '(void){}\n';
      writeFileSync(cPath, cSource);

      const versions = Object.keys(byVersion);
      if (versions.length > 0) {
        const mapPath = join(tmpdir(), lib + '.map');
        let mapSource = '';
        for (const ver of versions) {
          mapSource += ver + ' {\n  global:\n';
          for (const sym of byVersion[ver]) mapSource += ' '.repeat(4) + sym + ';\n';
          mapSource += '};\n';
        }
        writeFileSync(mapPath, mapSource);
        execSync(
          'gcc -shared -fPIC -Wl,--version-script=' + mapPath + ' -o ' + soPath + ' ' + cPath,
          {
            stdio: 'inherit',
          },
        );
      } else {
        execSync('gcc -shared -fPIC -o ' + soPath + ' ' + cPath, { stdio: 'inherit' });
      }
      process.stdout.write('Generated stub ' + soPath + ' (' + all.size + ' symbols)\n');
    }
  } catch {
    process.stdout.write('gcc unavailable; skipping NSS stub generation\n');
  }
}

if (existsSync(chromiumBin)) {
  process.stdout.write('Reusing sandbox chromium at ' + chromiumBin + '\n');
} else if (tryStandardInstall()) {
  process.stdout.write('Standard Playwright chromium installed\n');
} else {
  await extractSparticuz();
}

// Sandbox chromium (the <tmpdir>/chromium binary) needs its NSS/NSPR deps to resolve.
// The standard-install path uses Playwright's managed browser and never creates this file.
if (existsSync(chromiumBin)) {
  ensureNssStubs();
}
