import type { Item } from '@/lib/types';

import { taskDestination } from './task-location';

/** Fixed residency stamp for a seeded FILED item — fixtures pin the clock, never read it. */
const DISPATCHED_AT = '2026-01-02T00:00:00Z';

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
    // A fixture with a folder is a filed item, so it defaults to dispatched. Tested against
    // `undefined` rather than `??`, so a fixture can state `dispatched_at: null` explicitly and
    // seed a foldered item that is still in the Inbox.
    dispatched_at:
      overrides.dispatched_at === undefined
        ? overrides.folder_id == null
          ? null
          : DISPATCHED_AT
        : overrides.dispatched_at,
    parent_id: overrides.parent_id ?? null,
    occurrence_index: null,
    priority: null,
    recurrence: null,
    recurrence_series_id: null,
    intended_project_id: null,
    sort_order: 0,
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

  it('routes an undispatched task to the Inbox even when it already carries a folder', () => {
    // The folder says where it would land; residency says where it renders today.
    const item = makeItem({ folder_id: 'f1', dispatched_at: null });
    expect(taskDestination(item, [item])).toBe('/?view=inbox');
  });

  it('routes a subtask of an undispatched root to the Inbox', () => {
    const root = makeItem({ id: 'root', folder_id: 'f9', dispatched_at: null });
    const child = makeItem({
      id: 'child',
      parent_id: 'root',
      folder_id: 'f9',
      dispatched_at: null,
    });
    expect(taskDestination(child, [root, child])).toBe('/?view=inbox');
  });

  it('bails to the inbox when a subtask has a broken (missing) parent chain', () => {
    const orphan = makeItem({ id: 'orphan', parent_id: 'gone', folder_id: null });
    expect(taskDestination(orphan, [orphan])).toBe('/?view=inbox');
  });
});
