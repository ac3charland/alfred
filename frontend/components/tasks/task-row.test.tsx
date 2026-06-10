import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import type { TaskScope } from '@/lib/stores/tasks-store';
import { renderWithProviders } from '@/lib/test-utils';
import type { Folder, Item } from '@/lib/types';

import { TaskList } from './task-list';

// api-client is the seam the store calls; mock it so tests never hit the network.
jest.mock('@/lib/api-client');
const mockCompleteTask = jest.mocked(apiClient.completeTask);
const mockUpdateItem = jest.mocked(apiClient.updateItem);
const mockDeleteItem = jest.mocked(apiClient.deleteItem);
const mockMoveToInbox = jest.mocked(apiClient.moveToInbox);

const BASE_ITEM: Item = {
  id: 'item-1',
  title: 'Write tests',
  notes: null,
  source_url: null,
  item_type: 'task',
  created_at: '2025-01-01T10:00:00Z',
  raw_capture: null,
  due_date: null,
  status: 'active',
  completed_at: null,
  folder_id: null,
  parent_id: null,
};

const CHILD_ITEM: Item = {
  ...BASE_ITEM,
  id: 'item-2',
  title: 'Write unit tests',
  parent_id: 'item-1',
  created_at: '2025-01-01T11:00:00Z',
};

const GRANDCHILD_ITEM: Item = {
  ...BASE_ITEM,
  id: 'item-3',
  title: 'Write edge case tests',
  parent_id: 'item-2',
  created_at: '2025-01-01T12:00:00Z',
};

const COMPLETED_ITEM: Item = { ...BASE_ITEM, status: 'completed' };

const FOLDER: Folder = { id: 'folder-1', name: 'Work', created_at: '2025-01-01T09:00:00Z' };

/**
 * Render rows through TaskList, seeding the flat item list into the store. Rows come from
 * the scoped selector, so changing an item's status/folder (complete/move) filters it out
 * of the view — exactly as in the app. Defaults to the inbox view.
 */
function renderTasks(items: Item[], options: { folders?: Folder[]; scope?: TaskScope } = {}) {
  return renderWithProviders(<TaskList scope={options.scope ?? { type: 'inbox' }} />, {
    tasks: items,
    folders: options.folders ?? [],
  });
}

const COMPLETED = { scope: { type: 'completed' } as const };

describe('TaskRow', () => {
  it('renders the task title', () => {
    renderTasks([BASE_ITEM]);
    expect(screen.getByText('Write tests')).toBeInTheDocument();
  });

  it('renders the completion checkbox with "complete" label for active tasks', () => {
    renderTasks([BASE_ITEM]);
    expect(
      screen.getByRole('button', { name: /mark "Write tests" complete/i }),
    ).toBeInTheDocument();
  });

  it('renders checkbox with "active" label in the completed view', () => {
    renderTasks([COMPLETED_ITEM], COMPLETED);
    expect(screen.getByRole('button', { name: /mark "Write tests" active/i })).toBeInTheDocument();
  });

  it('renders checkbox as checked (teal fill) in the completed view', () => {
    renderTasks([COMPLETED_ITEM], COMPLETED);
    expect(screen.getByRole('button', { name: /mark "Write tests" active/i })).toHaveClass(
      'bg-accent-teal',
    );
  });

  it('expand/collapse toggle is invisible when there are no children', () => {
    renderTasks([BASE_ITEM]);
    expect(screen.getByRole('button', { name: /expand subtasks/i })).toHaveClass('invisible');
  });

  it('expand toggle is visible when node has children', () => {
    renderTasks([BASE_ITEM, CHILD_ITEM]);
    expect(screen.getByRole('button', { name: /expand subtasks/i })).not.toHaveClass('invisible');
  });

  it('shows child tasks when the expand toggle is clicked', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM, CHILD_ITEM]);

    await user.click(screen.getByRole('button', { name: /expand subtasks/i }));

    expect(screen.getByText('Write unit tests')).toBeInTheDocument();
  });

  it('hides child tasks when expanded and then collapsed', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM, CHILD_ITEM]);

    await user.click(screen.getByRole('button', { name: /expand subtasks/i }));
    expect(screen.getByText('Write unit tests')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /collapse subtasks/i }));
    expect(screen.queryByText('Write unit tests')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Active task completion — optimistic, filtered out of the view
  // ---------------------------------------------------------------------------

  it('removes the task from the view immediately on checkbox click', async () => {
    mockCompleteTask.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));

    expect(screen.queryByText('Write tests')).not.toBeInTheDocument();
  });

  it('calls completeTask when the checkbox is clicked (no children)', async () => {
    mockCompleteTask.mockResolvedValue([]);
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));

    await waitFor(() => {
      expect(mockCompleteTask).toHaveBeenCalledWith('item-1');
    });
  });

  it('restores the task when completeTask fails', async () => {
    mockCompleteTask.mockRejectedValue(new Error('Network error'));
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));

    expect(await screen.findByText('Write tests')).toBeInTheDocument();
  });

  it('opens the cascade modal when checkbox is clicked on a task with children', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM, CHILD_ITEM]);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));

    expect(await screen.findByText(/complete with subtasks/i)).toBeInTheDocument();
  });

  it('does NOT call completeTask directly when the cascade modal opens', async () => {
    const user = userEvent.setup();
    renderTasks([BASE_ITEM, CHILD_ITEM]);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));
    await screen.findByText(/complete with subtasks/i);

    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Completed view — uncomplete
  // ---------------------------------------------------------------------------

  it('calls updateItem with status:active when uncompleting', async () => {
    mockUpdateItem.mockResolvedValue({ ...COMPLETED_ITEM, status: 'active' });
    const user = userEvent.setup();
    renderTasks([COMPLETED_ITEM], COMPLETED);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" active/i }));

    await waitFor(() => {
      expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { status: 'active' });
    });
  });

  it('removes the task from the completed view immediately when uncompleting', async () => {
    mockUpdateItem.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderTasks([COMPLETED_ITEM], COMPLETED);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" active/i }));

    expect(screen.queryByText('Write tests')).not.toBeInTheDocument();
  });

  it('restores the task when updateItem fails while uncompleting', async () => {
    mockUpdateItem.mockRejectedValue(new Error('Network error'));
    const user = userEvent.setup();
    renderTasks([COMPLETED_ITEM], COMPLETED);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" active/i }));

    expect(await screen.findByText('Write tests')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Other
  // ---------------------------------------------------------------------------

  it('shows due date chip when due_date is present', () => {
    renderTasks([{ ...BASE_ITEM, due_date: '2099-12-31' }]);
    expect(screen.getByRole('button', { name: /due date/i })).toBeInTheDocument();
  });

  it('deletes the task via the actions menu', async () => {
    mockDeleteItem.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderTasks([BASE_ITEM]);

    await user.click(screen.getByRole('button', { name: /more actions/i }));
    await screen.findByRole('menu');
    // Menu (no folders): Set due date, Add notes, Delete.
    await user.keyboard('[ArrowDown][ArrowDown][ArrowDown][Enter]');

    await waitFor(() => {
      expect(mockDeleteItem).toHaveBeenCalledWith('item-1');
    });
    expect(screen.queryByText('Write tests')).not.toBeInTheDocument();
  });

  describe('move to folder', () => {
    // Radix DropdownMenu portals set pointer-events:none on the body, which blocks
    // userEvent.click() on portal items. Keyboard navigation bypasses this.
    //   ArrowDown×1 → "Set due date", ×2 → "Add notes", ×3 → "Move to…" (SubTrigger)
    //   ArrowRight opens the submenu with "Inbox" auto-focused; ArrowDown → first folder.

    it('calls updateItem once when moving a leaf task to a folder', async () => {
      mockUpdateItem.mockResolvedValue(BASE_ITEM);
      const user = userEvent.setup();
      renderTasks([BASE_ITEM], { folders: [FOLDER] });

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][ArrowDown][ArrowRight][ArrowDown][Enter]');

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledTimes(1);
      });
      expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { folder_id: 'folder-1' });
    });

    it('calls updateItem for parent and all descendants when moving to a folder', async () => {
      mockUpdateItem.mockResolvedValue(BASE_ITEM);
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, CHILD_ITEM, GRANDCHILD_ITEM], { folders: [FOLDER] });

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][ArrowDown][ArrowRight][ArrowDown][Enter]');

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledTimes(3);
      });
      expect(mockUpdateItem).toHaveBeenCalledWith('item-3', { folder_id: 'folder-1' });
      expect(mockUpdateItem).toHaveBeenCalledWith('item-2', { folder_id: 'folder-1' });
      expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { folder_id: 'folder-1' });
    });

    it('calls moveToInbox once when moving a leaf task to the inbox', async () => {
      mockMoveToInbox.mockResolvedValue(BASE_ITEM);
      const user = userEvent.setup();
      renderTasks([BASE_ITEM], { folders: [FOLDER] });

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][ArrowDown][ArrowRight][Enter]');

      await waitFor(() => {
        expect(mockMoveToInbox).toHaveBeenCalledTimes(1);
      });
      expect(mockMoveToInbox).toHaveBeenCalledWith('item-1');
    });

    it('calls moveToInbox for parent and all descendants when moving to the inbox', async () => {
      mockMoveToInbox.mockResolvedValue(BASE_ITEM);
      const user = userEvent.setup();
      renderTasks([BASE_ITEM, CHILD_ITEM, GRANDCHILD_ITEM], { folders: [FOLDER] });

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][ArrowDown][ArrowRight][Enter]');

      await waitFor(() => {
        expect(mockMoveToInbox).toHaveBeenCalledTimes(3);
      });
      expect(mockMoveToInbox).toHaveBeenCalledWith('item-3');
      expect(mockMoveToInbox).toHaveBeenCalledWith('item-2');
      expect(mockMoveToInbox).toHaveBeenCalledWith('item-1');
    });
  });

  // ---------------------------------------------------------------------------
  // Inline title editing
  // ---------------------------------------------------------------------------

  describe('inline title editing', () => {
    it('enters edit mode on double-click of the title', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));

      expect(screen.getByRole('textbox', { name: /edit title/i })).toBeInTheDocument();
    });

    it('shows the current title value in the edit input', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));

      expect(screen.getByRole('textbox', { name: /edit title/i })).toHaveValue('Write tests');
    });

    it('saves the title and calls updateItem when Enter is pressed', async () => {
      mockUpdateItem.mockResolvedValue({ ...BASE_ITEM, title: 'Updated title' });
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));
      const input = screen.getByRole('textbox', { name: /edit title/i });
      await user.clear(input);
      await user.type(input, 'Updated title');
      await user.keyboard('[Enter]');

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { title: 'Updated title' });
      });
    });

    it('saves the title when the confirm button is clicked', async () => {
      mockUpdateItem.mockResolvedValue({ ...BASE_ITEM, title: 'Updated title' });
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));
      const input = screen.getByRole('textbox', { name: /edit title/i });
      await user.clear(input);
      await user.type(input, 'Updated title');
      await user.click(screen.getByRole('button', { name: /confirm title/i }));

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { title: 'Updated title' });
      });
    });

    it('cancels the edit on Escape without calling updateItem', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));
      const input = screen.getByRole('textbox', { name: /edit title/i });
      await user.clear(input);
      await user.type(input, 'Should not save');
      await user.keyboard('[Escape]');

      expect(mockUpdateItem).not.toHaveBeenCalled();
      expect(screen.getByText('Write tests')).toBeInTheDocument();
    });

    it('does not call updateItem when the title is unchanged', async () => {
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));
      await user.keyboard('[Enter]');

      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    it('reverts to the original title if updateItem fails', async () => {
      mockUpdateItem.mockRejectedValue(new Error('Network error'));
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));
      const input = screen.getByRole('textbox', { name: /edit title/i });
      await user.clear(input);
      await user.type(input, 'Broken title');
      await user.keyboard('[Enter]');

      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: /edit title/i })).toHaveValue('Write tests');
      });
    });

    it('exits edit mode after a successful save', async () => {
      mockUpdateItem.mockResolvedValue({ ...BASE_ITEM, title: 'New title' });
      const user = userEvent.setup();
      renderTasks([BASE_ITEM]);

      await user.dblClick(screen.getByText('Write tests'));
      const input = screen.getByRole('textbox', { name: /edit title/i });
      await user.clear(input);
      await user.type(input, 'New title');
      await user.keyboard('[Enter]');

      await waitFor(() => {
        expect(screen.queryByRole('textbox', { name: /edit title/i })).not.toBeInTheDocument();
      });
    });
  });
});
