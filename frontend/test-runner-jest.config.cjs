const { existsSync } = require('node:fs');

const { getJestConfig } = require('@storybook/test-runner');

const config = getJestConfig();

// Use the sandbox @sparticuz/chromium binary only when it has been extracted
// (CDN-restricted environments — see scripts/setup-chromium.mjs). On normal
// machines / CI the file is absent and the test-runner uses Playwright's own
// managed browser.
const sandboxChromium = existsSync('/tmp/chromium') ? '/tmp/chromium' : undefined;

/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  ...config,
  testTimeout: 30_000,
  // Sandbox chromium is single-process + SwiftShader; run stories serially so only one
  // page is live at a time (avoids cumulative browser-memory "Browser closed" crashes).
  ...(sandboxChromium ? { maxWorkers: 1 } : {}),
  ...(sandboxChromium
    ? {
        testEnvironmentOptions: {
          ...config.testEnvironmentOptions,
          'jest-playwright': {
            ...config.testEnvironmentOptions?.['jest-playwright'],
            launchOptions: {
              executablePath: sandboxChromium,
              args: [
                // NOT --single-process: jest-playwright reuses one browser across test
                // files, and single-process chromium exits when its first page closes,
                // breaking suite #2+ with "Browser closed". Multi-process survives.
                // /dev/shm is tiny in sandboxes; use /tmp to avoid "Browser closed" crashes.
                '--disable-dev-shm-usage',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--font-render-hinting=none',
                '--ignore-gpu-blocklist',
                '--in-process-gpu',
                '--use-gl=angle',
                '--use-angle=swiftshader',
                '--enable-unsafe-swiftshader',
                '--disable-web-security',
                '--enable-features=SharedArrayBuffer',
              ],
              env: {
                ...process.env,
                LD_LIBRARY_PATH: '/tmp:' + (process.env.LD_LIBRARY_PATH || ''),
              },
            },
          },
        },
      }
    : {}),
};
