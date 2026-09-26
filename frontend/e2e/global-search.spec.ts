import {
  makeCodeStory,
  makeEpic,
  makeFolder,
  makeItem,
  makeProject,
  wikiFixtureSet,
} from './support/constants';
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
const DONE_STORY_ITEM_ID = '55555555-5555-4555-8555-555555555555';

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
  const search = page.getByRole('combobox', { name: /search tasks, stories, and wiki pages/i });
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

test('hides completed tasks and terminal stories by default, revealed by "Show completed"', async ({
  page,
  seed,
}) => {
  const folder = makeFolder('Software');
  const active = makeItem('Firewall active task', { item_type: 'task', folder_id: folder.id });
  const done = makeItem('Firewall done task', {
    item_type: 'task',
    folder_id: folder.id,
    status: 'completed',
  });

  const project = makeProject('Alfred', { id: PROJECT_ID, key: 'ALF' });
  const epic = makeEpic('Communication Firewall', {
    id: EPIC_ID,
    project_id: PROJECT_ID,
    ref_number: 1,
    ref: 'ALF-1',
  });
  const doneStoryItem = makeItem('Firewall done story', {
    id: DONE_STORY_ITEM_ID,
    item_type: 'code',
  });
  const doneStory = makeCodeStory({
    item_id: DONE_STORY_ITEM_ID,
    project_id: PROJECT_ID,
    epic_id: EPIC_ID,
    ref_number: 99,
    ref: 'ALF-99',
    factory_state: 'done',
  });

  await seed({
    folders: [folder],
    items: [active, done, doneStoryItem],
    projects: [project],
    epics: [epic],
    codeItems: [doneStory],
  });
  await page.goto('/');

  await page.keyboard.press('ControlOrMeta+KeyP');
  await page.keyboard.type('firewall');

  const listbox = page.getByRole('listbox');
  await expect(listbox.getByText('Firewall active task')).toBeVisible();
  await expect(listbox.getByText('Firewall done task')).toBeHidden();
  await expect(listbox.getByText('Firewall done story')).toBeHidden();

  // Even with completed matches hidden, the checkbox itself stays offered so a search that
  // ONLY matches something done isn't a silent dead end.
  await page.getByRole('checkbox', { name: 'Show completed' }).click();

  await expect(listbox.getByText('Firewall done task')).toBeVisible();
  await expect(listbox.getByText('Firewall done story')).toBeVisible();
});

test('shows a Wiki group; ArrowDown to a page and Enter opens it', async ({ page, seed }) => {
  const { pages } = wikiFixtureSet();

  await seed({ wikiPages: pages });
  await page.goto('/');

  await page.keyboard.press('ControlOrMeta+KeyP');
  await page.keyboard.type('habit');

  // A row's accessible name concatenates its title, subtitle and the "Wiki" badge text, and
  // "Atomic Habits" appears in more than one row's subtitle — so target each row by the same
  // stable `optionDomId` the component itself keys rows by (percent-encoded path), not by name.
  const listbox = page.getByRole('listbox');
  const habitStackingId = `search-option-wiki-${encodeURIComponent('wiki/concepts/habit-stacking.md')}`;
  const atomicHabitsId = `search-option-wiki-${encodeURIComponent('wiki/sources/atomic-habits.md')}`;
  const habitStackingRow = listbox.locator(`[id="${habitStackingId}"]`);
  await expect(habitStackingRow).toBeVisible();
  await expect(habitStackingRow.getByText('Habit stacking', { exact: true })).toBeVisible();
  await expect(habitStackingRow.getByText('Wiki', { exact: true })).toBeVisible();
  await expect(listbox.locator(`[id="${atomicHabitsId}"]`)).toBeVisible();

  // `useWikiPages` sorts by section then lower-cased title, so within Concepts "Habit loop"
  // sorts ahead of "Habit stacking" — both rank 0 for "habit" with the same `updated` date, so
  // that alphabetical order is exactly the (stable) tie-break order the results land in. The
  // dropdown opens with the first wiki match already active, so one ArrowDown reaches the second.
  const search = page.getByRole('combobox', { name: /search tasks, stories, and wiki pages/i });
  await page.keyboard.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', habitStackingId);

  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/wiki\/concepts\/habit-stacking$/);
  // The reading room's own body is covered by the wiki reading-room e2e; here we only confirm
  // the Wiki module actually rendered at this URL — its nav landmark and switcher segment.
  await expect(page.getByRole('navigation', { name: 'Wiki' })).toBeVisible();
  const switcher = page.getByRole('group', { name: 'Switch module' });
  await expect(switcher.getByRole('link', { name: 'Wiki' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});
