import { defineConfig, devices } from '@playwright/test';

import {
  AUTH_FILE,
  E2E_USER,
  INGEST_API_KEY,
  MOCK_PORT,
  MOCK_URL,
  WIKI_GITHUB_API_URL,
  WIKI_GITHUB_TOKEN,
  WIKI_REPO,
} from './e2e/support/constants';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

// The E2E suite never touches real Supabase: it points the Next server at the
// in-memory mock backend (scripts/mock-supabase.mjs). These values are injected
// into the Next webServer's env unconditionally — Next.js inlines the
// NEXT_PUBLIC_* vars into the client bundle at build time (so the browser login
// form also targets the mock), and reads the rest at runtime. They deliberately
// override any real `.env.local`, so a developer's live credentials are never used
// in tests.
//
// The four INSTAPAPER_* credentials are fakes that switch the Reader's Send verb on, and
// INSTAPAPER_API_URL points its route at the same mock process, which stands in for Instapaper's
// bookmarks/add (the call leaves the Next server, where page.route() can't reach it).
const mockEnvironment: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: MOCK_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_mock',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_mock',
  INGEST_API_KEY,
  E2E_USER_EMAIL: E2E_USER.email,
  E2E_USER_PASSWORD: E2E_USER.password,
  INSTAPAPER_CONSUMER_KEY: 'mock-consumer-key',
  INSTAPAPER_CONSUMER_SECRET: 'mock-consumer-secret',
  INSTAPAPER_ACCESS_TOKEN: 'mock-access-token',
  INSTAPAPER_ACCESS_TOKEN_SECRET: 'mock-access-token-secret',
  INSTAPAPER_API_URL: MOCK_URL,
  // The wiki writer, pointed at the mock's Git Data API emulation so a send's commit lands in
  // the mock and can be read back from /__mock__/state. Deliberate feature wiring: with these
  // set the harness runs as the Personal deployment (writable), which is the state every send
  // journey needs; a spec that wants the Work instance's read-only shell has none.
  WIKI_GITHUB_TOKEN,
  WIKI_REPO,
  WIKI_GITHUB_API_URL,
};

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
      use: { ...devices['Desktop Chrome'] },
    },
    // 2. Authenticated tests reuse that session. Specs that need the logged-out
    //    state opt out with `test.use({ storageState: { cookies: [], origins: [] } })`.
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
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
