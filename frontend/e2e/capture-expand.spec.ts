import { expect, test } from './support/fixtures';

/**
 * Regression guard for ALF-285: the Inbox capture box must grow to fit what's typed.
 *
 * The textarea used to be a fixed three rows, so a fourth line (or a long thought that wraps)
 * scrolled inside the box — the earliest lines slid out of sight and the newest ran underneath
 * the "Enter to capture" hint and Capture button. jsdom does no layout, so the unit tests can
 * only assert the wiring; here the real textarea is measured: it must never scroll internally
 * (`scrollHeight` == `clientHeight`) and must be taller than its resting height once the text
 * needs more room.
 */

/** The textarea's overflow: how far its content runs past its own visible box, in px. */
async function hiddenOverflowOf(box: import('@playwright/test').Locator): Promise<number> {
  return box.evaluate((element) => element.scrollHeight - element.clientHeight);
}

async function heightOf(box: import('@playwright/test').Locator): Promise<number> {
  const rect = await box.boundingBox();
  if (rect === null) throw new Error('capture box has no layout box');
  return rect.height;
}

test('typing more lines than fit grows the capture box instead of scrolling it', async ({
  page,
}) => {
  await page.goto('/');
  const box = page.getByRole('combobox', { name: 'Capture box' });
  const restingHeight = await heightOf(box);

  await box.fill(Array.from({ length: 8 }, (_, index) => `line ${String(index + 1)}`).join('\n'));

  await expect.poll(() => hiddenOverflowOf(box)).toBeLessThanOrEqual(1);
  expect(await heightOf(box)).toBeGreaterThan(restingHeight);
});

test('a long thought that wraps grows the box too', async ({ page }) => {
  await page.goto('/');
  const box = page.getByRole('combobox', { name: 'Capture box' });
  const restingHeight = await heightOf(box);

  // ~570 characters: several wrapped lines, but short of the viewport cap.
  await box.fill('a wrapping thought '.repeat(30));

  await expect.poll(() => hiddenOverflowOf(box)).toBeLessThanOrEqual(1);
  expect(await heightOf(box)).toBeGreaterThan(restingHeight);
});

test('a very long paste stops growing at 40% of the viewport and scrolls inside the box', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const box = page.getByRole('combobox', { name: 'Capture box' });

  await box.fill(Array.from({ length: 200 }, (_, index) => `line ${String(index + 1)}`).join('\n'));

  // 40dvh of an 844px viewport is 337.6px; allow a pixel for rounding.
  await expect.poll(() => heightOf(box)).toBeLessThanOrEqual(844 * 0.4 + 1);
  expect(await hiddenOverflowOf(box)).toBeGreaterThan(0);
  // The landing screen still fits the phone: the capped box never pushes the page into a scroll.
  const pageOverflow = await page.evaluate(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    return doc.scrollHeight - doc.clientHeight;
  });
  expect(pageOverflow).toBeLessThanOrEqual(1);
});

test('the box settles back to its resting height once the capture is sent', async ({ page }) => {
  await page.goto('/');
  const box = page.getByRole('combobox', { name: 'Capture box' });
  const restingHeight = await heightOf(box);

  await box.fill(Array.from({ length: 8 }, (_, index) => `line ${String(index + 1)}`).join('\n'));
  await expect.poll(() => heightOf(box)).toBeGreaterThan(restingHeight);

  await box.press('Enter');

  await expect(box).toHaveValue('');
  await expect.poll(() => heightOf(box)).toBe(restingHeight);
});
