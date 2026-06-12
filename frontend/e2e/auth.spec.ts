import { expect, test } from './support/fixtures';

/**
 * Signing out clears the session and gates the user back to /login. (The login
 * flow itself is exercised by auth.setup.ts, which captures the shared session.)
 */
test('signing out returns to the login page', async ({ page, seed }) => {
  await seed({});
  await page.goto('/');

  await page.getByRole('button', { name: 'Sign out' }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});
