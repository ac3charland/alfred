import { makeItem } from './support/constants';
import { expect, test } from './support/fixtures';
import { sampleDuring } from './support/probe';

/**
 * Regression guard for the inbox close-animation height rebound.
 *
 * The inbox list stays mounted while it collapses (animate-collapse-y) and unmounts
 * on `animationend` (see InboxScreen). Without `animation-fill-mode: forwards` on
 * the `collapse-y` token, the moment the collapse finished the element would snap
 * back to its full height (grid-template-rows: 1fr restored) for the single frame
 * before React removed it — a visible jump. We sample the reveal's bounding-box
 * height every animation frame across the whole close and assert it never rebounds:
 * once it has nearly collapsed (height < 5px) it must stay collapsed until unmount.
 */
test('closing the inbox collapses without a height rebound', async ({ page, seed }) => {
  await seed({ items: [makeItem('Existing thought')] });

  await page.goto('/?view=inbox');
  const reveal = page.getByTestId('inbox-reveal');
  await expect(reveal).toBeVisible();
  // Wait for the expand animation to fully settle before measuring the close.
  await page.waitForTimeout(400);

  // Sample bounding-box height every frame while the close runs.
  const frames = await sampleDuring(
    page,
    {
      selector: '[data-testid="inbox-reveal"]',
      read: { kind: 'rect', props: ['height'] },
      durationMs: 600,
    },
    () => page.getByRole('link', { name: 'Close inbox' }).click(),
  );

  const heights = frames.map((frame) =>
    frame.values === null ? null : Number(frame.values['height']),
  );

  // The collapse actually ran: height dropped to near zero.
  const measured = heights.filter((h): h is number => h !== null);
  expect(Math.min(...measured)).toBeLessThan(5);
  // And the element ultimately unmounted (null = GONE).
  expect(heights.at(-1)).toBeNull();

  // No rebound: after height first crosses below 5px it must never climb back up.
  const firstCollapsedIndex = measured.findIndex((h) => h < 5);
  const maxAfterCollapse = Math.max(...measured.slice(firstCollapsedIndex));
  expect(maxAfterCollapse).toBeLessThan(5);
});
