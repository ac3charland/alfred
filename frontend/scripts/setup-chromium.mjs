/**
 * Ensure Playwright's managed Chromium is available for the E2E suite and the
 * Storybook test-runner.
 *
 * Idempotent: Playwright resolves the expected browser path even before download,
 * so we check that path on disk and skip the install entirely when it already
 * exists — avoiding the installer's version/registry round-trip on every
 * `test:e2e` / `test:storybook` run. Only when the binary is missing do we run
 * `playwright install chromium`.
 *
 * This needs network access to Playwright's browser CDN (cdn.playwright.dev). In
 * Claude Code on the web that means a custom environment whose network policy
 * allowlists that host — see docs/cloud-environment.md.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { chromium } from '@playwright/test';

let installed = false;
try {
  installed = existsSync(chromium.executablePath());
} catch {
  installed = false;
}

if (installed) {
  process.stdout.write('Chromium already installed; skipping playwright install\n');
} else {
  execSync('npx playwright install chromium', { stdio: 'inherit' });
}
