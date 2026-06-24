import { screen } from '@testing-library/react';
import * as React from 'react';

import { renderWithProviders } from '@/lib/test-utils';
import type { Item } from '@/lib/types';

import { CompletedView } from './completed-view';

let lastTaskListScope: unknown;
let lastEmptyMessage: string | undefined;
jest.mock('./task-list', () => ({
  TaskList: function MockTaskList({
    emptyMessage,
    scope,
  }: {
    emptyMessage?: string;
    scope?: unknown;
  }) {
    lastTaskListScope = scope;
    lastEmptyMessage = emptyMessage;
    return <div data-testid="task-list">{emptyMessage}</div>;
  },
}));

const makeItem = (id: string, status: Item['status']): Item => ({
  id,
  title: id,
  notes: null,
  source_url: null,
  item_type: 'task',
  created_at: '2025-01-01T00:00:00Z',
  raw_capture: null,
  due_date: null,
  status,
  completed_at: status === 'completed' ? '2025-01-02T00:00:00Z' : null,
  folder_id: null,
  parent_id: null,
  occurrence_index: null,
  recurrence: null,
  priority: null,
  recurrence_series_id: null,
});

describe('CompletedView', () => {
  it('renders the Completed eyebrow label', () => {
    renderWithProviders(<CompletedView />, { tasks: [] });

    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('renders the count of completed tasks from the store', () => {
    renderWithProviders(<CompletedView />, {
      tasks: [makeItem('a', 'completed'), makeItem('b', 'completed'), makeItem('c', 'active')],
    });

    expect(screen.getByText('2 completed tasks')).toBeInTheDocument();
  });

  it('renders a TaskList scoped to completed with its empty message', () => {
    renderWithProviders(<CompletedView />, { tasks: [] });

    expect(lastTaskListScope).toEqual({ type: 'completed' });
    expect(lastEmptyMessage).toBe('Nothing completed yet');
  });
});
