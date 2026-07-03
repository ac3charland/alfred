import { makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Mobile landing must fit the visible viewport: the capture-first landing screen (inbox
 * closed) should never overflow and scroll — there is nothing below the fold until the inbox
 * list is opened. Opening the inbox with a full list is the one case where the page is allowed
 * to grow taller than the viewport and scroll.
 *
 * The shell is sized in `dvh` (the visible viewport) rather than `100vh` (the large,
 * address-bar-retracted viewport) precisely so this holds on a real phone; headless Chromium
 * has no dynamic chrome, but this still guards against content-driven overflow regressions on
 * the landing screen.
 */
test.use({ viewport: { width: 390, height: 844 } });

/** True when the document itself has a vertical scrollbar (page-level scroll). */
async function documentOverflowsViewport(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    // 1px of slack absorbs sub-pixel rounding on fractional device heights.
    return doc.scrollHeight > doc.clientHeight + 1;
  });
}

test('the landing screen does not overflow the viewport', async ({ page, seed }) => {
  // Even with an item waiting in the inbox, the closed landing shows only the capture box.
  await seed({ items: [makeItem('A waiting thought')] });

  await page.goto('/');

  await expect(page.getByRole('textbox', { name: 'Capture box' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Tasks' })).toBeHidden();
  expect(await documentOverflowsViewport(page)).toBe(false);
});

test('opening the inbox with a full list lets the page scroll', async ({ page, seed }) => {
  // Enough rows to exceed a phone viewport once the list is revealed.
  const items = Array.from({ length: 30 }, (_, index) => makeItem(`Task ${String(index + 1)}`));
  await seed({ items });

  await page.goto('/?view=inbox');

  const tasks = page.getByRole('list', { name: 'Tasks' });
  await expect(tasks.getByText('Task 1', { exact: true })).toBeVisible();

  // The requirement's exception: an opened inbox is allowed to overflow and scroll.
  await expect(async () => {
    expect(await documentOverflowsViewport(page)).toBe(true);
  }).toPass();
});
