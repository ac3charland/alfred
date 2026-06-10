'use client';

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import type { ItemNode } from '@/lib/tree';

import { TaskRow } from './task-row';

// Mock next/navigation
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter() {
    return { refresh: mockRefresh };
  },
}));

// Mock api-client
jest.mock('@/lib/api-client');
const mockCompleteTask = jest.mocked(apiClient.completeTask);
const mockUpdateItem = jest.mocked(apiClient.updateItem);
const mockDeleteItem = jest.mocked(apiClient.deleteItem);
const mockMoveToInbox = jest.mocked(apiClient.moveToInbox);

const DB_NULL = undefined as unknown as null;

const BASE_ITEM: ItemNode = {
  id: 'item-1',
  title: 'Write tests',
  notes: DB_NULL,
  source_url: DB_NULL,
  item_type: 'task',
  created_at: '2025-01-01T10:00:00Z',
  raw_capture: DB_NULL,
  due_date: DB_NULL,
  status: 'active',
  completed_at: DB_NULL,
  folder_id: DB_NULL,
  parent_id: DB_NULL,
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

const FOLDER = { id: 'folder-1', name: 'Work', created_at: '2025-01-01T09:00:00Z' };

describe('TaskRow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the task title', () => {
    render(<TaskRow node={BASE_ITEM} folders={[]} />);

    expect(screen.getByText('Write tests')).toBeInTheDocument();
  });

  it('renders the completion checkbox with "complete" label for active tasks', () => {
    render(<TaskRow node={BASE_ITEM} folders={[]} />);

    expect(
      screen.getByRole('button', { name: /mark "Write tests" complete/i }),
    ).toBeInTheDocument();
  });

  it('renders checkbox with "active" label when isCompleted is true', () => {
    render(<TaskRow node={BASE_ITEM} folders={[]} isCompleted />);

    expect(screen.getByRole('button', { name: /mark "Write tests" active/i })).toBeInTheDocument();
  });

  it('renders checkbox as checked (teal fill) when isCompleted is true', () => {
    render(<TaskRow node={BASE_ITEM} folders={[]} isCompleted />);

    const checkbox = screen.getByRole('button', { name: /mark "Write tests" active/i });
    expect(checkbox).toHaveClass('bg-accent-teal');
  });

  it('expand/collapse toggle is invisible when there are no children', () => {
    render(<TaskRow node={BASE_ITEM} folders={[]} />);

    const toggle = screen.getByRole('button', { name: /expand subtasks/i });
    // The button is invisible via the 'invisible pointer-events-none' CSS classes
    expect(toggle).toHaveClass('invisible');
  });

  it('expand toggle is visible when node has children', () => {
    const nodeWithChild = { ...BASE_ITEM, children: [CHILD_ITEM] };
    render(<TaskRow node={nodeWithChild} folders={[]} />);

    const toggle = screen.getByRole('button', { name: /expand subtasks/i });
    expect(toggle).not.toHaveClass('invisible');
  });

  it('shows child tasks when the expand toggle is clicked', async () => {
    const nodeWithChild = { ...BASE_ITEM, children: [CHILD_ITEM] };
    const user = userEvent.setup();
    render(<TaskRow node={nodeWithChild} folders={[]} />);

    await user.click(screen.getByRole('button', { name: /expand subtasks/i }));

    expect(screen.getByText('Write unit tests')).toBeInTheDocument();
  });

  it('hides child tasks when expanded and then collapsed', async () => {
    const nodeWithChild = { ...BASE_ITEM, children: [CHILD_ITEM] };
    const user = userEvent.setup();
    render(<TaskRow node={nodeWithChild} folders={[]} />);

    const toggle = screen.getByRole('button', { name: /expand subtasks/i });
    await user.click(toggle);
    expect(screen.getByText('Write unit tests')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /collapse subtasks/i }));
    expect(screen.queryByText('Write unit tests')).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Active task completion — optimistic dismiss
  // ---------------------------------------------------------------------------

  it('dismisses the task immediately on checkbox click before API resolves', async () => {
    mockCompleteTask.mockReturnValue(Promise.race([]));

    const user = userEvent.setup();
    render(<TaskRow node={BASE_ITEM} folders={[]} />);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));

    expect(screen.queryByText('Write tests')).not.toBeInTheDocument();
  });

  it('calls completeTask and refreshes when checkbox is clicked (no children)', async () => {
    mockCompleteTask.mockResolvedValue([]);

    const user = userEvent.setup();
    render(<TaskRow node={BASE_ITEM} folders={[]} />);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));

    await waitFor(() => {
      expect(mockCompleteTask).toHaveBeenCalledWith('item-1');
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it('restores the task when completeTask fails', async () => {
    mockCompleteTask.mockRejectedValue(new Error('Network error'));

    const user = userEvent.setup();
    render(<TaskRow node={BASE_ITEM} folders={[]} />);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));

    // Task should reappear after the API error
    expect(await screen.findByText('Write tests')).toBeInTheDocument();
  });

  it('opens the cascade modal when checkbox is clicked on a task with children', async () => {
    const nodeWithChild = { ...BASE_ITEM, children: [CHILD_ITEM] };
    const user = userEvent.setup();
    render(<TaskRow node={nodeWithChild} folders={[]} />);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));

    // Cascade modal title should appear
    expect(await screen.findByText(/complete with subtasks/i)).toBeInTheDocument();
  });

  it('does NOT call completeTask directly when cascade modal opens', async () => {
    const nodeWithChild = { ...BASE_ITEM, children: [CHILD_ITEM] };
    const user = userEvent.setup();
    render(<TaskRow node={nodeWithChild} folders={[]} />);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" complete/i }));
    // Modal is open; completeTask should not have been called yet
    await screen.findByText(/complete with subtasks/i);

    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Completed task (isCompleted) — uncomplete
  // ---------------------------------------------------------------------------

  it('calls updateItem with status:active and refreshes when uncompleting', async () => {
    mockUpdateItem.mockResolvedValue({ ...BASE_ITEM, status: 'completed' });

    const user = userEvent.setup();
    render(<TaskRow node={BASE_ITEM} folders={[]} isCompleted />);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" active/i }));

    await waitFor(() => {
      expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { status: 'active' });
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it('dismisses the task immediately when uncompleting before API resolves', async () => {
    mockUpdateItem.mockReturnValue(Promise.race([]));

    const user = userEvent.setup();
    render(<TaskRow node={BASE_ITEM} folders={[]} isCompleted />);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" active/i }));

    expect(screen.queryByText('Write tests')).not.toBeInTheDocument();
  });

  it('restores the task when updateItem fails while uncompleting', async () => {
    mockUpdateItem.mockRejectedValue(new Error('Network error'));

    const user = userEvent.setup();
    render(<TaskRow node={BASE_ITEM} folders={[]} isCompleted />);

    await user.click(screen.getByRole('button', { name: /mark "Write tests" active/i }));

    // Task should reappear after the API error
    expect(await screen.findByText('Write tests')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Other
  // ---------------------------------------------------------------------------

  it('shows due date chip when due_date is present', () => {
    const nodeWithDue = { ...BASE_ITEM, due_date: '2099-12-31' };
    render(<TaskRow node={nodeWithDue} folders={[]} />);

    // Due date chip is rendered
    expect(screen.getByRole('button', { name: /due date/i })).toBeInTheDocument();
  });

  describe('move to folder', () => {
    // Radix DropdownMenu portals set pointer-events:none on the body, which blocks
    // userEvent.click() on portal items. Keyboard navigation bypasses this.
    //
    // Focus lands on the menu container after open (not the first item), so:
    //   ArrowDown×1 moves to the first item ("Set due date")
    //   ArrowDown×2 moves to the second item ("Add notes")
    //   ArrowDown×3 reaches "Move to…" (the SubTrigger)
    //   ArrowRight opens the submenu with "Inbox" auto-focused
    //   ArrowDown optionally moves to the next folder, Enter selects

    it('calls updateItem once when moving a leaf task to a folder', async () => {
      mockUpdateItem.mockResolvedValue(BASE_ITEM);
      const user = userEvent.setup();
      render(<TaskRow node={BASE_ITEM} folders={[FOLDER]} />);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][ArrowDown][ArrowRight][ArrowDown][Enter]');

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledTimes(1);
        expect(mockRefresh).toHaveBeenCalled();
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
      render(<TaskRow node={nodeWithDescendants} folders={[FOLDER]} />);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][ArrowDown][ArrowRight][ArrowDown][Enter]');

      await waitFor(() => {
        expect(mockUpdateItem).toHaveBeenCalledTimes(3);
        expect(mockRefresh).toHaveBeenCalled();
      });
      expect(mockUpdateItem).toHaveBeenCalledWith('item-3', { folder_id: 'folder-1' });
      expect(mockUpdateItem).toHaveBeenCalledWith('item-2', { folder_id: 'folder-1' });
      expect(mockUpdateItem).toHaveBeenCalledWith('item-1', { folder_id: 'folder-1' });
    });

    it('calls moveToInbox once when moving a leaf task to the inbox', async () => {
      mockMoveToInbox.mockResolvedValue(BASE_ITEM);
      const user = userEvent.setup();
      render(<TaskRow node={BASE_ITEM} folders={[FOLDER]} />);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][ArrowDown][ArrowRight][Enter]');

      await waitFor(() => {
        expect(mockMoveToInbox).toHaveBeenCalledTimes(1);
        expect(mockRefresh).toHaveBeenCalled();
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
      render(<TaskRow node={nodeWithDescendants} folders={[FOLDER]} />);

      await user.click(screen.getByRole('button', { name: /more actions/i }));
      await screen.findByRole('menu');
      await user.keyboard('[ArrowDown][ArrowDown][ArrowDown][ArrowRight][Enter]');

      await waitFor(() => {
        expect(mockMoveToInbox).toHaveBeenCalledTimes(3);
        expect(mockRefresh).toHaveBeenCalled();
      });
      expect(mockMoveToInbox).toHaveBeenCalledWith('item-3');
      expect(mockMoveToInbox).toHaveBeenCalledWith('item-2');
      expect(mockMoveToInbox).toHaveBeenCalledWith('item-1');
    });
  });

  // Prevent unused variable warning on mockDeleteItem — available for delete tests
  it('exports mockDeleteItem for future tests', () => {
    expect(mockDeleteItem).toBeDefined();
  });
});
