/**
 * Ensure a Chromium binary is available for Playwright + the Storybook test-runner.
 *
 * Portable strategy:
 *   1. If a sandbox binary already sits at <tmpdir>/chromium, reuse it.
 *   2. Otherwise try Playwright's standard browser install (works on dev machines / CI).
 *   3. If that fails (e.g. the Playwright download CDN is blocked, as in some sandboxes),
 *      fall back to extracting the @sparticuz/chromium binary to <tmpdir>.
 *
 * playwright.config.ts and test-runner-jest.config.cjs point the browser at
 * <tmpdir>/chromium ONLY when that file exists; otherwise they use Playwright's
 * own managed browser. So on a normal machine this installs standard Chromium and
 * no sandbox-specific path is ever used.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

if (existsSync(chromiumBin)) {
  process.stdout.write('Reusing sandbox chromium at ' + chromiumBin + '\n');
} else if (tryStandardInstall()) {
  process.stdout.write('Standard Playwright chromium installed\n');
} else {
  await extractSparticuz();
}
