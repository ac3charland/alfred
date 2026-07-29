import type { Locator } from '@playwright/test';

import { localDaysAgo, localToday, makeHabit, makeHabitEntry } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Which end of the history the grid opens on, at a width where it cannot show the whole thing.
 *
 * A quarter of squares is wider than a phone, so the strip always overflows here — and the days
 * worth landing on are the recent ones. The rest of the quarter stays one gesture behind them,
 * which is what separates "anchored to the newest week" from "cropped to it".
 */

test.use({ viewport: { width: 390, height: 844 } });

interface Box {
  x: number;
  width: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('element has no bounding box');
  return box;
}

test('opens on the newest squares, with the rest of the quarter a scroll away', async ({
  page,
  seed,
}) => {
  // Started well before the window, so every column in the quarter is a day of the habit's life
  // and nothing that scrolls past reads as padding.
  const habit = makeHabit('Morning routine', { started_on: localDaysAgo(200) });
  await seed({ habits: [habit], habitEntries: [makeHabitEntry(habit.id, localToday())] });
  await page.goto('/habits');

  const strip = page.getByTestId('history-scroll');
  const labels = page.getByTestId('history-weekdays');
  const today = page.locator(`[data-date="${localToday()}"]`);
  // The first column the window covers — 17 weeks of squares away from today.
  const oldest = page.locator(`[data-date="${localDaysAgo(119)}"]`);

  await expect(today).toHaveAttribute('data-status', 'met');

  // There is genuinely more history than fits: this is a scroll strip, not a short row.
  const hidden = await strip.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(hidden).toBeGreaterThan(0);

  // Today is on screen, against the strip's right edge — no scrolling required to find it.
  const stripBox = await boxOf(strip);
  const todayBox = await boxOf(today);
  const stripRight = stripBox.x + stripBox.width;
  expect(todayBox.x).toBeGreaterThan(stripBox.x);
  expect(todayBox.x + todayBox.width).toBeGreaterThan(stripRight - 40);
  expect(todayBox.x + todayBox.width).toBeLessThanOrEqual(stripRight + 1);

  // The oldest column is off the left of the strip, where the older history belongs.
  const oldestBox = await boxOf(oldest);
  expect(oldestBox.x).toBeLessThan(stripBox.x);

  const labelsBefore = await boxOf(labels);

  // Scrolling back reaches it, which is the half of this the anchoring must not cost.
  await strip.evaluate((element) => {
    element.scrollBy(-element.scrollWidth, 0);
  });
  const oldestScrolledTo = await boxOf(oldest);
  expect(oldestScrolledTo.x).toBeGreaterThanOrEqual(stripBox.x - 1);

  // …and the weekday legend has not moved a pixel with it: it sits outside the strip, so it is
  // still there to read whichever week the columns are scrolled to.
  const labelsAfter = await boxOf(labels);
  expect(labelsAfter.x).toBe(labelsBefore.x);
});
