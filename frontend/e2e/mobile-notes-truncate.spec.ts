import { makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The one-line notes/description preview beneath a task title must clip to a single line with
 * an ellipsis on a phone-width card (ALF-99). The mobile card layout (`md:`-gated) wraps every
 * row in a `display:grid` collapse track; a grid item's automatic minimum size is `min-content`,
 * so before the fix a long `nowrap` preview forced the card wider than the viewport and
 * `truncate` had nothing to clip — the note spilled instead of ellipsizing. The fix keeps the
 * grid item shrinkable (`min-w-0`), so the preview stays bounded and truncates.
 */
test.use({ viewport: { width: 390, height: 844 } });

const LONG_NOTES =
  'Call the three centres near the office and compare their waitlists, hours, and monthly rates before the tour on Thursday afternoon.';

test('the notes preview truncates to one line instead of spilling the mobile card', async ({
  page,
  seed,
}) => {
  await seed({ items: [makeItem('Research daycare options', { notes: LONG_NOTES })] });
  await page.goto('/?view=inbox');

  const preview = page.getByTestId('task-notes-preview');
  await expect(preview).toBeVisible();

  const metrics = await preview.evaluate((element) => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    height: Math.round(element.getBoundingClientRect().height),
  }));

  // Truncation clips the text: the content is wider than the box it's shown in.
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
  // The clipped box itself never exceeds the 390px viewport (the card didn't blow out).
  expect(metrics.clientWidth).toBeLessThanOrEqual(390);
  // A single ~one-line-tall preview, not a multi-line wrap of the whole note.
  expect(metrics.height).toBeLessThan(24);

  // And the page as a whole never gains a horizontal scrollbar from the overflow.
  const overflowsHorizontally = await page.evaluate(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 1;
  });
  expect(overflowsHorizontally).toBe(false);
});
