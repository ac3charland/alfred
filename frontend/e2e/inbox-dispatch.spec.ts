import { makeFolder, makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Inbox residency: an item is in the Inbox until a human dispatches it, whatever `folder_id`
 * holds. Filing an item is what dispatches it, so every route through the app agrees today —
 * these tests seed the one state the UI can't yet produce (a folder already filled in on an item
 * nobody has triaged) and prove the app treats it as an Inbox item everywhere it looks.
 */

const HEALTH = makeFolder('Health', { id: '11111111-1111-4111-8111-111111111111' });

test('an undispatched item sits in the Inbox even though it carries a folder', async ({
  page,
  seed,
}) => {
  await seed({
    folders: [HEALTH],
    items: [
      makeItem('Call the dentist', {
        id: '22222222-2222-4222-8222-222222222222',
        item_type: 'task',
        folder_id: HEALTH.id,
        dispatched_at: null,
      }),
      makeItem('Book the check-up', {
        id: '33333333-3333-4333-8333-333333333333',
        item_type: 'task',
        folder_id: HEALTH.id,
      }),
    ],
  });

  await page.goto('/?view=inbox');
  const inbox = page.getByRole('list', { name: 'Tasks' });
  await expect(inbox.getByText('Call the dentist')).toBeVisible();
  await expect(inbox.getByText('Book the check-up')).toBeHidden();

  await page.getByRole('link', { name: 'Health' }).click();
  const folder = page.getByRole('list', { name: 'Tasks' });
  await expect(folder.getByText('Book the check-up')).toBeVisible();
  await expect(folder.getByText('Call the dentist')).toBeHidden();
});

test('an undispatched item does not reach the folder badge it points at', async ({
  page,
  seed,
}) => {
  // Both rows are overdue and both name the same folder; only the dispatched one is actually
  // in it, so the red tally reads 1 rather than 2.
  await seed({
    folders: [HEALTH],
    items: [
      makeItem('Overdue but untriaged', {
        id: '44444444-4444-4444-8444-444444444444',
        item_type: 'task',
        folder_id: HEALTH.id,
        dispatched_at: null,
        due_date: '2020-01-01',
      }),
      makeItem('Overdue and filed', {
        id: '55555555-5555-4555-8555-555555555555',
        item_type: 'task',
        folder_id: HEALTH.id,
        due_date: '2020-01-01',
      }),
    ],
  });

  await page.goto('/');

  const nav = page.getByRole('navigation', { name: 'Navigation' });
  await expect(nav.getByLabel('1 overdue')).toBeVisible();
  await expect(nav.getByLabel('2 overdue')).toBeHidden();
});

// ---------------------------------------------------------------------------
// ALF-170 — Dispatch: one press sends each ready item to its own destination.
// ---------------------------------------------------------------------------

const PROJECT_ID = '66666666-6666-4666-8666-666666666666';
const EPIC_ID = '77777777-7777-4777-8777-777777777777';
const ALFRED_PROJECT = {
  id: PROJECT_ID,
  name: 'Alfred',
  key: 'ALF',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  github_url: null,
  ref_seq: 104,
  created_at: new Date(Date.UTC(2024, 0, 1)).toISOString(),
};
const TRIAGE_EPIC = {
  id: EPIC_ID,
  project_id: PROJECT_ID,
  name: 'Inbox triage',
  notes: null,
  ref_number: 104,
  ref: 'ALF-104',
  archived_at: null,
  spec_path: null,
  spec_sha: null,
  spec_markdown: null,
  refinement_pr_url: null,
  created_at: new Date(Date.UTC(2024, 0, 2)).toISOString(),
};

test('Dispatch sends a mixed selection each to its own destination, leaving the unready row', async ({
  page,
  seed,
}) => {
  await seed({
    folders: [HEALTH],
    projects: [ALFRED_PROJECT],
    epics: [TRIAGE_EPIC],
    items: [
      makeItem('Call the dentist', {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        item_type: 'task',
        folder_id: HEALTH.id,
        dispatched_at: null,
      }),
      makeItem('Snooze an item until next week', {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        item_type: 'code',
        intended_project_id: PROJECT_ID,
        intended_epic_id: EPIC_ID,
      }),
      makeItem('That thing Mark mentioned', {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        item_type: 'unclassified',
      }),
    ],
  });

  await page.goto('/?view=inbox');
  await page.getByRole('button', { name: 'Select' }).click();
  await page.getByRole('button', { name: 'Select "Call the dentist"' }).click();
  await page.getByRole('button', { name: 'Select "Snooze an item until next week"' }).click();
  await page.getByRole('button', { name: 'Select "That thing Mark mentioned"' }).click();

  // The bar names the unready row's blocker BEFORE the press…
  await expect(page.getByText('1 not ready — 1 needs a type')).toBeVisible();
  await page.getByRole('button', { name: 'Dispatch' }).click();

  // …the toast counts what went…
  await expect(page.getByText('Dispatched 2 items')).toBeVisible();
  // …the dispatched rows leave the Inbox, the unready one stays selected with the line intact.
  await expect(
    page.getByRole('button', { name: 'Deselect "That thing Mark mentioned"' }),
  ).toBeVisible();
  await expect(page.getByText('Call the dentist')).toBeHidden();
  await expect(page.getByText('Snooze an item until next week')).toBeHidden();
  await expect(page.getByText('1 not ready — 1 needs a type')).toBeVisible();

  // The task landed in its folder…
  await page.getByRole('link', { name: 'Health' }).click();
  await expect(
    page.getByRole('list', { name: 'Tasks' }).getByText('Call the dentist'),
  ).toBeVisible();

  // …and the code item is on its project's board, no dialog having opened.
  await page.goto(`/code/${PROJECT_ID}`);
  await expect(page.getByText('Snooze an item until next week')).toBeVisible();
});

test('setting a folder from the detail panel labels the row without moving it', async ({
  page,
  seed,
}) => {
  await seed({
    folders: [HEALTH],
    items: [
      makeItem('Call the dentist', {
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        item_type: 'task',
      }),
    ],
  });

  await page.goto('/?view=inbox');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Open details' }).click();
  await page.getByRole('button', { name: 'Folder', exact: true }).click();
  // Scoped to the picker popover — the sidebar carries its own "Health" controls.
  await page.getByRole('dialog').getByRole('button', { name: 'Health' }).click();

  // The row stays exactly where it is, now labelled: still in the Inbox, wearing the chip.
  const inbox = page.getByRole('list', { name: 'Tasks' });
  await expect(inbox.getByText('Call the dentist')).toBeVisible();
  await expect(inbox.getByRole('button', { name: 'Folder: Health' })).toBeVisible();

  // The folder itself is still empty — the label is where it WOULD land, not where it lives.
  await page.getByRole('link', { name: 'Health' }).click();
  await expect(page.getByText('No tasks in Health')).toBeVisible();
});
