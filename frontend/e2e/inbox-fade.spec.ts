import { makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Regression guard for the inbox close-animation "flash" stutter.
 *
 * The inbox list stays mounted while it fades out and unmounts on `animationend`
 * (see InboxScreen). Without `animation-fill-mode: forwards` on the `fade-out`
 * token, the moment the fade finished the element snapped back to its base
 * opacity (1) for the single frame before React removed it — a visible flash.
 *
 * This test samples the reveal's computed opacity across the whole close and
 * asserts it never rebounds: once it has nearly faded (opacity < 0.2) it must
 * stay faded until it unmounts. With the bug a sample reads ~1 after the drop.
 */
test('closing the inbox fades out without a flash rebound', async ({ page, seed }) => {
  await seed({ items: [makeItem('Existing thought')] });

  await page.goto('/?view=inbox');
  const reveal = page.getByTestId('inbox-reveal');
  await expect(reveal).toBeVisible();
  // Let the fade-in fully settle so we only measure the close.
  await page.waitForTimeout(400);

  // Sample opacity every animation frame for the duration of the close.
  await page.evaluate(() => {
    const w = globalThis as unknown as { __samples: (number | null)[] };
    w.__samples = [];
    const start = performance.now();
    const tick = () => {
      const node = document.querySelector('[data-testid="inbox-reveal"]');
      w.__samples.push(node ? Number.parseFloat(getComputedStyle(node).opacity) : null);
      if (performance.now() - start < 500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.getByRole('link', { name: 'Close inbox' }).click();
  await page.waitForTimeout(550);

  const samples = await page.evaluate(
    () => (globalThis as unknown as { __samples: (number | null)[] }).__samples,
  );

  // The fade actually ran: opacity dropped to near zero at some point.
  const faded = samples.filter((o): o is number => o !== null);
  expect(Math.min(...faded)).toBeLessThan(0.2);
  // And the element ultimately unmounted (null = GONE).
  expect(samples.at(-1)).toBeNull();

  // No rebound: after opacity first crosses below 0.2 it must never climb back up.
  const firstFadedIndex = faded.findIndex((o) => o < 0.2);
  const maxAfterFade = Math.max(...faded.slice(firstFadedIndex));
  expect(maxAfterFade).toBeLessThan(0.2);
});
