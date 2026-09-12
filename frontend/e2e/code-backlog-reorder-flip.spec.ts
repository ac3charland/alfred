import { makeCodeStory, makeEpic, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';
import { sampleDuring } from './support/probe';

/**
 * Guard against FLIP reorder jank (the `useFlipList` hook). The chevron swap re-sorts the rows,
 * which `useFlipList` animates by transforming each moved row from its old slot to its new one.
 * The regression this pins: the optimistic swap's server **reconcile** re-rendered with the same
 * order and re-ran the layout effect, interrupting the in-flight transition — the moved row sat
 * at its old slot, then **jumped** ~3/4 of the way in a single frame before easing the rest. The
 * fix bails the effect out on a same-order render and measures "Last" cleanly.
 *
 * We sample the moved row's `top` once per frame across the swap and assert the motion is smooth:
 * the row relocates, and no single frame covers more than 40% of the journey (a snap/jump would).
 * jsdom has no layout, so this can only be caught in a real browser — see the debug-animations
 * skill.
 */

const project = makeProject('Alfred', { id: 'p1', key: 'ALF' });
const epic = makeEpic('Firewall', { id: 'e1', project_id: 'p1', ref_number: 1, ref: 'ALF-1' });
const items = [
  makeItem('a', { id: 'i1', item_type: 'code' }),
  makeItem('b', { id: 'i2', item_type: 'code' }),
  makeItem('c', { id: 'i3', item_type: 'code' }),
];
const codeItems = [
  makeCodeStory({
    item_id: 'i1',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 3,
    ref: 'ALF-3',
    priority: 1,
  }),
  makeCodeStory({
    item_id: 'i2',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 4,
    ref: 'ALF-4',
    priority: 2,
  }),
  makeCodeStory({
    item_id: 'i3',
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: 5,
    ref: 'ALF-5',
    priority: 3,
  }),
];

/** The `top` series for frames where the row was present, in order. */
function topsOf(frames: Awaited<ReturnType<typeof sampleDuring>>): number[] {
  return frames
    .map((frame) => frame.values?.['top'])
    .filter((top): top is number => typeof top === 'number');
}

/** The largest single-frame change — a smooth ease keeps this small; a snap/jump spikes it. */
function maxStep(series: number[]): number {
  let max = 0;
  let previous: number | undefined;
  for (const value of series) {
    if (previous !== undefined) max = Math.max(max, Math.abs(value - previous));
    previous = value;
  }
  return max;
}

/** Sample the moved row across one chevron swap and assert the glide is smooth. */
async function expectSmoothSwap(page: Parameters<typeof sampleDuring>[0]): Promise<void> {
  const frames = await sampleDuring(
    page,
    {
      selector: 'li:has(a[aria-label^="Open ALF-4"])',
      read: { kind: 'rect', props: ['top'] },
      durationMs: 450,
    },
    () => page.getByRole('button', { name: 'Move ALF-4 up' }).click(),
  );

  // Scoped to story rows, so nothing else that happens to be a list can match first.
  await expect(page.locator('li:has(a[aria-label^="Open "])').nth(0)).toContainText('ALF-4');

  const tops = topsOf(frames);
  const first = tops.at(0);
  const last = tops.at(-1);
  expect(first).toBeDefined();
  expect(last).toBeDefined();
  if (first === undefined || last === undefined) return;

  const distance = Math.abs(last - first);
  // The row actually relocated (it moved up a full slot, not a no-op).
  expect(distance).toBeGreaterThan(20);
  // Smooth: no single frame jumps more than 40% of the journey. The pre-fix reconcile interrupt
  // jumped ~70%+ in one frame; the eased motion stays well under (~15%).
  expect(maxStep(tops)).toBeLessThan(distance * 0.4);
}

test('reordering a story animates smoothly with no mid-flight jump', async ({ page, seed }) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await page.goto('/code/backlog');
  await expect(page.getByRole('listitem').nth(1)).toContainText('ALF-4');

  await expectSmoothSwap(page);
});

/**
 * The second staleness trap: the FLIP baseline is captured on the previous reorder, so anything
 * that moves the whole list between then and the next swap must not leak into the delta. With a
 * viewport-relative baseline the row leapt the shift's full height before easing; measuring in
 * list-local coordinates makes it cancel out.
 *
 * The shift is injected straight into the DOM rather than driven by whatever card happens to
 * sit above the list today — the property under test belongs to `useFlipList`, and pinning it to
 * one neighbouring component is what made this case break when the ratio card moved to the
 * Dashboard. `useFlipList` measures real rects, so a plain spacer reproduces the trap exactly.
 */
test('a layout shift above the list does not make the next reorder jump', async ({
  page,
  seed,
}) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  await page.goto('/code/backlog');
  await expect(page.getByRole('listitem').nth(1)).toContainText('ALF-4');

  // Land the shift AFTER the list's first layout pass, pushing every row down at once.
  const listTop = await page.evaluate(() => {
    const list = document.querySelector('ul');
    const parent = list?.parentElement;
    if (!list || !parent) return 0;
    const spacer = document.createElement('div');
    spacer.style.height = '120px';
    list.before(spacer);
    return list.getBoundingClientRect().top;
  });
  expect(listTop).toBeGreaterThan(120);

  await expectSmoothSwap(page);
});
