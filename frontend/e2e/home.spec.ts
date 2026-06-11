import { expect, test } from '@playwright/test';

// This spec verifies the logged-OUT behavior, so it opts out of the shared
// authenticated session that the chromium project applies by default.
test.use({ storageState: { cookies: [], origins: [] } });

// With the Supabase auth gate active, an unauthenticated visitor to any protected
// route is redirected to /login by the middleware. (With no session cookie,
// getUser() short-circuits to null without even contacting the backend.)
test('unauthenticated visit to / is gated to the login page', async ({ page }) => {
  // getUser() runs server-side on the redirect + login render; allow headroom.
  test.setTimeout(60_000);

  await page.goto('/');

  await expect(page).toHaveURL(/\/login$/);

  // The single-user login form is shown.
  await expect(page.getByRole('heading', { name: 'alfred', level: 1 })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});
