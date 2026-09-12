import { expect, test } from './support/fixtures';

/**
 * ALF-219 — the module switcher must fit the desktop sidebar.
 *
 * The sidebar is a fixed 224px (`md:w-56`) with a 1px right border and 16px of padding a side,
 * so the switcher has 191px to live in. The control has hugged its content since ALF-93, when Tasks ⇄ Code were the
 * only two segments; adding Comms pushed the natural width past 192px and the control spilled
 * over the sidebar's right border. It is now a full-width control of equal segments, so it fits
 * by construction — a fourth module would divide the same width rather than overflow it.
 *
 * Proven in a real browser because the bug IS layout: jsdom has no box model, so a class-level
 * unit test can say `w-full` is present but never that nothing overflows.
 */

/** The suite's default project (Desktop Chrome) — the width at which the overflow appeared. */
const VIEWPORT = { width: 1280, height: 720 };

test('the module switcher fits inside the desktop sidebar, in equal segments', async ({
  page,
  seed,
}) => {
  await seed({});
  await page.goto('/priority');

  const sidebar = page.locator('aside').first();
  const switcher = page.getByRole('group', { name: 'Switch module' });
  await expect(switcher).toBeVisible();

  const sidebarBox = await sidebar.boundingBox();
  const switcherBox = await switcher.boundingBox();

  // Sanity check that we're exercising the real constraint: the fixed-width desktop sidebar.
  expect(sidebarBox?.width).toBe(224);
  expect(VIEWPORT.width).toBeGreaterThan(768);

  // The whole control stays inside the sidebar's right edge — the overflow this ticket fixes.
  const sidebarRight = (sidebarBox?.x ?? 0) + (sidebarBox?.width ?? 0);
  const switcherRight = (switcherBox?.x ?? 0) + (switcherBox?.width ?? 0);
  expect(switcherRight).toBeLessThanOrEqual(sidebarRight);

  // …and it spans the padded sidebar width rather than hugging its content, so the segments
  // have room to divide evenly instead of competing for it. That width is 191, not 192: the
  // 224px sidebar spends 1px of it on its own right border before the 16px padding a side.
  expect(switcherBox?.width).toBe(191);

  // Nothing overflows *within* the control either — a segment wider than its share would make
  // the group scroll horizontally while its outer box still measured 192px.
  const overflow = await switcher.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // Equal thirds: every segment is the same width, whatever its label's length.
  const [tasksWidth, codeWidth, commsWidth] = await Promise.all(
    ['Tasks', 'Code', 'Comms'].map(async (label) => {
      const box = await page.getByRole('link', { name: label, exact: true }).boundingBox();
      return box?.width ?? 0;
    }),
  );
  expect(codeWidth).toBeCloseTo(tasksWidth ?? 0, 0);
  expect(commsWidth).toBeCloseTo(tasksWidth ?? 0, 0);

  // An equal third still has to hold its label. "Comms" is the longest and so the one that
  // would spill out of its segment if the type were sized for a roomier control.
  for (const label of ['Tasks', 'Code', 'Comms']) {
    const spill = await page
      .getByRole('link', { name: label, exact: true })
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(spill).toBeLessThanOrEqual(0);
  }
});
