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
  weekly_plan_id: null,
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

/**
 * The Week plan badge is `RowMetaCluster`'s own gate — a planned TOP-LEVEL item of any type
 * carries it, a subtask never does — plus the `hasMeta` term that keeps a row whose ONLY
 * metadata is the badge from collapsing its footer. Where such rows appear (the Inbox, folder
 * views, Completed, select mode) is covered in task-row.test.tsx.
 */
describe('RowMetaCluster — the Week plan badge', () => {
  const PLANNED: ItemNode = { ...BASE_NODE, weekly_plan_id: 'plan-1' };

  function renderCluster(node: ItemNode, showTypeBadge = false) {
    return render(
      <RowMetaCluster
        node={node}
        isTask={node.item_type === 'task'}
        isTopLevelTask={node.item_type === 'task' && node.parent_id === null}
        recurrenceRule={null}
        showTypeBadge={showTypeBadge}
        showReadyPip={false}
      />,
    );
  }

  it('renders on a planned top-level item', () => {
    renderCluster(PLANNED);

    expect(screen.getByLabelText('Week plan item')).toBeInTheDocument();
  });

  it('renders on a planned item of any type, not only a task', () => {
    for (const itemType of ['task', 'code', 'unclassified'] as const) {
      const view = renderCluster({ ...PLANNED, item_type: itemType });
      expect(screen.getByLabelText('Week plan item')).toBeInTheDocument();
      view.unmount();
    }
  });

  it('does not render on a child — the badge marks the planned item, not what sits under it', () => {
    renderCluster({ ...PLANNED, parent_id: 'root-1' });

    expect(screen.queryByLabelText('Week plan item')).not.toBeInTheDocument();
  });

  it('does not render on an item that came from no plan', () => {
    renderCluster(BASE_NODE);

    expect(screen.queryByLabelText('Week plan item')).not.toBeInTheDocument();
  });

  it('renders the footer when the badge is its only metadata', () => {
    // The unclassified planned row: no type badge outside select mode, no due date, no
    // priority, no children. Without its own `hasMeta` term the whole footer would collapse.
    const { container } = renderCluster({ ...PLANNED, item_type: 'unclassified' });

    expect(container).not.toBeEmptyDOMElement();
    expect(screen.getByLabelText('Week plan item')).toBeInTheDocument();
  });

  it('sits directly after the Type badge', () => {
    renderCluster(PLANNED, true);

    const cluster = screen.getByLabelText('Week plan item').parentElement;
    const [first, second] = [...(cluster?.children ?? [])];
    expect(first).toHaveTextContent('Task');
    expect(second).toHaveTextContent('Week plan');
  });

  it('is a non-interactive span, so the select-mode row stays one button', () => {
    renderCluster(PLANNED);

    expect(screen.getByLabelText('Week plan item').tagName).toBe('SPAN');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
