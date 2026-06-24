import { makeCodeStory, makeEpic, makeFolder, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * ALF-2 — the top-bar global search.
 *
 * ⌘P (here Ctrl/Cmd P) focuses the header field and opens its results dropdown; typing filters
 * across both modules at once. Selecting a task jumps to its view; selecting a story opens the
 * board with that story's detail modal (`?story=<ref>`).
 *
 * `v_code_stories` only surfaces a story when its backing `items` row is ALSO seeded (the
 * view's inner join), so each code story is seeded as an item + a code_items sidecar with real
 * UUID ids (the code APIs validate strict UUIDs).
 */

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const EPIC_ID = '22222222-2222-4222-8222-222222222222';
const STORY_ITEM_ID = '44444444-4444-4444-8444-444444444444';

test('⌘P focuses the field; selecting a task jumps to its folder view', async ({ page, seed }) => {
  const folder = makeFolder('Software');
  const task = makeItem('Firewall triage workflow', {
    item_type: 'task',
    folder_id: folder.id,
  });

  await seed({ folders: [folder], items: [task] });
  await page.goto('/');

  // The shortcut claims ⌘P from the browser and focuses the top-bar field.
  await page.keyboard.press('ControlOrMeta+KeyP');
  const search = page.getByRole('combobox', { name: /search tasks and stories/i });
  await expect(search).toBeFocused();

  // Typing filters in real time; the match shows under the Tasks group.
  await page.keyboard.type('firewall');
  const listbox = page.getByRole('listbox');
  await expect(listbox.getByText('Firewall triage workflow')).toBeVisible();

  // Selecting it routes to the containing folder view, with the row present.
  await listbox.getByText('Firewall triage workflow').click();
  await expect(page).toHaveURL(new RegExp(`/folders/${folder.id}`));
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(
    page.getByRole('list', { name: 'Tasks' }).getByText('Firewall triage workflow'),
  ).toBeVisible();
});

test('selecting a story opens the board with its detail modal', async ({ page, seed }) => {
  const project = makeProject('Alfred', { id: PROJECT_ID, key: 'ALF' });
  const epic = makeEpic('Communication Firewall', {
    id: EPIC_ID,
    project_id: PROJECT_ID,
    ref_number: 1,
    ref: 'ALF-1',
  });
  const item = makeItem('Message triage queue', { id: STORY_ITEM_ID, item_type: 'code' });
  const story = makeCodeStory({
    item_id: STORY_ITEM_ID,
    project_id: PROJECT_ID,
    epic_id: EPIC_ID,
    ref_number: 31,
    ref: 'ALF-31',
    factory_state: 'ready_for_dev',
  });

  await seed({ projects: [project], epics: [epic], items: [item], codeItems: [story] });
  await page.goto('/');

  await page.keyboard.press('ControlOrMeta+KeyP');
  await page.keyboard.type('message triage');

  const listbox = page.getByRole('listbox');
  await expect(listbox.getByText('Message triage queue')).toBeVisible();
  await listbox.getByText('Message triage queue').click();

  // The board opens at the story's project with the deep-link param, modal showing.
  await expect(page).toHaveURL(new RegExp(String.raw`/code/${PROJECT_ID}\?story=ALF-31`));
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('ALF-31')).toBeVisible();
  await expect(dialog.getByText('Message triage queue')).toBeVisible();
});
