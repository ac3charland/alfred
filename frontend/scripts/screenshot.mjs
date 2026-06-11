/**
 * Capture a screenshot of a running page using the same Playwright-managed
 * Chromium that the E2E suite uses (see scripts/setup-chromium.mjs and
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
import path from 'node:path';
import process from 'node:process';

import { chromium } from '@playwright/test';

const [url, output] = process.argv.slice(2);

if (!url || !output) {
  process.stderr.write('usage: screenshot <url> <output.png>\n');
  process.exitCode = 2;
} else {
  const baseDirectory = process.env.INIT_CWD ?? process.cwd();
  const outputPath = path.resolve(baseDirectory, output);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.screenshot({ path: outputPath, fullPage: true });
    process.stdout.write(`wrote ${outputPath}\n`);
  } finally {
    await browser.close();
  }
}
