import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

import type { TaskScope } from '@/lib/stores/tasks-store';
import { renderWithProviders } from '@/lib/test-utils';
import type { Item } from '@/lib/types';

import { CollapseAllButton } from './collapse-all-button';
import { TaskList } from './task-list';

const BASE_ITEM: Item = {
  id: 'item-1',
  title: 'Parent task',
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
  occurrence_index: null,
  recurrence: null,
  priority: null,
  recurrence_series_id: null,
  intended_project_id: null,
};

const CHILD_ITEM: Item = {
  ...BASE_ITEM,
  id: 'item-2',
  title: 'Child task',
  parent_id: 'item-1',
  created_at: '2025-01-01T11:00:00Z',
};

const GRANDCHILD_ITEM: Item = {
  ...BASE_ITEM,
  id: 'item-3',
  title: 'Grandchild task',
  parent_id: 'item-2',
  created_at: '2025-01-01T12:00:00Z',
};

const COMPLETED_CHILD: Item = {
  ...BASE_ITEM,
  id: 'item-2c',
  title: 'Done child',
  parent_id: 'item-1',
  status: 'completed',
  completed_at: '2025-01-02T09:00:00Z',
  created_at: '2025-01-01T09:00:00Z',
};

const INBOX: TaskScope = { type: 'inbox' };

/**
 * Render the button beside a TaskList in the SAME providers, so the button's collapseAll
 * reaches into the very rows the list renders — exactly how they're wired in a view header.
 */
function renderWithList(items: Item[], scope: TaskScope = INBOX) {
  return renderWithProviders(
    <>
      <CollapseAllButton scope={scope} />
      <TaskList scope={scope} />
    </>,
    { tasks: items },
  );
}

describe('CollapseAllButton', () => {
  it('is disabled when nothing in the view is expanded', () => {
    renderWithList([BASE_ITEM, CHILD_ITEM]);
    expect(screen.getByRole('button', { name: /collapse all/i })).toBeDisabled();
  });

  it('becomes enabled once a row is expanded', async () => {
    const user = userEvent.setup();
    renderWithList([BASE_ITEM, CHILD_ITEM]);

    await user.click(screen.getByRole('button', { name: /expand subtasks/i }));

    expect(screen.getByRole('button', { name: /collapse all/i })).toBeEnabled();
  });

  it('collapses an open subtree on click', async () => {
    const user = userEvent.setup();
    renderWithList([BASE_ITEM, CHILD_ITEM]);

    await user.click(screen.getByRole('button', { name: /expand subtasks/i }));
    expect(screen.getByRole('list', { name: 'Subtasks' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /collapse all/i }));

    expect(screen.queryByRole('list', { name: 'Subtasks' })).not.toBeInTheDocument();
  });

  it('collapses deeply-nested expansions, not just the top level', async () => {
    const user = userEvent.setup();
    renderWithList([BASE_ITEM, CHILD_ITEM, GRANDCHILD_ITEM]);

    // Expand the parent, then the now-visible child — two levels of open subtrees.
    await user.click(screen.getByRole('button', { name: /expand subtasks/i }));
    await user.click(screen.getByRole('button', { name: /expand subtasks/i }));
    expect(screen.getAllByRole('list', { name: 'Subtasks' })).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: /collapse all/i }));

    // Both levels leave the accessibility tree (collapsed rows stay mounted but aria-hidden,
    // so role queries — which respect aria-hidden — are the right probe here).
    expect(screen.queryAllByRole('list', { name: 'Subtasks' })).toHaveLength(0);
  });

  it('also closes an open "Show completed" panel (clears the completed flag)', async () => {
    const user = userEvent.setup();
    renderWithList([BASE_ITEM, CHILD_ITEM, COMPLETED_CHILD]);

    // Expand the parent, then reveal its completed children.
    await user.click(screen.getByRole('button', { name: /expand subtasks/i }));
    await user.click(screen.getByRole('button', { name: /show completed/i }));
    expect(screen.getByRole('list', { name: 'Completed subtasks' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /collapse all/i }));

    // Re-expand the parent: the completed panel must be closed again, proving collapseAll
    // cleared the completed flag too (not just the subtask tree). The toggle reads "Show
    // completed" rather than "Hide completed", and its list is back out of the a11y tree.
    await user.click(screen.getByRole('button', { name: /expand subtasks/i }));
    expect(screen.queryByRole('list', { name: 'Completed subtasks' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show completed/i })).toBeInTheDocument();
  });
});
