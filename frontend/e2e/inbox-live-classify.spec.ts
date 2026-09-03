import { makeFolder, makeItem } from './support/constants';
import { expect, test } from './support/fixtures';
import { installRealtimeStub, pushRowUpdate, waitForRealtimeJoin } from './support/realtime';

/**
 * ALF-196 — the Inbox updates itself as the classifier judges its rows.
 *
 * The sweep Worker writes a verdict onto an item minutes after it was captured, so it is the one
 * writer the owner did not press. These drive that write down a faked realtime socket (the mock
 * backend has no websocket — see `support/realtime.ts`) and assert the open Inbox takes it:
 * the labels appear, the provenance mark flips, and the row rings to say so.
 */

const HEALTH = makeFolder('Health', { id: '11111111-1111-4111-8111-111111111111' });
const CAPTURE = makeItem('Call the dentist', { id: '22222222-2222-4222-8222-222222222222' });

/** The same row as the sweep leaves it: a task, priority and folder filled in, stamped. */
const VERDICT = {
  ...CAPTURE,
  item_type: 'task',
  priority: 'high',
  folder_id: HEALTH.id,
  classified_at: '2026-09-03T09:00:00Z',
  classified_provider: 'anthropic',
  classified_model: 'claude-haiku-4-5',
  classified_prompt_version: 1,
  classified_guess: { item_type: 'task', priority: 'high' },
};

test('a verdict lands on an open Inbox row, labels and all', async ({ page, seed }) => {
  await seed({ folders: [HEALTH], items: [CAPTURE] });
  await installRealtimeStub(page);
  await page.goto('/?view=inbox');

  const row = page.getByRole('listitem').filter({ hasText: 'Call the dentist' });
  await expect(row.getByRole('img', { name: 'Not yet classified' })).toBeVisible();
  await expect(row.getByText('Health')).toBeHidden();

  await waitForRealtimeJoin(page, 'items');
  await pushRowUpdate(page, 'items', VERDICT);

  // The verdict's labels, with no reload: the row is a task now (badge, checkbox), it names the
  // folder it would land in, and the mark credits the classifier.
  await expect(row.getByRole('img', { name: 'Labelled by the classifier' })).toBeVisible();
  await expect(row.getByText('Task', { exact: true })).toBeVisible();
  await expect(row.getByText('Health')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Mark "Call the dentist" complete' })).toBeVisible();
  // A label is not a move — the row is still in the Inbox, waiting to be dispatched.
  await expect(
    page.getByRole('list', { name: 'Tasks' }).getByText('Call the dentist'),
  ).toBeVisible();
});

test('the row rings as the verdict arrives, then lets the ring go', async ({ page, seed }) => {
  await seed({ folders: [HEALTH], items: [CAPTURE] });
  await installRealtimeStub(page);
  await page.goto('/?view=inbox');

  const body = page
    .getByRole('listitem')
    .filter({ hasText: 'Call the dentist' })
    .getByTestId('task-row-body');
  const ringed = async () =>
    body.evaluate((element) => getComputedStyle(element).boxShadow !== 'none');

  await waitForRealtimeJoin(page, 'items');
  expect(await ringed()).toBe(false);

  await pushRowUpdate(page, 'items', VERDICT);
  await expect(async () => {
    expect(await ringed()).toBe(true);
  }).toPass();

  // …and it is temporary: the row settles back to no ring on its own.
  await expect(async () => {
    expect(await ringed()).toBe(false);
  }).toPass({ timeout: 5000 });
});
