import { makeCodeStory, makeEpic, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * ALF-250: a run of single-chevron nudges must land on the server in the order it was clicked.
 * Each swap trades ranks with a NAMED neighbour, so a slow request overtaken by a later one used
 * to leave the server with a different ranking than the screen showed — a story nudged down twice
 * reloaded ABOVE where it had been displayed.
 */

const project = makeProject('Alfred', { id: 'p1', key: 'ALF' });
const epic = makeEpic('Communication Firewall', {
  id: 'e1',
  project_id: 'p1',
  ref_number: 1,
  ref: 'ALF-1',
});
const items = [
  makeItem('Draft the inbound filter spec', { id: 'i1', item_type: 'code' }),
  makeItem('Refine the routing rules', { id: 'i2', item_type: 'code' }),
  makeItem('Implement the allow-list parser', { id: 'i3', item_type: 'code' }),
];
const codeItems = [1, 2, 3].map((n) =>
  makeCodeStory({
    item_id: `i${String(n)}`,
    project_id: 'p1',
    epic_id: 'e1',
    ref_number: n + 2,
    ref: `ALF-${String(n + 2)}`,
    priority: n,
  }),
);

test('two nudges down reach the server in click order even when the first request is slow', async ({
  page,
  seed,
}) => {
  await seed({ projects: [project], epics: [epic], items, codeItems });
  // Hold the FIRST swap request 2 s and any later one barely at all: were both on the wire at
  // once, the second would reach the server first.
  let requests = 0;
  let synced = 0;
  await page.route('**/api/code/reorder', async (route) => {
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, requests === 1 ? 2000 : 50));
    await route.continue();
    synced += 1;
  });
  await page.goto('/code/backlog');
  const rows = page.getByRole('listitem');
  await expect(rows).toHaveCount(3);

  const down = page.getByRole('button', { name: 'Move ALF-3 down' });
  await down.click();
  // Past the sync debounce, so the second nudge is a separate burst while the first is in flight.
  await expect.poll(() => requests).toBe(1);
  await down.click();
  await expect(rows.nth(2)).toContainText('ALF-3');

  await expect.poll(() => synced, { timeout: 10_000 }).toBe(2);
  await page.reload();
  await expect(rows.nth(0)).toContainText('ALF-4');
  await expect(rows.nth(1)).toContainText('ALF-5');
  await expect(rows.nth(2)).toContainText('ALF-3');
});
