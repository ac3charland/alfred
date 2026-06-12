import { makeItem } from './support/constants';
import { expect, test } from './support/fixtures';
import { sampleDuring } from './support/probe';

/**
 * Regression guard for the inbox close-animation "flash" stutter.
 *
 * The inbox list stays mounted while it fades out and unmounts on `animationend`
 * (see InboxScreen). Without `animation-fill-mode: forwards` on the `fade-out`
 * token, the moment the fade finished the element snapped back to its base
 * opacity (1) for the single frame before React removed it — a visible flash.
 *
 * We sample the reveal's computed opacity every animation frame across the whole
 * close (the debug-animations helper) and assert it never rebounds: once it has
 * nearly faded (opacity < 0.2) it must stay faded until it unmounts. With the bug
 * a sample reads ~1 after the drop. See the `debug-animations` skill.
 */
test('closing the inbox fades out without a flash rebound', async ({ page, seed }) => {
  await seed({ items: [makeItem('Existing thought')] });

  await page.goto('/?view=inbox');
  const reveal = page.getByTestId('inbox-reveal');
  await expect(reveal).toBeVisible();
  // Let the fade-in fully settle (opacity reaches 1) so we only measure the close.
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-testid="inbox-reveal"]');
    return element !== null && getComputedStyle(element).opacity === '1';
  });

  // Sample computed opacity every frame while the close runs.
  const frames = await sampleDuring(
    page,
    {
      selector: '[data-testid="inbox-reveal"]',
      read: { kind: 'style', props: ['opacity'] },
      durationMs: 600,
    },
    () => page.getByRole('link', { name: 'Close inbox' }).click(),
  );

  const opacities = frames.map((frame) =>
    frame.values === null ? null : Number(frame.values['opacity']),
  );

  // The fade actually ran: opacity dropped to near zero at some point.
  const faded = opacities.filter((opacity): opacity is number => opacity !== null);
  expect(Math.min(...faded)).toBeLessThan(0.2);
  // And the element ultimately unmounted (null = GONE).
  expect(opacities.at(-1)).toBeNull();

  // No rebound: after opacity first crosses below 0.2 it must never climb back up.
  const firstFadedIndex = faded.findIndex((opacity) => opacity < 0.2);
  const maxAfterFade = Math.max(...faded.slice(firstFadedIndex));
  expect(maxAfterFade).toBeLessThan(0.2);
});
