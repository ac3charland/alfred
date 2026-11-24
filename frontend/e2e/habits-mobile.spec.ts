import type { Locator, Page } from '@playwright/test';

import { localDaysAgo, localToday, makeHabit, makeHabitEntry } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Logging a habit day on a phone: thumb-sized squares, and an editor that rises as a bottom sheet
 * with 44px controls rather than the desktop's anchored popover.
 *
 * Touch mode is a phone-width viewport OR a coarse pointer, so these run with touch enabled at a
 * phone's size — and once at a tablet's width, where the pointer alone has to switch it on.
 */

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('element has no bounding box');
  return box;
}

function square(page: Page, date: string): Locator {
  return page.locator(`[data-date="${date}"]`);
}

async function heightOf(locator: Locator): Promise<number> {
  const box = await boxOf(locator);
  return box.height;
}

async function tapCentre(page: Page, locator: Locator) {
  const box = await boxOf(locator);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/** "Tue 24 Nov" for an ISO day — the date as the sheet's header and name spell it. */
function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${iso}T00:00:00Z`));
}

test('squares are 38px on a 44px pitch, and a tap in the gap opens the nearest day', async ({
  page,
  seed,
}) => {
  const habit = makeHabit('Morning routine', { started_on: localDaysAgo(60) });
  await seed({ habits: [habit] });
  await page.goto('/habits');

  // Last week's Monday and Tuesday: the top two squares of the second-newest column, which are
  // always past days (the newest column is padded out to Sunday, so may hold future ones).
  const days = page.getByRole('group', { name: 'Morning routine history' }).locator('[data-date]');
  const count = await days.count();
  const upperCell = days.nth(count - 14);
  const lowerCell = days.nth(count - 13);
  const upper = (await upperCell.getAttribute('data-date')) ?? '';
  const lower = (await lowerCell.getAttribute('data-date')) ?? '';

  const upperBox = await boxOf(upperCell);
  const lowerBox = await boxOf(lowerCell);
  expect(upperBox.width).toBe(38);
  expect(upperBox.height).toBe(38);
  expect(lowerBox.y - upperBox.y).toBe(44);

  // The button's target reaches 3px past the square: 2px below the upper square, inside the
  // 6px gap, still belongs to it.
  await page.touchscreen.tap(upperBox.x + 19, upperBox.y + 38 + 2);
  await expect(
    page.getByRole('dialog', { name: `${shortDate(upper)} — Morning routine` }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).tap();
  await expect(page.getByRole('dialog')).toBeHidden();

  // …and 2px above the lower square belongs to that one: the targets meet with no dead gap.
  await page.touchscreen.tap(lowerBox.x + 19, lowerBox.y - 2);
  await expect(
    page.getByRole('dialog', { name: `${shortDate(lower)} — Morning routine` }),
  ).toBeVisible();
});

test('logs a day through the sheet with Yes and a time, and it survives a reload', async ({
  page,
  seed,
}) => {
  const habit = makeHabit('Morning routine', {
    started_on: localDaysAgo(30),
    criteria: [
      { key: 'wake', label: 'Up by 6:15', kind: 'time', target: 375, comparator: 'lte' },
      { key: 'light', label: 'Outside for light', kind: 'boolean' },
    ],
  });
  await seed({ habits: [habit] });
  await page.goto('/habits');

  const today = localToday();
  const cell = square(page, today);
  await tapCentre(page, cell.locator('button'));

  const sheet = page.getByRole('dialog', { name: `${shortDate(today)} — Morning routine` });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Morning routine', { exact: true })).toBeVisible();
  await expect(sheet.getByText('Missed', { exact: true })).toBeVisible();

  // Every control a thumb has to hit is at least 44px tall.
  const light = sheet.getByRole('group', { name: 'Outside for light' });
  for (const control of [
    sheet.getByLabel('Up by 6:15', { exact: true }),
    light.getByRole('button', { name: 'Yes' }),
    light.getByRole('button', { name: 'No' }),
    sheet.getByRole('button', { name: /More options/ }),
    sheet.getByRole('button', { name: 'Done' }),
  ]) {
    expect(await heightOf(control)).toBeGreaterThanOrEqual(44);
  }

  await sheet.getByLabel('Up by 6:15', { exact: true }).fill('06:04');
  await light.getByRole('button', { name: 'Yes' }).tap();
  await expect(light.getByRole('button', { name: 'Yes' })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByText('Met', { exact: true })).toBeVisible();

  await sheet.getByRole('button', { name: 'Done' }).tap();
  await expect(sheet).toBeHidden();
  await expect(cell).toHaveAttribute('data-status', 'met');
  // Focus is handed back to the square the sheet came from.
  await expect(cell.locator('button')).toBeFocused();

  await page.reload();
  await expect(cell).toHaveAttribute('data-status', 'met');
});

test('skips a day from inside the sheet, after a typed reason', async ({ page, seed }) => {
  const habit = makeHabit('Morning routine', { started_on: localDaysAgo(30) });
  await seed({ habits: [habit] });
  await page.goto('/habits');

  const today = localToday();
  await tapCentre(page, square(page, today).locator('button'));
  const sheet = page.getByRole('dialog', { name: /Morning routine/ });

  await sheet.getByRole('button', { name: /More options/ }).tap();
  const item = page.getByRole('menuitem', { name: 'Mark as skipped…' });
  // Measured once the menu's zoom-in has finished — mid-animation it is drawn at 95% scale.
  await expect.poll(() => heightOf(item)).toBeGreaterThanOrEqual(44);
  await item.tap();

  const reason = sheet.getByLabel('Reason for skipping');
  const cancel = sheet.getByRole('button', { name: 'Cancel' });
  const commit = sheet.getByRole('button', { name: 'Skip this day' });
  for (const control of [reason, cancel, commit]) {
    expect(await heightOf(control)).toBeGreaterThanOrEqual(44);
  }

  // Cancel returns to the criteria rather than closing.
  await cancel.tap();
  await expect(sheet.getByRole('group', { name: 'Outside for light' })).toBeVisible();

  await sheet.getByRole('button', { name: /More options/ }).tap();
  await page.getByRole('menuitem', { name: 'Mark as skipped…' }).tap();
  await expect(commit).toBeDisabled();
  await reason.fill('Flu — in bed all day');
  await commit.tap();

  await expect(sheet).toBeHidden();
  await expect(square(page, today)).toHaveAttribute('data-status', 'skipped');

  // Reopened, the day shows why it was excused in place of its criteria.
  await page.reload();
  await tapCentre(page, square(page, today).locator('button'));
  const reopened = page.getByRole('dialog', { name: /Morning routine/ });
  await expect(reopened.getByText('Flu — in bed all day')).toBeVisible();
  await expect(reopened.getByRole('group', { name: 'Outside for light' })).toHaveCount(0);
});

test.describe('a habit with more criteria than fit', () => {
  test.use({ viewport: { width: 390, height: 600 } });

  test('scrolls the rows inside the sheet, keeping the header and Done in reach', async ({
    page,
    seed,
  }) => {
    const habit = makeHabit('Big routine', {
      started_on: localDaysAgo(30),
      criteria: Array.from({ length: 8 }, (_, index) => ({
        key: `c${String(index)}`,
        label: `Criterion ${String(index + 1)}`,
        kind: 'boolean' as const,
      })),
    });
    await seed({ habits: [habit] });
    await page.goto('/habits');

    await tapCentre(page, square(page, localToday()).locator('button'));
    const sheet = page.getByRole('dialog', { name: /Big routine/ });
    await expect(sheet).toBeVisible();

    // Never taller than the screen less 16px.
    const sheetBox = await boxOf(sheet);
    expect(sheetBox.height).toBeLessThanOrEqual(600 - 16);
    expect(sheetBox.y + sheetBox.height).toBeLessThanOrEqual(600 + 1);

    const done = sheet.getByRole('button', { name: 'Done' });
    await expect(done).toBeInViewport();
    await expect(sheet.getByText(shortDate(localToday()), { exact: true })).toBeInViewport();

    // The last criterion is below the fold, one scroll of the rows away.
    const last = sheet.getByRole('group', { name: 'Criterion 8' });
    await expect(last).not.toBeInViewport();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await expect(done).toBeInViewport();
  });
});

test.describe('a tablet', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

  test('gets the touch treatment from its coarse pointer alone', async ({ page, seed }) => {
    const habit = makeHabit('Morning routine', { started_on: localDaysAgo(30) });
    await seed({ habits: [habit] });
    await page.goto('/habits');

    const today = square(page, localToday());
    const todayBox = await boxOf(today);
    expect(todayBox.width).toBe(38);

    await tapCentre(page, today.locator('button'));
    const sheet = page.getByRole('dialog', { name: /Morning routine/ });
    await expect(sheet).toBeVisible();
    // Capped at 28rem and centred rather than stretched across the tablet.
    const box = await boxOf(sheet);
    expect(box.width).toBe(448);
    // Centred on the overlay it rises over (a desktop Chromium with touch reserves a strip at the
    // right edge, so the window's own width is not the box both are laid out in).
    const overlay = await page.evaluate(() => {
      const element = document.querySelector('.backdrop-blur-sm');
      return element === null ? 0 : element.getBoundingClientRect().width;
    });
    expect(overlay).toBeGreaterThan(448);
    expect(Math.abs(box.x + box.width / 2 - overlay / 2)).toBeLessThanOrEqual(1);
  });
});

test.describe('before hydration', () => {
  test.use({ javaScriptEnabled: false });

  test('paints 38px squares from the server’s HTML, with no resize waiting on script', async ({
    page,
    seed,
  }) => {
    const habit = makeHabit('Morning routine', { started_on: localDaysAgo(30) });
    await seed({ habits: [habit], habitEntries: [makeHabitEntry(habit.id, localToday())] });
    await page.goto('/habits');

    const box = await boxOf(square(page, localToday()));
    expect(box.width).toBe(38);
    expect(box.height).toBe(38);
  });
});
