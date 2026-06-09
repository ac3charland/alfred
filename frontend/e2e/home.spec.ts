import { expect, test } from '@playwright/test';

test('home page renders the alfred heading', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'alfred', level: 1 })).toBeVisible();
  await expect(page.getByText('A capture-first personal task system')).toBeVisible();
});
