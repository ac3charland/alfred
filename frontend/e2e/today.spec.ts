import { makeFolder, makeItem } from './support/constants';
import { expect, test } from './support/fixtures';

/**
 * The Today view (ALF-106): the sidebar link beneath Priority, the due-today-or-overdue filter,
 * the most-overdue-first order, and ticking a task off from the list.
 *
 * Due dates are only task-only fields, so these fixtures classify as tasks (not `makeItem`'s
 * default), and every date is computed from the browser's own "today" — a hard-coded one would
 * stop being today the day after it was written.
 */
function task(title: string, overrides: Parameters<typeof makeItem>[1] = {}) {
  return makeItem(title, { item_type: 'task', ...overrides });
}

/** A local `YYYY-MM-DD` due date offset from today (0 = today, -1 = yesterday). */
function dueDate(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear())}-${month}-${day}`;
}

test('the sidebar Today link opens the due-today list', async ({ page, seed }) => {
  await seed({ items: [task('Call the plumber', { due_date: dueDate(0) })] });
  await page.goto('/priority');

  // `exact` matters: a folder badge's label ("… high-priority or due today") also contains the
  // word, so a substring match on "Today" is ambiguous the moment a folder holds a due task.
  await page.getByRole('link', { name: 'Today', exact: true }).click();

  await expect(page).toHaveURL(/\/today$/);
  const due = page.getByRole('list', { name: 'Tasks due today' });
  await expect(due.getByText('Call the plumber')).toBeVisible();
});

test('lists what is due today or overdue, most overdue first, and hides the rest', async ({
  page,
  seed,
}) => {
  await seed({
    items: [
      task('Due today', { due_date: dueDate(0) }),
      task('A week late', { due_date: dueDate(-7) }),
      task('Yesterday', { due_date: dueDate(-1) }),
      task('Due tomorrow', { due_date: dueDate(1) }),
      task('No due date'),
    ],
  });

  await page.goto('/today');

  const rows = page.getByRole('list', { name: 'Tasks due today' }).getByRole('listitem');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('A week late');
  await expect(rows.nth(1)).toContainText('Yesterday');
  await expect(rows.nth(2)).toContainText('Due today');
});

test('an overdue task outranks a high-priority one due today', async ({ page, seed }) => {
  await seed({
    items: [
      task('High, due today', { due_date: dueDate(0), priority: 'high' }),
      task('Low, overdue', { due_date: dueDate(-2), priority: 'low' }),
    ],
  });

  await page.goto('/today');

  const rows = page.getByRole('list', { name: 'Tasks due today' }).getByRole('listitem');
  await expect(rows.nth(0)).toContainText('Low, overdue');
  await expect(rows.nth(1)).toContainText('High, due today');
});

test('an undated parent surfaces for a subtask that is due, revealed by its chevron', async ({
  page,
  seed,
}) => {
  const parent = task('Launch the site');
  await seed({
    items: [parent, task('Book the venue', { parent_id: parent.id, due_date: dueDate(-1) })],
  });

  await page.goto('/today');

  const due = page.getByRole('list', { name: 'Tasks due today' });
  await expect(due.getByText('Launch the site')).toBeVisible();

  // getByRole respects aria-hidden: while collapsed the Subtasks list has 0 AT matches, so the
  // due subtask is reachable only by expanding the parent that floated it in.
  const subtasks = page.getByRole('list', { name: 'Subtasks' });
  await expect(subtasks).toBeHidden();

  await page.getByRole('button', { name: 'Expand subtasks' }).click();
  await expect(subtasks.getByText('Book the venue')).toBeVisible();
});

test('completes a task from the Today list, dropping it out', async ({ page, seed }) => {
  await seed({
    folders: [makeFolder('Home', { id: 'home' })],
    items: [task('Take out the bins', { folder_id: 'home', due_date: dueDate(0) })],
  });

  await page.goto('/today');

  const due = page.getByRole('list', { name: 'Tasks due today' });
  // Each row names the bucket it lives in, so the list stays scannable across folders.
  await expect(due.getByText('Home')).toBeVisible();

  await page.getByRole('button', { name: 'Mark "Take out the bins" complete' }).click();

  await expect(due.getByText('Take out the bins')).toBeHidden();
});
