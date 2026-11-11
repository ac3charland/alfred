import type { Locator, Page } from '@playwright/test';

import { type SeedState, makeFolder, makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Triage-row layout across breakpoints (ALF-349): a row used to put its due chip, priority chip
 * and folder label on the same line as the title, so on a 390px screen they squeezed the
 * truncating title down to a few characters. Below `md` the meta now drops to its own line under
 * the title; from `md` up the row stays a single line.
 */

/** A local `YYYY-MM-DD` due date for today. */
function today(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear())}-${month}-${day}`;
}

const TITLE = 'Renew the car registration before the grace period ends';

type Box = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>;

/** Seed one filed, high-priority task due today, open Today, and measure its row's parts. */
async function measureRow(page: Page, seed: (state: SeedState) => Promise<void>) {
  await seed({
    folders: [makeFolder('Household admin', { id: 'home' })],
    items: [
      makeItem(TITLE, {
        item_type: 'task',
        folder_id: 'home',
        due_date: today(),
        priority: 'high',
      }),
    ],
  });
  await page.goto('/today');

  const row = page.getByRole('list', { name: 'Tasks due today' }).getByRole('listitem').first();
  const title = row.getByRole('link', { name: TITLE });
  await expect(title).toBeVisible();

  const boxes = await Promise.all(
    [
      row,
      title,
      row.getByRole('button', { name: 'Priority: High' }),
      row.getByText('Household admin'),
    ].map(async (locator) => locator.boundingBox()),
  );
  const [rowBox, titleBox, ...metaBoxes] = boxes.map((box) => {
    if (!box) throw new Error('row not laid out');
    return box;
  }) as [Box, Box, ...Box[]];
  return { rowBox, titleBox, metaBoxes };
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('a Today row keeps its title clear of the chips', async ({ page, seed }) => {
    const { rowBox, titleBox, metaBoxes } = await measureRow(page, seed);

    // The title gets most of the row, not the sliver left beside three pieces of meta.
    expect(titleBox.width).toBeGreaterThan(rowBox.width * 0.7);
    // Every chip sits wholly below the title, never beside or over it.
    for (const box of metaBoxes) {
      expect(box.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);
    }
  });
});

test.describe('on a desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('a Today row stays on one line, chips beside the title', async ({ page, seed }) => {
    const { titleBox, metaBoxes } = await measureRow(page, seed);

    // Each chip's vertical span overlaps the title's: same line, to its right.
    for (const box of metaBoxes) {
      expect(box.y).toBeLessThan(titleBox.y + titleBox.height);
      expect(box.y + box.height).toBeGreaterThan(titleBox.y);
      expect(box.x).toBeGreaterThanOrEqual(titleBox.x + titleBox.width);
    }
  });
});
