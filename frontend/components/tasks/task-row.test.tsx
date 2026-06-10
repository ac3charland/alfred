import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import { renderWithProviders } from '@/lib/test-utils';
import type { ItemNode } from '@/lib/tree';
import type { Folder } from '@/lib/types';

import { TaskList } from './task-list';

// api-client is the seam the store calls; mock it so tests never hit the network.
jest.mock('@/lib/api-client');
const mockCompleteTask = jest.mocked(apiClient.completeTask);
const mockUpdateItem = jest.mocked(apiClient.updateItem);
const mockDeleteItem = jest.mocked(apiClient.deleteItem);
const mockMoveToInbox = jest.mocked(apiClient.moveToInbox);

const BASE_ITEM: ItemNode = {
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
  children: [],
};

const CHILD_ITEM: ItemNode = {
  ...BASE_ITEM,
  id: 'item-2',
  title: 'Write unit tests',
  parent_id: 'item-1',
  created_at: '2025-01-01T11:00:00Z',
  children: [],
};

const GRANDCHILD_ITEM: ItemNode = {
  ...BASE_ITEM,
  id: 'item-3',
  title: 'Write edge case tests',
  parent_id: 'item-2',
  created_at: '2025-01-01T12:00:00Z',
  children: [],
};

const FOLDER: Folder = { id: 'folder-1', name: 'Work', created_at: '2025-01-01T09:00:00Z' };

/**
 * Render rows through TaskList seeded into the stores. Rows come from the TasksProvider,
 * so optimistic removals (complete/move/delete) actually unmount the row — as they do
 * in the app. `folders` seeds the move-to-folder menu via FoldersProvider.
 */
function renderTasks(
  nodes: ItemNode[],
  options: { folders?: Folder[]; isCompleted?: boolean } = {},
) {
  return renderWithProviders(<TaskList isCompleted={options.isCompleted ?? false} />, {
    tasks: nodes,
    folders: options.folders ?? [],
  });
}

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

  it('renders checkbox with "active" label when isCompleted is true', () => {
    renderTasks([BASE_ITEM], { isCompleted: true });
    expect(screen.getByRole('button', { name: /mark "Write tests" active/i })).toBeInTheDocument();
  });

  it('renders checkbox as checked (teal fill) when isCompleted is true', () => {
    renderTasks([BASE_ITEM], { isCompleted: true });
    expect(screen.getByRole('button', { name: /mark "Write tests" active/i })).toHaveClass(
      'bg-accent-teal',
    );
  });

  it('expand/collapse toggle is invisible when there are no children', () => {
    renderTasks([BASE_ITEM]);
    expect(screen.getByRole('button', { name: /expand subtasks/i })).toHaveClass('invisible');
  });

  it('expand toggle is visible when node has children', () => {
    renderTasks([{ ...BASE_ITEM, children: [CHILD_ITEM] }]);
    expect(screen.getByRole('button', { name: /expand subtasks/i })).not.toHaveClass('invisible');
  });

  it('shows child tasks when the expand toggle is clicked', async () => {
    const user = userEvent.setup();
    renderTasks([{ ...BASE_ITEM, children: [CHILD_ITEM] }]);

    await user.click(screen.getByRole('button', { name: /expand subtasks/i }));

    expect(screen.getByText('Write unit tests')).toBeInTheDocument();
  });

  it('hides child tasks when expanded and then collapsed', async () => {
    const user = userEvent.setup();
    renderTasks([{ ...BASE_ITEM, children: [CHILD_ITEM] }]);

    await user.click(screen.getByRole('button', { name: /expand subtasks/i }));
    expect(screen.getByText('Write unit tests')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /collapse subtasks/i }));
    expect(screen.queryByText('Write unit tests')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Active task completion — optimistic removal
  // ---------------------------------------------------------------------------

  it('removes the task immediately on checkbox click before the API resolves', async () => {
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
    renderTasks([{ ...BASE_ITEM, children: [CHILD_ITEM] }]);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));

    expect(await screen.findByText(/complete with subtasks/i)).toBeInTheDocument();
  });

  it('does NOT call completeTask directly when the cascade modal opens', async () => {
    const user = userEvent.setup();
    renderTasks([{ ...BASE_ITEM, children: [CHILD_ITEM] }]);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));
    await screen.findByText(/complete with subtasks/i);

    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Completed task (isCompleted) — uncomplete
  // ---------------------------------------------------------------------------

  it('calls updateItem with status:active when uncompleting', async () => {
    mockUpdateItem.mockResolvedValue({ ...BASE_ITEM, status: 'active' });
    const user = userEvent.setup();
    renderTasks([BASE_ITEM], { isCompleted: true });

    await user.click(screen.getByRole('button', { name: /mark "Write tests" active/i }));

    await waitFor(() => {
      expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { status: 'active' });
    });
  });

  it('removes the task immediately when uncompleting before the API resolves', async () => {
    mockUpdateItem.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderTasks([BASE_ITEM], { isCompleted: true });

    await user.click(screen.getByRole('button', { name: /mark "Write tests" active/i }));

    expect(screen.queryByText('Write tests')).not.toBeInTheDocument();
  });

  it('restores the task when updateItem fails while uncompleting', async () => {
    mockUpdateItem.mockRejectedValue(new Error('Network error'));
    const user = userEvent.setup();
    renderTasks([BASE_ITEM], { isCompleted: true });

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
    //
    // Focus lands on the menu container after open (not the first item), so:
    //   ArrowDown×1 moves to "Set due date"
    //   ArrowDown×2 moves to "Add notes"
    //   ArrowDown×3 reaches "Move to…" (the SubTrigger)
    //   ArrowRight opens the submenu with "Inbox" auto-focused
    //   ArrowDown optionally moves to the next folder, Enter selects

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
      const nodeWithDescendants: ItemNode = {
        ...BASE_ITEM,
        children: [{ ...CHILD_ITEM, children: [GRANDCHILD_ITEM] }],
      };
      const user = userEvent.setup();
      renderTasks([nodeWithDescendants], { folders: [FOLDER] });

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
      const nodeWithDescendants: ItemNode = {
        ...BASE_ITEM,
        children: [{ ...CHILD_ITEM, children: [GRANDCHILD_ITEM] }],
      };
      const user = userEvent.setup();
      renderTasks([nodeWithDescendants], { folders: [FOLDER] });

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
