import { makeEpic, makeFolder, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Setting a row's labels straight from its ⋯ menu (ALF-191), end to end: a captured item is
 * classified, labelled from the menu's per-type submenus, and dispatched — without ever opening
 * the detail panel. The claim no unit test can make is the chain: the write lands, the row's
 * chip and ready pip reflect it, Dispatch enables, and the item arrives at its destination.
 *
 * Every submenu is driven by keyboard (hover the sub-trigger → ArrowRight to open →
 * ArrowDown/Enter to pick) because synthetic pointer clicks race Radix's safe triangle — the
 * same approach classify.spec and task-row.spec take.
 */

const WORK = makeFolder('Work', { id: '11111111-1111-4111-8111-111111111111' });

/** Open the row's ⋯ menu, then the submenu behind `entry`, and wait for `firstOption`. */
async function openSubmenu(
  page: import('@playwright/test').Page,
  entry: string,
  firstOption: string,
): Promise<void> {
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: entry }).hover();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: firstOption, exact: true })).toBeFocused();
}

/** Step down `steps` entries from the submenu's focused first item and select. */
async function pickOption(
  page: import('@playwright/test').Page,
  option: string,
  steps: number,
): Promise<void> {
  for (let index = 0; index < steps; index += 1) await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: option, exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
}

test('classify as Task → set the folder from the ⋯ menu → dispatch into that folder', async ({
  page,
  seed,
}) => {
  // A real UUID: every write here PATCHes the row by id, which the route validates as one.
  await seed({
    folders: [WORK],
    items: [makeItem('Call the dentist', { id: '22222222-2222-4222-8222-222222222222' })],
  });
  await page.goto('/?view=inbox');

  // 1. Classify it a task. Only then do the label submenus appear.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Classify as…' }).hover();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: 'Task', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');

  // 2. Unlabelled, Dispatch names what is missing — and Classify as… is gone for good.
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Classify as…' })).toHaveCount(0);
  const blocked = page.getByRole('menuitem', { name: 'Dispatch', exact: true });
  await expect(blocked).toHaveAttribute('title', 'Not ready — needs a folder');
  await page.keyboard.press('Escape');

  // 3. Folder ▸ Work, straight from the menu — a label, not a move.
  await openSubmenu(page, 'Folder…', 'No folder');
  await pickOption(page, 'Work', 1);

  // The row wears the folder chip and the ready pip, still in the Inbox.
  const row = page.getByRole('listitem').filter({ hasText: 'Call the dentist' });
  await expect(row.getByRole('button', { name: 'Folder: Work' })).toBeVisible();
  await expect(row.getByRole('img', { name: 'Ready to dispatch' })).toBeVisible();

  // 4. Dispatch is live now, and one press files it.
  await page.getByRole('button', { name: 'More actions' }).click();
  const ready = page.getByRole('menuitem', { name: 'Dispatch', exact: true });
  await expect(ready).not.toHaveAttribute('aria-disabled', 'true');
  await ready.click();

  await expect(page.getByRole('listitem').filter({ hasText: 'Call the dentist' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Work' }).click();
  await expect(
    page.getByRole('list', { name: 'Tasks' }).getByText('Call the dentist'),
  ).toBeVisible();
});

test('classify as Code → set project and epic from the ⋯ menu → dispatch with no gate dialog', async ({
  page,
  seed,
}) => {
  const projectId = '33333333-3333-4333-8333-333333333333';
  const epicId = '44444444-4444-4444-8444-444444444444';
  await seed({
    items: [makeItem('Add the retry backoff', { id: '55555555-5555-4555-8555-555555555555' })],
    projects: [makeProject('Alfred', { id: projectId, key: 'ALF', ref_seq: 139 })],
    epics: [makeEpic('Inbox triage', { id: epicId, project_id: projectId, ref_number: 140 })],
  });
  await page.goto('/?view=inbox');

  // 1. Classify it code (ArrowDown moves from "Task" to "Code").
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Classify as…' }).hover();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: 'Task', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Code', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');

  // 2. Epic is offered but dimmed, with its blocker readable as text (a disabled sub-trigger is
  //    pointer-events-none, so its tooltip can never be hovered into view).
  await page.getByRole('button', { name: 'More actions' }).click();
  const epicEntry = page.getByRole('menuitem', { name: /^Epic/ });
  await expect(epicEntry).toHaveAttribute('aria-disabled', 'true');
  await expect(epicEntry).toContainText('Pick a project first');
  await page.keyboard.press('Escape');

  // 3. Project ▸ Alfred, then Epic ▸ Inbox triage — the epic list only exists once a project does.
  await openSubmenu(page, 'Project…', 'No project');
  await pickOption(page, 'Alfred ALF', 1);
  await openSubmenu(page, 'Epic…', 'No epic');
  await pickOption(page, 'Inbox triage ALF-140', 1);

  // 4. Both hints set, Dispatch has nothing left to ask — no gate dialog.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Dispatch', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await expect(page.getByText(/created alf-140/i)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Add the retry backoff' })).toHaveCount(
    0,
  );
});
