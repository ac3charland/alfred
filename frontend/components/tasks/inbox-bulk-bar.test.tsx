import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import { renderWithProviders } from '@/lib/test-utils';
import type { Folder, Item } from '@/lib/types';

import { InboxBulkBar, InboxSelectToggle } from './inbox-bulk-bar';
import { TaskList } from './task-list';

jest.mock('@/lib/api-client');
const mockUpdateItem = jest.mocked(apiClient.updateItem);

const BASE: Item = {
  id: 'item-1',
  title: 'Task',
  notes: null,
  source_url: null,
  item_type: 'unclassified',
  created_at: '2025-01-01T10:00:00Z',
  raw_capture: null,
  due_date: null,
  status: 'active',
  completed_at: null,
  folder_id: null,
  parent_id: null,
  occurrence_index: null,
  recurrence: null,
  priority: null,
  recurrence_series_id: null,
  intended_project_id: null,
  sort_order: 0,
};

function makeItem(id: string, overrides: Partial<Item> = {}): Item {
  return { ...BASE, id, title: id, ...overrides };
}

const FOLDERS: Folder[] = [{ id: 'f1', name: 'Work', created_at: '2025-01-01T00:00:00Z' }];

/** The Inbox in select mode: the header toggle, the selectable list, and the bulk bar. */
function InboxHarness() {
  return (
    <>
      <InboxSelectToggle />
      <TaskList scope={{ type: 'inbox' }} selectable />
      <InboxBulkBar />
    </>
  );
}

function renderInbox(tasks: Item[], folders: Folder[] = FOLDERS) {
  return renderWithProviders(<InboxHarness />, { tasks, folders });
}

/** Open a bar dropdown by clicking its trigger, then activate `item` via keyboard (Radix
 * blocks pointer clicks on portalled items in jsdom — see task-row.test). */
async function pickFromMenu(
  user: ReturnType<typeof userEvent.setup>,
  trigger: RegExp,
  item: RegExp,
): Promise<void> {
  await user.click(screen.getByRole('button', { name: trigger }));
  const target = await screen.findByRole('menuitem', { name: item });
  const count = screen.getAllByRole('menuitem').length;
  for (let index = 0; index < count; index += 1) {
    if (document.activeElement === target) break;
    await user.keyboard('[ArrowDown]');
  }
  await user.keyboard('[Enter]');
}

describe('Inbox select mode', () => {
  it('enters select mode: rows become selection checkboxes, no bar until one is picked', async () => {
    const user = userEvent.setup();
    renderInbox([makeItem('u1', { title: 'Email the accountant' })]);

    // Idle: a normal row, no selection control.
    expect(screen.queryByRole('button', { name: /select "email the accountant"/i })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Select' }));

    expect(
      screen.getByRole('button', { name: /select "email the accountant"/i }),
    ).toBeInTheDocument();
    // No items selected yet → no action bar.
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();
  });

  it('toggling rows updates the live count and shows the bar', async () => {
    const user = userEvent.setup();
    renderInbox([makeItem('u1'), makeItem('u2')]);

    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('button', { name: /select "u1"/i }));
    await user.click(screen.getByRole('button', { name: /select "u2"/i }));

    const bar = screen.getByRole('region', { name: 'Bulk actions' });
    expect(bar).toHaveTextContent('2 selected');

    // Deselecting one drops the count.
    await user.click(screen.getByRole('button', { name: /deselect "u1"/i }));
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('1 selected');
  });

  it('gates Classify to all-unclassified and Move to all-task selections', async () => {
    const user = userEvent.setup();
    renderInbox([
      makeItem('u1', { item_type: 'unclassified' }),
      makeItem('t1', { item_type: 'task' }),
    ]);

    await user.click(screen.getByRole('button', { name: 'Select' }));

    // All-unclassified: Classify live, Move disabled.
    await user.click(screen.getByRole('button', { name: /select "u1"/i }));
    expect(screen.getByRole('button', { name: /classify as/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /move to folder/i })).toBeDisabled();

    // Add a task → mixed selection disables BOTH type-coherent actions.
    await user.click(screen.getByRole('button', { name: /select "t1"/i }));
    expect(screen.getByRole('button', { name: /classify as/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /move to folder/i })).toBeDisabled();

    // All-task: Move live, Classify disabled.
    await user.click(screen.getByRole('button', { name: /deselect "u1"/i }));
    expect(screen.getByRole('button', { name: /move to folder/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /classify as/i })).toBeDisabled();
  });

  it('Esc exits select mode and clears the selection', async () => {
    const user = userEvent.setup();
    renderInbox([makeItem('u1')]);

    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('button', { name: /select "u1"/i }));
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument();
  });

  it('Classify → Task patches every selected item and exits on full success', async () => {
    mockUpdateItem.mockImplementation((id) => Promise.resolve(makeItem(id, { item_type: 'task' })));
    const user = userEvent.setup();
    renderInbox([makeItem('u1'), makeItem('u2')]);

    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('button', { name: /select "u1"/i }));
    await user.click(screen.getByRole('button', { name: /select "u2"/i }));

    await pickFromMenu(user, /classify as/i, /^task$/i);

    await waitFor(() => {
      expect(mockUpdateItem).toHaveBeenCalledWith('u1', { item_type: 'task' });
    });
    expect(mockUpdateItem).toHaveBeenCalledWith('u2', { item_type: 'task' });
    // Full success → back to idle.
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Bulk actions' })).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'Select' })).toBeInTheDocument();
  });

  it('Move → folder files every selected task into the chosen folder', async () => {
    mockUpdateItem.mockImplementation((id) =>
      Promise.resolve(makeItem(id, { item_type: 'task', folder_id: 'f1' })),
    );
    const user = userEvent.setup();
    renderInbox([makeItem('t1', { item_type: 'task' }), makeItem('t2', { item_type: 'task' })]);

    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('button', { name: /select "t1"/i }));
    await user.click(screen.getByRole('button', { name: /select "t2"/i }));

    await pickFromMenu(user, /move to folder/i, /^work$/i);

    await waitFor(() => {
      expect(mockUpdateItem).toHaveBeenCalledWith('t1', { folder_id: 'f1' });
    });
    expect(mockUpdateItem).toHaveBeenCalledWith('t2', { folder_id: 'f1' });
  });

  it('a partial failure keeps only the failed item selected for retry', async () => {
    // u1 saves, u2 fails.
    mockUpdateItem.mockImplementation((id) =>
      id === 'u2'
        ? Promise.reject(new Error('network'))
        : Promise.resolve(makeItem(id, { item_type: 'task' })),
    );
    const user = userEvent.setup();
    renderInbox([makeItem('u1'), makeItem('u2')]);

    await user.click(screen.getByRole('button', { name: 'Select' }));
    await user.click(screen.getByRole('button', { name: /select "u1"/i }));
    await user.click(screen.getByRole('button', { name: /select "u2"/i }));

    await pickFromMenu(user, /classify as/i, /^task$/i);

    // Still in select mode with just the failed item selected.
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('1 selected');
    });
    expect(screen.getByRole('button', { name: /deselect "u2"/i })).toBeInTheDocument();
  });
});
