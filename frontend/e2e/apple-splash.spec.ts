import { expect, test } from './support/fixtures';

// The apple-web-app metadata lives in the root layout, so it renders into the
// <head> of every route including the public /login page — no session needed.
test.use({ storageState: { cookies: [], origins: [] } });

test('advertises the iPhone standalone splash screen in the document head', async ({ page }) => {
  await page.goto('/login');

  // Opts into the full-screen standalone chrome that shows a launch image. Next
  // emits the standard `mobile-web-app-capable` name (Apple honors it now).
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute(
    'content',
    'yes',
  );

  const startupImages = page.locator('link[rel="apple-touch-startup-image"]');
  await expect(startupImages).not.toHaveCount(0);

  // The 390×844 @3 iPhone maps to a 1170×2532 navy centered-"a" image.
  const iphone14 = page.locator(
    'link[rel="apple-touch-startup-image"][media*="device-width: 390px"]',
  );
  await expect(iphone14).toHaveAttribute('href', '/splash?w=1170&h=2532');

  // The generator itself serves a PNG at that size.
  const response = await page.request.get('/splash?w=1170&h=2532');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('image/png');
});
