import { makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The gate: an inbox item is classified as Code, sent to the Code module through
 * the gate (creating a brand-new project + epic), and the resulting story leaves the inbox
 * and appears on the board in Needs Refinement under its epic. Also covers Convert to Code
 * Story on a task.
 *
 * The mock implements create_epic / enter_code_module and the task_items ↔ v_code_stories
 * membership split, so this is a genuine integration run against the real route handlers,
 * stores, and dialogs.
 *
 * The actions-menu submenu (Classify as…) is driven by keyboard — synthetic pointer clicks
 * race Radix's safe-triangle — matching classify.spec / task-row.spec.
 */

test('classify as Code → gate (new project + epic) → leaves inbox, lands on the board', async ({
  page,
  seed,
}) => {
  // The /api/code gate validates item_id as a UUID (the items PK type), so the seeded
  // item uses a real UUID rather than a short fixture id.
  await seed({
    items: [makeItem('Ship the inbound webhook', { id: '99999999-9999-4999-8999-999999999999' })],
  });
  await page.goto('/?view=inbox');

  // 1. Classify the captured item as Code.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Classify as…' }).hover();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown'); // Task → Code
  // `exact` so "Code" doesn't also match the "Convert to Code Story…" item.
  await expect(page.getByRole('menuitem', { name: 'Code', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');

  const row = page.getByRole('listitem').filter({ hasText: 'Ship the inbound webhook' });
  await expect(row.getByText('Code', { exact: true })).toBeVisible();

  // 2. Open the gate via "Send to Code module…".
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /send to code module/i }).click();
  const gate = page.getByRole('dialog', { name: /send to code module/i });
  await expect(gate).toBeVisible();

  // 3. Create a brand-new project (name + github URL + 3-char key).
  await gate.getByRole('button', { name: /new project…/i }).click();
  const projectDialog = page.getByRole('dialog', { name: /new project/i });
  await projectDialog.getByRole('textbox', { name: /name/i }).fill('Alfred');
  await projectDialog
    .getByRole('textbox', { name: /github link/i })
    .fill('https://github.com/ac3charland/alfred');
  await projectDialog.getByRole('textbox', { name: /ticket key/i }).fill('ALF');
  // The live ref preview reflects the key.
  await expect(projectDialog.getByText('ALF-12')).toBeVisible();
  await projectDialog.getByRole('button', { name: /create project/i }).click();
  await expect(projectDialog).toBeHidden();

  // The new project is auto-selected in the gate.
  await expect(gate.getByRole('option', { name: /alfred/i })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // 4. Create a new epic for it.
  await gate.getByRole('button', { name: /new epic…/i }).click();
  const epicDialog = page.getByRole('dialog', { name: /new epic/i });
  await epicDialog.getByRole('textbox', { name: /epic name/i }).fill('Communication Firewall');
  await epicDialog.getByRole('button', { name: /create epic/i }).click();
  await expect(epicDialog).toBeHidden();
  await expect(gate.getByRole('option', { name: /communication firewall/i })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // 5. Confirm the gate.
  await gate.getByRole('button', { name: /send to code module/i }).click();
  await expect(gate).toBeHidden();

  // 6. A toast announces the new ref, and the item has left the inbox. Epics and stories
  //    SHARE the per-project counter: the new epic took ALF-1, so this story is ALF-2.
  await expect(page.getByText(/created alf-2/i)).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Ship the inbound webhook' }),
  ).toHaveCount(0);

  // 7. Navigate to Code → the story is a card in Needs Refinement under its epic.
  await page.getByRole('link', { name: 'Code' }).click();
  await expect(page).toHaveURL('/code');
  await page
    .getByRole('navigation', { name: 'Projects' })
    .getByRole('link', { name: /alfred/i })
    .click();

  await expect(page.getByRole('button', { name: /^communication firewall/i })).toBeVisible();
  const needsRefinement = page.getByRole('region', { name: 'Needs Refinement' });
  await expect(needsRefinement.getByText('ALF-2')).toBeVisible();
  await expect(needsRefinement.getByText('Ship the inbound webhook')).toBeVisible();
});

test('Convert to Code Story on a task → it leaves Tasks and lands on the board', async ({
  page,
  seed,
}) => {
  // Seed an existing project + epic so the gate just needs a selection.
  const projectId = '11111111-1111-4111-8111-111111111111';
  const epicId = '22222222-2222-4222-8222-222222222222';
  await seed({
    items: [
      makeItem('Refactor the parser', {
        id: '99999999-9999-4999-8999-999999999999',
        item_type: 'task',
      }),
    ],
    projects: [
      {
        id: projectId,
        name: 'Alfred',
        key: 'ALF',
        repo_owner: 'ac3charland',
        repo_name: 'alfred',
        github_url: null,
        ref_seq: 4,
        created_at: new Date(Date.UTC(2024, 0, 1)).toISOString(),
      },
    ],
    epics: [
      {
        id: epicId,
        project_id: projectId,
        name: 'Core',
        notes: null,
        ref_number: 1,
        ref: 'ALF-1',
        archived_at: null,
        created_at: new Date(Date.UTC(2024, 0, 2)).toISOString(),
      },
    ],
  });
  await page.goto('/?view=inbox');

  // A task offers "Convert to Code Story…", not "Send to Code module…".
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /convert to code story/i }).click();

  const gate = page.getByRole('dialog', { name: /send to code module/i });
  await gate.getByRole('option', { name: /alfred/i }).click();
  await gate.getByRole('option', { name: /core/i }).click();
  await gate.getByRole('button', { name: /send to code module/i }).click();
  await expect(gate).toBeHidden();

  // Toast shows the next ref (ref_seq was 4 → ALF-5), and the task left the inbox.
  await expect(page.getByText(/created alf-5/i)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Refactor the parser' })).toHaveCount(
    0,
  );

  // It lands on the board under Core in Needs Refinement.
  await page.getByRole('link', { name: 'Code' }).click();
  await page
    .getByRole('navigation', { name: 'Projects' })
    .getByRole('link', { name: /alfred/i })
    .click();
  const needsRefinement = page.getByRole('region', { name: 'Needs Refinement' });
  await expect(needsRefinement.getByText('ALF-5')).toBeVisible();
  await expect(needsRefinement.getByText('Refactor the parser')).toBeVisible();
});
