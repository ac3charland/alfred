import { expect, test } from './support/fixtures';

/**
 * Signing out clears the session and gates the user back to /login. (The login
 * flow itself is exercised by auth.setup.ts, which captures the shared session.)
 */
test('signing out returns to the login page', async ({ page, seed }) => {
  await seed({});
  await page.goto('/');

  // Sign out now lives inside the top-right instance/account menu.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});
