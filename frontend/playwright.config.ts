import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';
import chromiumPkg from '@sparticuz/chromium';

import { AUTH_FILE, E2E_USER, MOCK_PORT, MOCK_URL } from './e2e/support/constants';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

// In CDN-restricted sandboxes, scripts/setup-chromium.mjs extracts a
// @sparticuz/chromium binary to <tmpdir>/chromium. When that file exists, point
// Playwright at it (with the SwiftShader/no-sandbox args it needs). On normal
// machines / CI the file is absent and Playwright uses its own managed browser
// (installed by setup-chromium.mjs via `playwright install chromium`).
const sandboxChromium = existsSync('/tmp/chromium') ? '/tmp/chromium' : undefined;

// The E2E suite never touches real Supabase: it points the Next server at the
// in-memory mock backend (scripts/mock-supabase.mjs). These values are injected
// into the Next webServer's env unconditionally — Next.js inlines the
// NEXT_PUBLIC_* vars into the client bundle at build time (so the browser login
// form also targets the mock), and reads the rest at runtime. They deliberately
// override any real `.env.local`, so a developer's live credentials are never used
// in tests.
const mockEnvironment: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: MOCK_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_mock',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_mock',
  INGEST_API_KEY: 'mock_ingest_key',
  E2E_USER_EMAIL: E2E_USER.email,
  E2E_USER_PASSWORD: E2E_USER.password,
};

const chromiumLaunch = sandboxChromium
  ? {
      launchOptions: {
        executablePath: sandboxChromium,
        // Drop --single-process / --no-zygote: Playwright reuses one browser across
        // spec FILES, and a single-process Chromium exits when its first page closes,
        // crashing later files with "browserContext.newPage: Browser closed". Keep the
        // rest of sparticuz's SwiftShader/GL args.
        args: [
          ...chromiumPkg.args.filter(
            (argument) => argument !== '--single-process' && argument !== '--no-zygote',
          ),
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
        env: {
          ...process.env,
          LD_LIBRARY_PATH: '/tmp:' + (process.env['LD_LIBRARY_PATH'] ?? ''),
        },
      },
    }
  : {};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: 'html',

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // 1. Log in once and persist the session to AUTH_FILE.
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], ...chromiumLaunch },
    },
    // 2. Authenticated tests reuse that session. Specs that need the logged-out
    //    state opt out with `test.use({ storageState: { cookies: [], origins: [] } })`.
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...chromiumLaunch,
        storageState: AUTH_FILE,
      },
      dependencies: ['setup'],
    },
  ],

  webServer: [
    {
      command: 'node scripts/mock-supabase.mjs',
      url: `${MOCK_URL}/__mock__/health`,
      reuseExistingServer: !process.env['CI'],
      timeout: 30_000,
      env: { MOCK_SUPABASE_PORT: String(MOCK_PORT), ...mockEnvironment },
    },
    {
      command: 'npm run build && npm run start',
      url: BASE_URL,
      reuseExistingServer: !process.env['CI'],
      timeout: 180_000,
      env: mockEnvironment,
    },
  ],
});
