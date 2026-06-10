/**
 * Capture a screenshot of a running page using the same sandbox-aware Chromium
 * that the Playwright E2E suite uses (see scripts/setup-chromium.mjs and
 * playwright.config.ts). This lets a showboat demo doc embed a shot of the live
 * UI without adding any new browser dependency:
 *
 *   npm run dev -w frontend &                                   # start the app
 *   npm run screenshot -w frontend -- http://localhost:3000 shot.png
 *   npm run demo -- image docs/demos/<doc>.md shot.png
 *
 * The output path is resolved against the directory you ran npm from (INIT_CWD),
 * so relative paths land where you expect even though the script runs in frontend/.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { chromium } from '@playwright/test';
import sparticuz from '@sparticuz/chromium';

const [url, output] = process.argv.slice(2);

if (!url || !output) {
  process.stderr.write('usage: screenshot <url> <output.png>\n');
  process.exitCode = 2;
} else {
  const baseDirectory = process.env.INIT_CWD ?? process.cwd();
  const outputPath = path.resolve(baseDirectory, output);

  // In CDN-restricted sandboxes, setup-chromium.mjs extracts a @sparticuz/chromium
  // binary (and its libGLESv2.so) to /tmp. When present, point Playwright at it with
  // the SwiftShader/no-sandbox args it needs; otherwise use Playwright's own browser.
  const sandboxChromium = existsSync('/tmp/chromium') ? '/tmp/chromium' : undefined;
  const launchOptions = sandboxChromium
    ? {
        executablePath: sandboxChromium,
        args: [
          ...sparticuz.args,
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
        env: {
          ...process.env,
          LD_LIBRARY_PATH: `/tmp:${process.env.LD_LIBRARY_PATH ?? ''}`,
        },
      }
    : {};

  const browser = await chromium.launch(launchOptions);
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.screenshot({ path: outputPath, fullPage: true });
    process.stdout.write(`wrote ${outputPath}\n`);
  } finally {
    await browser.close();
  }
}
