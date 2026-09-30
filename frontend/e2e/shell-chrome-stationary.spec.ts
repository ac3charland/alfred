import type { Locator, Page } from '@playwright/test';

import { type SeedState, makeFolder, makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * ALF-304 — only the module's content scrolls: the top bar and the desktop sidebar stay put.
 *
 * The document is still the scroller (see app-shell.styles.ts), so this pins the chrome to the
 * viewport rather than proving an inner pane scrolls: after scrolling a long list, the header and
 * the sidebar's wordmark sit exactly where they started while the content has moved.
 */

async function seedLongList(seed: (state: SeedState) => Promise<void>) {
  const folder = makeFolder('Long list', { id: 'f1' });
  await seed({
    folders: [folder],
    items: Array.from({ length: 60 }, (_, index) =>
      makeItem(`Task ${String(index)}`, { folder_id: 'f1' }),
    ),
  });
  return folder;
}

async function scrollDocument(page: Page, top: number) {
  await page.evaluate((y) => {
    window.scrollTo(0, y);
  }, top);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(top);
}

/** The element's viewport box; fails the test outright if it isn't rendered. */
async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('element has no bounding box');
  return rect;
}

test('desktop: the header and sidebar stay put while the task list scrolls', async ({
  page,
  seed,
}) => {
  const folder = await seedLongList(seed);
  await page.goto(`/folders/${folder.id}`);

  const header = page.locator('header');
  const sidebar = page.locator('aside');
  const wordmark = sidebar.getByRole('link', { name: 'alfred — back to capture' });
  const task = page.getByText('Task 0', { exact: true });
  await expect(task).toBeVisible();

  const headerBefore = await box(header);
  const wordmarkBefore = await box(wordmark);
  const taskBefore = await box(task);

  await scrollDocument(page, 400);

  const headerAfter = await box(header);
  const wordmarkAfter = await box(wordmark);
  const taskAfter = await box(task);
  const sidebarAfter = await box(sidebar);

  // The content moved…
  expect(taskAfter.y).toBe(taskBefore.y - 400);
  // …the chrome did not.
  expect(headerAfter.y).toBe(headerBefore.y);
  expect(wordmarkAfter.y).toBe(wordmarkBefore.y);
  // And the sidebar is exactly one viewport tall, so its nav never scrolls off the page.
  expect(sidebarAfter.height).toBe(page.viewportSize()?.height);
});

test('a row scrolled into view lands below the pinned top bar, not under it', async ({
  page,
  seed,
}) => {
  const folder = await seedLongList(seed);
  await page.goto(`/folders/${folder.id}`);

  const row = page.getByText('Task 40', { exact: true });
  await row.evaluate((node) => {
    node.scrollIntoView({ block: 'start' });
  });

  const headerBox = await box(page.locator('header'));
  const rowBox = await box(row);
  expect(rowBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
});

test.describe('mobile', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('the top bar stays put while the task list scrolls', async ({ page, seed }) => {
    const folder = await seedLongList(seed);
    await page.goto(`/folders/${folder.id}`);

    const header = page.locator('header');
    await expect(page.getByText('Task 0', { exact: true })).toBeVisible();
    const before = await box(header);

    await scrollDocument(page, 400);

    const after = await box(header);
    expect(after.y).toBe(before.y);
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeInViewport();
  });
});
