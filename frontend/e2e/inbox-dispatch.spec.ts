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
