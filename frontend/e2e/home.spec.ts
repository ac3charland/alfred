import { expect, test } from '@playwright/test';

// With the Supabase auth gate active, an unauthenticated visitor to any protected
// route is redirected to /login by the middleware. (This is also the deterministic
// behavior when Supabase is unreachable: getUser() returns null → redirect.)
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
