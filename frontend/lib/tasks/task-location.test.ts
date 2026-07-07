import type { Item } from '@/lib/types';

import { taskDestination } from './task-location';

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: overrides.id ?? 'i1',
    title: overrides.title ?? 'A task',
    notes: null,
    source_url: null,
    raw_capture: null,
    item_type: 'task',
    created_at: '2026-01-01T00:00:00Z',
    due_date: null,
    status: overrides.status ?? 'active',
    completed_at: null,
    folder_id: overrides.folder_id ?? null,
    parent_id: overrides.parent_id ?? null,
    occurrence_index: null,
    priority: null,
    recurrence: null,
    recurrence_series_id: null,
    intended_project_id: null,
  };
}

describe('taskDestination', () => {
  it('routes a completed task to the Completed view', () => {
    const item = makeItem({ status: 'completed', folder_id: 'f1' });
    expect(taskDestination(item, [item])).toBe('/completed');
  });

  it('routes a foldered task to its folder', () => {
    const item = makeItem({ folder_id: 'f1' });
    expect(taskDestination(item, [item])).toBe('/folders/f1');
  });

  it('routes an inbox task to the revealed inbox', () => {
    const item = makeItem({ folder_id: null });
    expect(taskDestination(item, [item])).toBe('/?view=inbox');
  });

  it('resolves a subtask to its top-level ancestor view', () => {
    const root = makeItem({ id: 'root', folder_id: 'f9' });
    const child = makeItem({ id: 'child', parent_id: 'root', folder_id: 'f9' });
    const grandchild = makeItem({ id: 'gc', parent_id: 'child', folder_id: 'f9' });
    expect(taskDestination(grandchild, [root, child, grandchild])).toBe('/folders/f9');
  });

  it('bails to the inbox when a subtask has a broken (missing) parent chain', () => {
    const orphan = makeItem({ id: 'orphan', parent_id: 'gone', folder_id: null });
    expect(taskDestination(orphan, [orphan])).toBe('/?view=inbox');
  });
});
