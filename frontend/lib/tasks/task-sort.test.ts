import {
  DEFAULT_TASK_SORT,
  TASK_SORT_OPTIONS,
  sortNodesBy,
  taskSortOption,
} from '@/lib/tasks/task-sort';
import type { ItemNode } from '@/lib/tree';
import type { Item } from '@/lib/types';

function task(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    title: id,
    notes: null,
    source_url: null,
    raw_capture: null,
    item_type: 'task',
    created_at: '2026-01-01T00:00:00Z',
    due_date: null,
    status: 'active',
    completed_at: null,
    folder_id: null,
    dispatched_at: null,
    parent_id: null,
    occurrence_index: null,
    priority: null,
    recurrence: null,
    recurrence_series_id: null,
    intended_project_id: null,
    sort_order: 0,
    ...overrides,
  };
}

function node(id: string, overrides: Partial<Item> = {}, children: ItemNode[] = []): ItemNode {
  return { ...task(id, overrides), children };
}

describe('the sort options', () => {
  it('offers Priority and Due date, in that order', () => {
    expect(TASK_SORT_OPTIONS.map((option) => option.value)).toStrictEqual(['priority', 'due']);
    expect(TASK_SORT_OPTIONS.map((option) => option.label)).toStrictEqual(['Priority', 'Due date']);
  });

  it('defaults to priority — the order a folder has always shown', () => {
    expect(DEFAULT_TASK_SORT).toBe('priority');
  });

  it('resolves each mode to its option', () => {
    expect(taskSortOption('priority').label).toBe('Priority');
    expect(taskSortOption('due').label).toBe('Due date');
  });
});

describe('sortNodesBy, in priority mode', () => {
  it('ranks by level first, so a High task with no date beats a Low one due today', () => {
    const tree = [
      node('low-due-soon', { priority: 'low', due_date: '2026-02-01' }),
      node('high-undated', { priority: 'high' }),
    ];

    expect(sortNodesBy(tree, 'priority').map((n) => n.id)).toStrictEqual([
      'high-undated',
      'low-due-soon',
    ]);
  });

  it('ranks High → Medium → Low → unprioritised, leaving each subtask group untouched', () => {
    const tree = [
      node('none'),
      node('low', { priority: 'low' }),
      node('high', { priority: 'high' }, [
        node('c-low', { priority: 'low', parent_id: 'high' }),
        node('c-high', { priority: 'high', parent_id: 'high' }),
      ]),
    ];

    const sorted = sortNodesBy(tree, 'priority');

    expect(sorted.map((n) => n.id)).toStrictEqual(['high', 'low', 'none']);
    // A subtask group keeps the order buildTree gave it (its sort_order) — priority is a display
    // signal on a subtask row, not a re-ordering one.
    expect(sorted[0]?.children.map((child) => child.id)).toStrictEqual(['c-low', 'c-high']);
  });

  it('ranks by each node OWN priority (no subtree rollup) — a Low parent stays below Medium', () => {
    const tree = [
      node('medium', { priority: 'medium' }),
      node('low-parent', { priority: 'low' }, [
        node('child', { priority: 'high', parent_id: 'low-parent' }),
      ]),
    ];

    expect(sortNodesBy(tree, 'priority').map((n) => n.id)).toStrictEqual(['medium', 'low-parent']);
  });
});

describe('sortNodesBy, in due-date mode', () => {
  it('ranks by date first, so a Low task due today beats a High one due next month', () => {
    const tree = [
      node('high-later', { priority: 'high', due_date: '2026-03-01' }),
      node('low-sooner', { priority: 'low', due_date: '2026-02-01' }),
    ];

    expect(sortNodesBy(tree, 'due').map((n) => n.id)).toStrictEqual(['low-sooner', 'high-later']);
  });

  it('sinks undated tasks below every dated one, whatever their priority', () => {
    const tree = [
      node('high-undated', { priority: 'high' }),
      node('undated'),
      node('dated', { due_date: '2099-12-31' }),
    ];

    expect(sortNodesBy(tree, 'due').map((n) => n.id)).toStrictEqual([
      'dated',
      'high-undated',
      'undated',
    ]);
  });

  it('breaks a same-day tie by priority', () => {
    const tree = [
      node('none', { due_date: '2026-02-01' }),
      node('low', { due_date: '2026-02-01', priority: 'low' }),
      node('high', { due_date: '2026-02-01', priority: 'high' }),
      node('medium', { due_date: '2026-02-01', priority: 'medium' }),
    ];

    expect(sortNodesBy(tree, 'due').map((n) => n.id)).toStrictEqual([
      'high',
      'medium',
      'low',
      'none',
    ]);
  });

  it('breaks a date-and-priority tie by creation order, oldest first', () => {
    const tree = [
      node('newer', { due_date: '2026-02-01', created_at: '2026-01-02T00:00:00Z' }),
      node('older', { due_date: '2026-02-01', created_at: '2026-01-01T00:00:00Z' }),
    ];

    expect(sortNodesBy(tree, 'due').map((n) => n.id)).toStrictEqual(['older', 'newer']);
  });

  it('leaves every subtask group exactly as received', () => {
    const tree = [
      node('root', { due_date: '2026-02-01' }, [
        node('second-child', { due_date: '2026-01-01', parent_id: 'root' }),
        node('first-child', { due_date: '2026-12-31', parent_id: 'root' }),
      ]),
    ];

    expect(sortNodesBy(tree, 'due')[0]?.children.map((child) => child.id)).toStrictEqual([
      'second-child',
      'first-child',
    ]);
  });
});
