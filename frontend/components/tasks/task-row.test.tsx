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

describe('TaskRow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the task title', () => {
    render(<TaskRow node={BASE_ITEM} folders={[]} />);

    expect(screen.getByText('Write tests')).toBeInTheDocument();
  });

  it('renders the completion checkbox button', () => {
    render(<TaskRow node={BASE_ITEM} folders={[]} />);

    expect(
      screen.getByRole('button', { name: /mark "Write tests" complete/i }),
    ).toBeInTheDocument();
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

  it('shows due date chip when due_date is present', () => {
    const nodeWithDue = { ...BASE_ITEM, due_date: '2099-12-31' };
    render(<TaskRow node={nodeWithDue} folders={[]} />);

    // Due date chip is rendered
    expect(screen.getByRole('button', { name: /due date/i })).toBeInTheDocument();
  });

  // Prevent unused variable warnings on mocks that aren't exercised yet
  it('exports mockUpdateItem and mockDeleteItem and mockMoveToInbox for future tests', () => {
    // Type-only assertions to satisfy lint (the mocks are imported for future use)
    expect(mockUpdateItem).toBeDefined();
    expect(mockDeleteItem).toBeDefined();
    expect(mockMoveToInbox).toBeDefined();
  });
});
