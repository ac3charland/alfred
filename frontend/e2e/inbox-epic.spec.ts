/**
 * Epic construction in the inbox — end-to-end coverage for the epic conversion.
 *
 * The full arc: capture a code item with a `<project>:` prefix (so it carries an intended
 * project), build it out with three stories via the "Add story" affordance, reorder them with
 * the deterministic Move up / Move down menu actions, then "Dispatch" — which
 * converts immediately (no dialog, the project is known) into a new epic whose stories rank at
 * the top of the project's Backlog in display order. The mock implements convert_to_code_epic
 * faithfully (the bottom-up top_of_project_priority walk), so this is a genuine integration
 * run against the real route handler, stores, and menus.
 */
import { makeCodeStory, makeEpic, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

test('capture with a project prefix → add stories → reorder → send → epic + ordered stories', async ({
  page,
  seed,
}) => {
  // A pre-existing epic + story so the Backlog-order assertion proves the new group lands
  // ABOVE the project's existing work rather than into an empty list.
  const epicId = '22222222-2222-4222-8222-222222222222';
  const existing = makeItem('Existing story', { id: '33333333-3333-4333-8333-333333333333' });
  await seed({
    items: [existing],
    projects: [makeProject('Alfred', { id: PROJECT_ID, key: 'ALF', ref_seq: 2 })],
    epics: [makeEpic('Existing epic', { id: epicId, project_id: PROJECT_ID, ref_number: 1 })],
    codeItems: [
      makeCodeStory({
        item_id: existing.id,
        project_id: PROJECT_ID,
        epic_id: epicId,
        ref_number: 2,
        ref: 'ALF-2',
        priority: 5,
      }),
    ],
  });
  await page.goto('/?view=inbox');

  // 1. Capture with the project prefix → a code row carrying the assigned-project chip.
  const captureBox = page.getByRole('combobox', { name: 'Capture box' });
  await captureBox.fill('Alfred: Construction inbox');
  await captureBox.press('Enter');
  const parentRow = page.getByRole('listitem').filter({ hasText: 'Construction inbox' }).first();
  await expect(parentRow.getByText('Code', { exact: true })).toBeVisible();
  await expect(parentRow.getByText('ALF', { exact: true })).toBeVisible();

  // 2. Build the epic: three stories through the "Add story" affordance (its capture box
  //    stays open between captures, so the whole list goes in one sitting).
  await page.getByRole('button', { name: 'Add story' }).click();
  const storyBox = page.getByPlaceholder('Add story…');
  for (const title of ['First story', 'Second story', 'Third story']) {
    await storyBox.fill(title);
    await storyBox.press('Enter');
    await expect(
      page.getByRole('list', { name: 'Subtasks' }).getByText(title, { exact: true }),
    ).toBeVisible();
  }
  await storyBox.press('Escape');

  const subtaskRows = page.getByRole('list', { name: 'Subtasks' }).getByRole('listitem');
  await expect(subtaskRows).toHaveText([/First story/, /Second story/, /Third story/]);

  // 3. Reorder: move the last story up one slot (the deterministic menu path — ALF-117).
  await subtaskRows
    .filter({ hasText: 'Third story' })
    .getByRole('button', { name: 'More actions' })
    .click();
  await page.getByRole('menuitem', { name: 'Move up' }).click();
  await expect(subtaskRows).toHaveText([/First story/, /Third story/, /Second story/]);

  // 4. Dispatch: the intended project is set, so the conversion fires straight from the menu
  //    (the label carries no "…" — no dialog opens).
  await parentRow.getByRole('button', { name: 'More actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Dispatch', exact: true }).click();

  // 5. The toast announces the epic (ALF-3 — the shared counter's next value) + story count,
  //    and the whole group has left the inbox.
  await expect(page.getByText(/created alf-3 · 3 stories/i)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Construction inbox' })).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: 'First story' })).toHaveCount(0);

  // 6. On the project board: the new epic with its three stories in Needs Refinement, in
  //    display order (the lane is priority-sorted; first story ranks highest).
  await page.getByRole('link', { name: 'Code' }).click();
  await page
    .getByRole('navigation', { name: 'Projects' })
    .getByRole('link', { name: /alfred/i })
    .click();
  await expect(page.getByRole('button', { name: /^construction inbox/i })).toBeVisible();
  // Epics rank by their best story's priority, so the new epic (holding the project's top
  // stories) is the FIRST epic on the board — its lane is the first "Needs Refinement" region.
  const needsRefinement = page.getByRole('region', { name: 'Needs Refinement' }).first();
  await expect(needsRefinement.getByRole('button', { name: /^open alf-/i })).toHaveText([
    /First story/,
    /Third story/,
    /Second story/,
  ]);

  // 7. On the Backlog: the group ranks at the TOP of the project, in display order, with the
  //    project's pre-existing story below it.
  await page.getByRole('link', { name: 'Backlog' }).click();
  await expect(page.getByRole('listitem')).toHaveText([
    /First story/,
    /Third story/,
    /Second story/,
    /Existing story/,
  ]);
});

test('a code parent without an intended project sends through the project-only epic gate', async ({
  page,
  seed,
}) => {
  const parent = makeItem('Bare epic', {
    id: '44444444-4444-4444-8444-444444444444',
    item_type: 'code',
  });
  await seed({
    items: [parent, makeItem('Solo story', { item_type: 'code', parent_id: parent.id })],
    projects: [makeProject('Alfred', { id: PROJECT_ID, key: 'ALF' })],
  });
  await page.goto('/?view=inbox');

  // Dispatch keeps its "…" — a dialog will open (no intended project).
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Bare epic' })
    .first()
    .getByRole('button', { name: 'More actions' })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Dispatch…' }).click();

  // The epic gate: a project picker + the read-only preview (epic name + ordered stories),
  // no epic picker. Confirm enables once a project is chosen.
  const gate = page.getByRole('dialog', { name: /send to code module/i });
  await expect(gate.getByText(/creates a new epic and 1 story/i)).toBeVisible();
  await expect(gate.getByTestId('epic-gate-preview')).toContainText('Bare epic');
  await expect(gate.getByTestId('epic-gate-preview')).toContainText('Solo story');
  const confirm = gate.getByRole('button', { name: 'Send to Code' });
  await expect(confirm).toBeDisabled();
  await gate.getByRole('option', { name: /alfred/i }).click();
  await confirm.click();

  // Epic ALF-1 (the counter's first value) + its one story; the group leaves the inbox.
  await expect(page.getByText(/created alf-1 · 1 story/i)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Bare epic' })).toHaveCount(0);
});
