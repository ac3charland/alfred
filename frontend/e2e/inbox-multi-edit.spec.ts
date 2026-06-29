import { makeEpic, makeFolder, makeItem, makeProject } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Inbox multi-edit: an explicit "Select" mode turns each Inbox row into a checkbox so a batch
 * can be classified, filed into a folder, or sent to the Code module in one pass. These cover
 * the three bulk actions end-to-end against the real route handlers, stores, and the gate.
 *
 * Real UUID ids: every bulk action PATCHes rows by id (or runs the enter_code_module RPC),
 * which the routes validate as UUIDs — `makeItem`'s default id is a real UUID.
 */

test.describe('inbox multi-edit', () => {
  test('select a batch of unclassified captures and classify them all as Task', async ({
    page,
    seed,
  }) => {
    await seed({
      items: [
        makeItem('Email the accountant about Q2'),
        makeItem('Draft the onboarding doc'),
        makeItem('Spike: websocket reconnection'),
      ],
    });
    await page.goto('/?view=inbox');

    // Enter select mode; each row becomes a selection checkbox.
    await page.getByRole('button', { name: 'Select' }).click();
    await page.getByRole('button', { name: /select "Email the accountant about Q2"/i }).click();
    await page.getByRole('button', { name: /select "Draft the onboarding doc"/i }).click();

    const bar = page.getByRole('region', { name: 'Bulk actions' });
    await expect(bar).toContainText('2 selected');

    // Classify is live (all-unclassified); Move is gated off (task-only).
    await expect(bar.getByRole('button', { name: /move to folder/i })).toBeDisabled();
    await bar.getByRole('button', { name: /classify as/i }).click();
    await page.getByRole('menuitem', { name: /^task$/i }).click();

    // The two selected rows are now Tasks (a task carries no row pill — ALF-67 — so the proof is
    // the completion checkbox, a task-only affordance); mode exits on full success.
    const list = page.getByRole('list', { name: 'Tasks' });
    const classified = list
      .getByRole('listitem')
      .filter({ hasText: 'Email the accountant about Q2' });
    await expect(classified.getByRole('button', { name: /complete$/i })).toBeVisible();
    await expect(
      list
        .getByRole('listitem')
        .filter({ hasText: 'Draft the onboarding doc' })
        .getByRole('button', { name: /complete$/i }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Bulk actions' })).toBeHidden();
    // The untouched third capture is still unclassified (no completion checkbox).
    await expect(
      list
        .getByRole('listitem')
        .filter({ hasText: 'Spike: websocket reconnection' })
        .getByRole('button', { name: /complete$/i }),
    ).toHaveCount(0);
  });

  test('select a batch of tasks and file them into a folder', async ({ page, seed }) => {
    const folder = makeFolder('Work');
    await seed({
      folders: [folder],
      items: [
        makeItem('Renew the domain', { item_type: 'task' }),
        makeItem('Book the venue', { item_type: 'task' }),
      ],
    });
    await page.goto('/?view=inbox');

    await page.getByRole('button', { name: 'Select' }).click();
    await page.getByRole('button', { name: /select "Renew the domain"/i }).click();
    await page.getByRole('button', { name: /select "Book the venue"/i }).click();

    const bar = page.getByRole('region', { name: 'Bulk actions' });
    await bar.getByRole('button', { name: /move to folder/i }).click();
    await page.getByRole('menuitem', { name: 'Work' }).click();

    // Both leave the Inbox.
    const inbox = page.getByRole('list', { name: 'Tasks' });
    await expect(inbox.getByText('Renew the domain')).toBeHidden();
    await expect(inbox.getByText('Book the venue')).toBeHidden();

    // …and land in the folder.
    await page.getByRole('link', { name: /work/i }).click();
    const folderList = page.getByRole('list', { name: 'Tasks' });
    await expect(folderList.getByText('Renew the domain')).toBeVisible();
    await expect(folderList.getByText('Book the venue')).toBeVisible();
  });

  test('select a batch and send them all to the Code module through the gate', async ({
    page,
    seed,
  }) => {
    const project = makeProject('Alfred', { key: 'ALF', ref_seq: 4 });
    const epic = makeEpic('Core', { project_id: project.id, ref_number: 1, ref: 'ALF-1' });
    await seed({
      projects: [project],
      epics: [epic],
      items: [makeItem('Refactor the parser'), makeItem('Add retry to the worker')],
    });
    await page.goto('/?view=inbox');

    await page.getByRole('button', { name: 'Select' }).click();
    await page.getByRole('button', { name: /select "Refactor the parser"/i }).click();
    await page.getByRole('button', { name: /select "Add retry to the worker"/i }).click();

    await page
      .getByRole('region', { name: 'Bulk actions' })
      .getByRole('button', {
        name: /send to code…/i,
      })
      .click();

    // The gate pluralizes for a batch and admits all under one project + epic.
    const gate = page.getByRole('dialog', { name: /send to code module/i });
    await expect(gate.getByText(/assign these/i)).toContainText('2 items');
    await gate.getByRole('option', { name: /alfred/i }).click();
    await gate.getByRole('option', { name: /core/i }).click();
    await gate.getByRole('button', { name: /send to code module/i }).click();
    await expect(gate).toBeHidden();

    // Both leave the Inbox and land on the board under Core in Needs Refinement.
    const inbox = page.getByRole('list', { name: 'Tasks' });
    await expect(inbox.getByText('Refactor the parser')).toBeHidden();
    await expect(inbox.getByText('Add retry to the worker')).toBeHidden();

    await page.getByRole('link', { name: 'Code' }).click();
    await page
      .getByRole('navigation', { name: 'Projects' })
      .getByRole('link', { name: /alfred/i })
      .click();
    const needsRefinement = page.getByRole('region', { name: 'Needs Refinement' });
    await expect(needsRefinement.getByText('Refactor the parser')).toBeVisible();
    await expect(needsRefinement.getByText('Add retry to the worker')).toBeVisible();
  });
});
