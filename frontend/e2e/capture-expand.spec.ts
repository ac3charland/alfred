import { makeItem } from './support/constants';
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

/** How far the page itself is scrolled, in px. */
async function pageScrollTop(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => (document.scrollingElement ?? document.documentElement).scrollTop);
}

test('re-fitting a tall draft never yanks a scrolled page back up', async ({ page, seed }) => {
  // A phone with a few tasks: the capped box plus the list is just taller than the screen, so the
  // page scrolls. Re-fitting measures the box from a collapsed height; if that collapse shortens
  // the document, the browser clamps the scroll position and the page jumps.
  await page.setViewportSize({ width: 390, height: 844 });
  await seed({ items: Array.from({ length: 8 }, (_, i) => makeItem(`Task ${String(i + 1)}`)) });
  await page.goto('/?view=inbox');
  const box = page.getByRole('combobox', { name: 'Capture box' });
  await box.fill(Array.from({ length: 30 }, (_, index) => `line ${String(index + 1)}`).join('\n'));
  const parked = await page.evaluate(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    doc.scrollTop = doc.scrollHeight;
    return doc.scrollTop;
  });
  expect(parked).toBeGreaterThan(0);

  // A resize re-fits without touching the text, so nothing but the re-fit can move the page.
  await page.evaluate(() => globalThis.dispatchEvent(new Event('resize')));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

  expect(Math.abs((await pageScrollTop(page)) - parked)).toBeLessThanOrEqual(1);
});

test('typing into a tall draft never yanks a scrolled page back up', async ({ page, seed }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed({ items: Array.from({ length: 8 }, (_, i) => makeItem(`Task ${String(i + 1)}`)) });
  await page.goto('/?view=inbox');
  const box = page.getByRole('combobox', { name: 'Capture box' });
  await box.fill(Array.from({ length: 30 }, (_, index) => `line ${String(index + 1)}`).join('\n'));
  const parked = await page.evaluate(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    doc.scrollTop = doc.scrollHeight;
    return doc.scrollTop;
  });
  expect(parked).toBeGreaterThan(0);

  await box.press('x');

  expect(Math.abs((await pageScrollTop(page)) - parked)).toBeLessThanOrEqual(1);
});

test('a multi-line capture sends off from where its text was, not from a re-centred box', async ({
  page,
}) => {
  // On the landing screen the box is centred, so shrinking it back to its resting height moves
  // its top edge. The ghost is anchored to the box, so it must launch before that shift.
  await page.goto('/');
  const box = page.getByRole('combobox', { name: 'Capture box' });
  await box.fill(Array.from({ length: 8 }, (_, index) => `line ${String(index + 1)}`).join('\n'));
  await expect.poll(() => heightOf(box)).toBeGreaterThan(200);
  const tallBox = await box.boundingBox();
  const firstLineTop = (tallBox?.y ?? 0) + 16; // the textarea's pt-4
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      const ghost = document.querySelector('[data-testid="capture-ghost"]');
      if (ghost === null) return;
      Reflect.set(globalThis, '__ghostTop', ghost.getBoundingClientRect().top);
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });

  await box.press('Enter');

  await expect
    .poll(() => page.evaluate(() => Reflect.get(globalThis, '__ghostTop') as number | undefined))
    .toBeDefined();
  const ghostTop = await page.evaluate(() => Reflect.get(globalThis, '__ghostTop') as number);
  expect(Math.abs(ghostTop - firstLineTop)).toBeLessThanOrEqual(2);
});

test('narrowing the window under a draft re-wraps it and the box grows to match', async ({
  page,
}) => {
  await page.goto('/');
  const box = page.getByRole('combobox', { name: 'Capture box' });
  await box.fill('a wrapping thought '.repeat(16));
  await expect.poll(() => hiddenOverflowOf(box)).toBeLessThanOrEqual(1);
  const wideHeight = await heightOf(box);

  await page.setViewportSize({ width: 420, height: 720 });

  await expect.poll(() => hiddenOverflowOf(box)).toBeLessThanOrEqual(1);
  expect(await heightOf(box)).toBeGreaterThan(wideHeight);
});
