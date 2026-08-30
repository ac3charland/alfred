import { render, screen } from '@testing-library/react';

import { renderWithProviders } from '@/lib/test-utils';
import type { ItemNode } from '@/lib/tree';
import type { Folder } from '@/lib/types';

import { RowMetaCluster } from './row-meta-cluster';

const BASE_NODE: ItemNode = {
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
  dispatched_at: null,
  parent_id: null,
  occurrence_index: null,
  recurrence: null,
  priority: null,
  recurrence_series_id: null,
  intended_project_id: null,
  intended_epic_id: null,
  sort_order: 0,
  classified_at: null,
  classified_provider: null,
  classified_model: null,
  classified_prompt_version: null,
  classified_guess: null,
  classify_attempts: 0,
  children: [],
};

const HEALTH: Folder = {
  description: null,
  id: 'f1',
  name: 'Health',
  created_at: '2025-01-01T09:00:00Z',
  sort_order: 1,
};

/**
 * ALF-178: the dispatch-ready pip is `RowMetaCluster`'s own concern — the `hasMeta` term that
 * keeps a bare-ready row's footer from collapsing, and the LAST-child position that makes the
 * cue align down a list. The row's own gating (which rows may pass `showReadyPip: true` at all)
 * is covered where it's decided, in task-row.test.tsx.
 */
describe('RowMetaCluster — dispatch-ready pip', () => {
  it('renders nothing when the row carries no metadata and is not ready', () => {
    const { container } = render(
      <RowMetaCluster
        node={BASE_NODE}
        isTask
        isTopLevelTask
        recurrenceRule={null}
        showTypeBadge={false}
        showReadyPip={false}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the cluster when the pip is its only content', () => {
    render(
      <RowMetaCluster
        node={BASE_NODE}
        isTask
        isTopLevelTask
        recurrenceRule={null}
        showTypeBadge={false}
        showReadyPip
      />,
    );

    expect(screen.getByRole('img', { name: 'Ready to dispatch' })).toBeInTheDocument();
  });

  it('is the LAST child of the cluster, after the type badge and folder chip', () => {
    renderWithProviders(
      <RowMetaCluster
        node={{ ...BASE_NODE, folder_id: HEALTH.id }}
        isTask
        isTopLevelTask
        recurrenceRule={null}
        showTypeBadge
        showReadyPip
      />,
      { folders: [HEALTH] },
    );

    const pip = screen.getByRole('img', { name: 'Ready to dispatch' });
    expect(pip.parentElement?.lastElementChild).toBe(pip);
    // Sanity: the other metadata really did render ahead of it.
    expect(screen.getByText('Task')).toBeInTheDocument();
    expect(screen.getByText('Health')).toBeInTheDocument();
  });

  it('is absent from an otherwise-identical row that is not ready', () => {
    renderWithProviders(
      <RowMetaCluster
        node={{ ...BASE_NODE, folder_id: HEALTH.id }}
        isTask
        isTopLevelTask
        recurrenceRule={null}
        showTypeBadge
        showReadyPip={false}
      />,
      { folders: [HEALTH] },
    );

    expect(screen.queryByRole('img', { name: 'Ready to dispatch' })).not.toBeInTheDocument();
    // The rest of the cluster is unaffected by the flag.
    expect(screen.getByText('Health')).toBeInTheDocument();
  });
});
