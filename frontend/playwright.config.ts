import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';
import chromiumPkg from '@sparticuz/chromium';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

// In CDN-restricted sandboxes, scripts/setup-chromium.mjs extracts a
// @sparticuz/chromium binary to <tmpdir>/chromium. When that file exists, point
// Playwright at it (with the SwiftShader/no-sandbox args it needs). On normal
// machines / CI the file is absent and Playwright uses its own managed browser
// (installed by setup-chromium.mjs via `playwright install chromium`).
const sandboxChromium = existsSync('/tmp/chromium') ? '/tmp/chromium' : undefined;

// When no real Supabase env is configured (a fresh sandbox / CI checkout with no
// gitignored `.env.local`), fall back to non-functional placeholders so the
// production webServer (`next build && next start`) can boot — the Supabase
// client constructor throws outright when its URL/key are absent. The unreachable
// host then makes `getUser()` return null, so middleware redirects to /login,
// which is exactly what `e2e/home.spec.ts` asserts. Real credentials always win:
// Next.js never overrides an already-set `process.env` var, and these are injected
// only when none is present — so this can't leak into dev or production builds.
const hasSupabaseEnvironment =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) || existsSync('.env.local');

const webServerFallbackEnvironment: Record<string, string> = hasSupabaseEnvironment
  ? {}
  : {
      NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_placeholder',
      SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_placeholder',
      INGEST_API_KEY: 'placeholder_ingest_key',
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
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(sandboxChromium
          ? {
              launchOptions: {
                executablePath: sandboxChromium,
                args: [
                  ...chromiumPkg.args,
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
          : {}),
      },
    },
  ],

  webServer: {
    command: 'npm run build && npm run start',
    url: BASE_URL,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    env: webServerFallbackEnvironment,
  },
});
