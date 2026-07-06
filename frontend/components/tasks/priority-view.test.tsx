import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import * as apiClient from '@/lib/api-client';
import { renderWithProviders } from '@/lib/test-utils';
import type { Folder, Item } from '@/lib/types';

import { ALFRED_FOCUS_ITEM_EVENT } from './alfred-link';
import { PriorityView } from './priority-view';

// api-client is the seam the store calls; mock it so tests never hit the network.
jest.mock('@/lib/api-client');
const mockCompleteTask = jest.mocked(apiClient.completeTask);
const mockUpdateItem = jest.mocked(apiClient.updateItem);

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

/** The rendered top-level row titles, in order, from the By-Priority list. */
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

  it('renders subtasks under their parent (revealed by the chevron), not as their own ranked rows', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PriorityView />, {
      tasks: [
        makeItem('Parent', { id: 'p', priority: 'low' }),
        makeItem('Child high', { id: 'c', parent_id: 'p', priority: 'high' }),
      ],
    });

    // The child is not its own ranked row and stays hidden until the parent is expanded.
    expect(screen.getByRole('link', { name: 'Parent' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Child high' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand subtasks' }));

    expect(screen.getByRole('link', { name: 'Child high' })).toBeInTheDocument();
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

  describe('completion (ALF-101)', () => {
    it('completes a top-level task from its checkbox, dropping it from the default list', async () => {
      mockCompleteTask.mockResolvedValue({ completed: [], spawned: null });
      const user = userEvent.setup();
      renderWithProviders(<PriorityView />, {
        tasks: [makeItem('Ship it', { id: 'ship', priority: 'high' })],
      });

      await user.click(screen.getByRole('button', { name: 'Mark "Ship it" complete' }));

      await waitFor(() => {
        expect(mockCompleteTask).toHaveBeenCalledWith('ship');
      });
      // A completed top-level task leaves the active-only default view.
      expect(screen.queryByText('Ship it')).not.toBeInTheDocument();
    });

    it('reactivates a completed task from its checkbox (Show completed on)', async () => {
      mockUpdateItem.mockResolvedValue(
        makeItem('Done', { id: 'done', status: 'active', priority: 'high' }),
      );
      const user = userEvent.setup();
      renderWithProviders(<PriorityView />, {
        tasks: [
          makeItem('Done', {
            id: 'done',
            priority: 'high',
            status: 'completed',
            completed_at: '2026-06-02T00:00:00Z',
          }),
        ],
      });

      await user.click(screen.getByRole('button', { name: 'Show completed' }));
      await user.click(screen.getByRole('button', { name: 'Mark "Done" active' }));

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledWith('done', { status: 'active' });
      });
    });

    it('warns with the cascade modal before completing a task that hides active subtasks', async () => {
      const user = userEvent.setup();
      renderWithProviders(<PriorityView />, {
        tasks: [
          makeItem('Parent', { id: 'p', priority: 'high' }),
          makeItem('Child', { id: 'c', parent_id: 'p' }),
        ],
      });

      await user.click(screen.getByRole('button', { name: 'Mark "Parent" complete' }));

      expect(await screen.findByText(/complete with subtasks/i)).toBeInTheDocument();
      expect(mockCompleteTask).not.toHaveBeenCalled();
    });

    it('completes the subtree once the cascade modal is confirmed', async () => {
      mockCompleteTask.mockResolvedValue({ completed: [], spawned: null });
      const user = userEvent.setup();
      renderWithProviders(<PriorityView />, {
        tasks: [
          makeItem('Parent', { id: 'p', priority: 'high' }),
          makeItem('Child', { id: 'c', parent_id: 'p' }),
        ],
      });

      await user.click(screen.getByRole('button', { name: 'Mark "Parent" complete' }));
      await user.click(await screen.findByRole('button', { name: 'Complete all' }));

      await waitFor(() => {
        expect(mockCompleteTask).toHaveBeenCalledWith('p');
      });
    });

    it('lets a subtask be completed from its own checkbox once expanded', async () => {
      mockCompleteTask.mockResolvedValue({ completed: [], spawned: null });
      const user = userEvent.setup();
      renderWithProviders(<PriorityView />, {
        tasks: [
          makeItem('Parent', { id: 'p', priority: 'low' }),
          makeItem('Child', { id: 'c', parent_id: 'p', priority: 'high' }),
        ],
      });

      await user.click(screen.getByRole('button', { name: 'Expand subtasks' }));
      await user.click(screen.getByRole('button', { name: 'Mark "Child" complete' }));

      await waitFor(() => {
        expect(mockCompleteTask).toHaveBeenCalledWith('c');
      });
    });
  });

  it('exposes neither the add-subtask nor the More actions affordance', () => {
    renderWithProviders(<PriorityView />, {
      tasks: [
        makeItem('Parent', { id: 'p', priority: 'high' }),
        makeItem('Child', { id: 'c', parent_id: 'p' }),
      ],
    });

    expect(screen.queryByRole('button', { name: 'Add subtask' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
  });

  describe('clicking a row navigates to the task and focuses it (ALF-96)', () => {
    it('links each row to its containing view — folder, or the inbox when unfiled', () => {
      const folders: Folder[] = [{ id: 'f1', name: 'Work', created_at: '2026-01-01T00:00:00Z' }];
      renderWithProviders(<PriorityView />, {
        folders,
        tasks: [
          makeItem('Filed', { priority: 'high', folder_id: 'f1' }),
          makeItem('Unfiled', { priority: 'low', folder_id: null }),
        ],
      });

      expect(screen.getByRole('link', { name: 'Filed' })).toHaveAttribute('href', '/folders/f1');
      expect(screen.getByRole('link', { name: 'Unfiled' })).toHaveAttribute('href', '/?view=inbox');
    });

    it('on a plain click, switches to the folder view and fires the row-focus event', () => {
      const folders: Folder[] = [{ id: 'f1', name: 'Work', created_at: '2026-01-01T00:00:00Z' }];
      const pushState = jest.spyOn(globalThis.history, 'pushState').mockImplementation(() => {});
      const focusIds: string[] = [];
      const listener = (event_: Event) => {
        focusIds.push((event_ as CustomEvent<{ id: string }>).detail.id);
      };
      globalThis.addEventListener(ALFRED_FOCUS_ITEM_EVENT, listener);

      try {
        renderWithProviders(<PriorityView />, {
          folders,
          tasks: [makeItem('Filed', { id: 'filed', priority: 'high', folder_id: 'f1' })],
        });

        fireEvent.click(screen.getByRole('link', { name: 'Filed' }), { button: 0 });

        expect(pushState).toHaveBeenCalledWith(null, '', '/folders/f1');
        expect(focusIds).toEqual(['filed']);
      } finally {
        globalThis.removeEventListener(ALFRED_FOCUS_ITEM_EVENT, listener);
        pushState.mockRestore();
      }
    });

    it('leaves a modified click (⌘) to the browser — no client-side navigation', () => {
      const pushState = jest.spyOn(globalThis.history, 'pushState').mockImplementation(() => {});
      const focusIds: string[] = [];
      const listener = (event_: Event) => {
        focusIds.push((event_ as CustomEvent<{ id: string }>).detail.id);
      };
      globalThis.addEventListener(ALFRED_FOCUS_ITEM_EVENT, listener);

      try {
        renderWithProviders(<PriorityView />, {
          tasks: [makeItem('Filed', { id: 'filed', priority: 'high' })],
        });

        fireEvent.click(screen.getByRole('link', { name: 'Filed' }), {
          button: 0,
          metaKey: true,
        });

        expect(pushState).not.toHaveBeenCalled();
        expect(focusIds).toEqual([]);
      } finally {
        globalThis.removeEventListener(ALFRED_FOCUS_ITEM_EVENT, listener);
        pushState.mockRestore();
      }
    });

    it('re-prioritising from the row chip does not navigate', async () => {
      const user = userEvent.setup();
      const pushState = jest.spyOn(globalThis.history, 'pushState').mockImplementation(() => {});

      try {
        renderWithProviders(<PriorityView />, {
          tasks: [makeItem('Filed', { id: 'filed', priority: 'high' })],
        });

        await user.click(screen.getByRole('button', { name: /priority/i }));

        expect(pushState).not.toHaveBeenCalled();
      } finally {
        pushState.mockRestore();
      }
    });
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
