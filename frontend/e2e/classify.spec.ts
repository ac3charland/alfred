import { makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * Inbox classification & type badges (§7). A captured item starts `unclassified` — no
 * type badge, no completion checkbox, no add-subtask affordance. The actions-menu
 * "Classify as…" submenu flips its type: Code shows a Code badge but still no task
 * affordances; Task unlocks the checkbox, due date and subtasks plus the Task badge.
 *
 * The submenu is driven by keyboard (hover the subtrigger → ArrowRight to open →
 * ArrowDown/Enter to pick) because synthetic pointer clicks race Radix's safe-triangle
 * and often don't fire onSelect — same approach as the "Move to…" submenu in task-row.spec.
 */

test.describe('inbox classification', () => {
  test('an unclassified item shows no badge, checkbox or add-subtask affordance', async ({
    page,
    seed,
  }) => {
    await seed({ items: [makeItem('A captured thought', { id: 'u1' })] });
    await page.goto('/?view=inbox');

    const row = page.getByRole('listitem').filter({ hasText: 'A captured thought' });
    await expect(row.getByText('Task', { exact: true })).toBeHidden();
    await expect(row.getByText('Code', { exact: true })).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Mark "A captured thought" complete' }),
    ).toBeHidden();
    await expect(page.getByRole('button', { name: 'Add subtask' })).toBeHidden();
  });

  test('classifying as Code shows the Code badge but unlocks no task affordances', async ({
    page,
    seed,
  }) => {
    await seed({ items: [makeItem('Ship the webhook', { id: 'u1' })] });
    await page.goto('/?view=inbox');

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Classify as…' }).hover();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('menuitem', { name: 'Code' })).toBeVisible();
    // ArrowDown moves from "Task" (first) to "Code"; wait for focus before selecting.
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Code' })).toBeFocused();
    await page.keyboard.press('Enter');

    const row = page.getByRole('listitem').filter({ hasText: 'Ship the webhook' });
    await expect(row.getByText('Code', { exact: true })).toBeVisible();
    // Still no completion checkbox or add-subtask affordance on a code row.
    await expect(
      page.getByRole('button', { name: 'Mark "Ship the webhook" complete' }),
    ).toBeHidden();
    await expect(page.getByRole('button', { name: 'Add subtask' })).toBeHidden();
  });

  test('classifying as Task unlocks the checkbox, due date and subtasks', async ({
    page,
    seed,
  }) => {
    await seed({ items: [makeItem('Plan the sprint', { id: 'u1' })] });
    await page.goto('/?view=inbox');

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Classify as…' }).hover();
    await page.keyboard.press('ArrowRight');
    // ArrowRight opens the submenu and focuses the first item, "Task".
    await expect(page.getByRole('menuitem', { name: 'Task' })).toBeFocused();
    await page.keyboard.press('Enter');

    const row = page.getByRole('listitem').filter({ hasText: 'Plan the sprint' });
    await expect(row.getByText('Task', { exact: true })).toBeVisible();
    // The full task affordances are now present.
    await expect(
      page.getByRole('button', { name: 'Mark "Plan the sprint" complete' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add subtask' })).toBeVisible();

    // The actions menu now offers "Set due date" (task-only), which it didn't before.
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Set due date' })).toBeVisible();
  });
});
