import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/lib/test-utils';
import type { Folder, Item } from '@/lib/types';

import { PriorityView } from './priority-view';

let nextCreated = 0;
function makeItem(title: string, overrides: Partial<Item> = {}): Item {
  nextCreated += 1;
  return {
    id: overrides.id ?? title,
    title,
    notes: null,
    source_url: null,
    raw_capture: null,
    item_type: 'task',
    created_at: overrides.created_at ?? `2026-01-0${String(nextCreated)}T00:00:00Z`,
    due_date: overrides.due_date ?? null,
    status: overrides.status ?? 'active',
    completed_at: overrides.completed_at ?? null,
    folder_id: overrides.folder_id ?? null,
    parent_id: overrides.parent_id ?? null,
    occurrence_index: null,
    priority: overrides.priority ?? null,
    recurrence: null,
    recurrence_series_id: null,
  };
}

/** The rendered row titles, in order, from the By-Priority list. */
function rowOrder(): string[] {
  const list = screen.getByRole('list', { name: 'Tasks by priority' });
  return within(list)
    .getAllByRole('listitem')
    .map((li) => li.textContent);
}

/** Index of the row whose title contains `title`. */
function indexOf(title: string): number {
  return rowOrder().findIndex((text) => text.includes(title));
}

describe('PriorityView', () => {
  it('orders by level: High → Medium → Low → unprioritised', () => {
    renderWithProviders(<PriorityView />, {
      tasks: [
        makeItem('Delta none', { priority: null }),
        makeItem('Charlie low', { priority: 'low' }),
        makeItem('Alpha high', { priority: 'high' }),
        makeItem('Bravo medium', { priority: 'medium' }),
      ],
    });

    expect(indexOf('Alpha high')).toBeLessThan(indexOf('Bravo medium'));
    expect(indexOf('Bravo medium')).toBeLessThan(indexOf('Charlie low'));
    expect(indexOf('Charlie low')).toBeLessThan(indexOf('Delta none'));
  });

  it('breaks ties within a level by earlier due date first, no-due last', () => {
    renderWithProviders(<PriorityView />, {
      tasks: [
        makeItem('No due', { priority: 'high', due_date: null }),
        makeItem('Later', { priority: 'high', due_date: '2026-06-20' }),
        makeItem('Earlier', { priority: 'high', due_date: '2026-06-05' }),
      ],
    });

    expect(indexOf('Earlier')).toBeLessThan(indexOf('Later'));
    expect(indexOf('Later')).toBeLessThan(indexOf('No due'));
  });

  it('lists top-level tasks only (a prioritised subtask is not its own row)', () => {
    renderWithProviders(<PriorityView />, {
      tasks: [
        makeItem('Parent', { id: 'p', priority: 'low' }),
        makeItem('Child high', { id: 'c', parent_id: 'p', priority: 'high' }),
      ],
    });

    expect(screen.getByText('Parent')).toBeInTheDocument();
    expect(screen.queryByText('Child high')).not.toBeInTheDocument();
  });

  it('rolls a High/overdue active subtask up so its Low parent outranks a Medium task', () => {
    renderWithProviders(<PriorityView />, {
      tasks: [
        makeItem('Medium task', { id: 'm', priority: 'medium' }),
        makeItem('Low parent', { id: 'lp', priority: 'low' }),
        makeItem('Urgent child', {
          id: 'uc',
          parent_id: 'lp',
          priority: 'high',
          due_date: '2026-06-01',
        }),
      ],
    });

    expect(indexOf('Low parent')).toBeLessThan(indexOf('Medium task'));
  });

  it('does not let a COMPLETED subtask lift its parent', () => {
    renderWithProviders(<PriorityView />, {
      tasks: [
        makeItem('Medium task', { id: 'm', priority: 'medium' }),
        makeItem('Low parent', { id: 'lp', priority: 'low' }),
        makeItem('Done child', {
          id: 'dc',
          parent_id: 'lp',
          priority: 'high',
          status: 'completed',
          completed_at: '2026-06-02T00:00:00Z',
        }),
      ],
    });

    // The high child is completed, so the parent stays Low — below the Medium task.
    expect(indexOf('Medium task')).toBeLessThan(indexOf('Low parent'));
  });

  it('hides completed top-level tasks until Show completed is toggled', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PriorityView />, {
      tasks: [
        makeItem('Active task', { priority: 'high' }),
        makeItem('Done task', {
          priority: 'high',
          status: 'completed',
          completed_at: '2026-06-02T00:00:00Z',
        }),
      ],
    });

    expect(screen.queryByText('Done task')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show completed' }));

    expect(screen.getByText('Done task')).toBeInTheDocument();
  });

  it('labels each row with its folder name, or "Inbox" when unfiled', () => {
    const folders: Folder[] = [{ id: 'f1', name: 'Work', created_at: '2026-01-01T00:00:00Z' }];
    renderWithProviders(<PriorityView />, {
      folders,
      tasks: [
        makeItem('Filed', { priority: 'high', folder_id: 'f1' }),
        makeItem('Unfiled', { priority: 'low', folder_id: null }),
      ],
    });

    const list = screen.getByRole('list', { name: 'Tasks by priority' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.find((li) => li.textContent.includes('Filed'))).toHaveTextContent('Work');
    expect(rows.find((li) => li.textContent.includes('Unfiled'))).toHaveTextContent('Inbox');
  });

  it('shows an empty state when there are no tasks', () => {
    renderWithProviders(<PriorityView />, { tasks: [] });
    expect(screen.getByText(/No tasks yet/)).toBeInTheDocument();
  });

  it('treats a task whose priority is missing (undefined) as unprioritised, without crashing', () => {
    // Reproduces the production data shape: getAllItems reads the `task_items` view, which (until
    // the view is recreated to carry the column) drops `priority`, so every row arrives with it
    // `undefined` rather than `null`. The row must render the "Set priority" affordance, not 500.
    const ghost = { ...makeItem('Ghost task'), priority: undefined } as unknown as Item;
    renderWithProviders(<PriorityView />, { tasks: [ghost] });

    expect(screen.getByText('Ghost task')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set priority' })).toBeInTheDocument();
  });
});
