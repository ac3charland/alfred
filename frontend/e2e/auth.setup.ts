/**
 * Auth setup project — logs in once through the real login form (against the mock
 * Supabase backend) and saves the resulting session to AUTH_FILE. The authenticated
 * `chromium` project reuses it via storageState, so every other spec starts logged in.
 *
 * Driving the real form (rather than hand-crafting a cookie) sidesteps the
 * sb-<ref>-auth-token cookie-name derivation: @supabase/ssr writes whatever cookie it
 * computes from NEXT_PUBLIC_SUPABASE_URL, and the server reads back the same name.
 */
import { expect, test as setup } from '@playwright/test';

import { AUTH_FILE, E2E_USER } from './support/constants';

setup('authenticate', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel('Email').fill(E2E_USER.email);
  await page.getByLabel('Password').fill(E2E_USER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // A successful sign-in refreshes the server tree and pushes to the landing page.
  await page.waitForURL('/');
  await expect(page.getByRole('main')).toBeVisible();

  await page.context().storageState({ path: AUTH_FILE });
});
