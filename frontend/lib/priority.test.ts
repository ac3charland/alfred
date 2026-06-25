import {
  type TaskPriority,
  bestKey,
  compareKey,
  isPriorityLevel,
  ownKey,
  priorityOption,
  priorityRank,
  rankByPriority,
  sortNodesByPriority,
} from '@/lib/priority';
import { stableSorted } from '@/lib/sort';
import type { ItemNode } from '@/lib/tree';
import type { Item } from '@/lib/types';

/** A minimal item carrying only the fields the priority key reads. */
function item(priority: TaskPriority | null, due_date: string | null): Item {
  return {
    id: 'i',
    title: 't',
    notes: null,
    source_url: null,
    raw_capture: null,
    item_type: 'task',
    created_at: '2026-01-01T00:00:00Z',
    due_date,
    status: 'active',
    completed_at: null,
    folder_id: null,
    parent_id: null,
    occurrence_index: null,
    priority,
    recurrence: null,
    recurrence_series_id: null,
  };
}

describe('priorityRank', () => {
  it('ranks high < medium < low < null (unprioritised last)', () => {
    expect(priorityRank('high')).toBe(0);
    expect(priorityRank('medium')).toBe(1);
    expect(priorityRank('low')).toBe(2);
    expect(priorityRank(null)).toBe(3);
  });

  it('ranks a missing priority (undefined) last, like null', () => {
    // A row whose `priority` the read layer never surfaced arrives as `undefined`, not `null`;
    // it must still rank as unprioritised rather than producing a NaN rank that scrambles order.
    expect(priorityRank(undefined)).toBe(3);
  });
});

describe('isPriorityLevel', () => {
  it('is true only for a real level, false for null and undefined', () => {
    expect(isPriorityLevel('high')).toBe(true);
    expect(isPriorityLevel('medium')).toBe(true);
    expect(isPriorityLevel('low')).toBe(true);
    expect(isPriorityLevel(null)).toBe(false);
    expect(isPriorityLevel(undefined)).toBe(false);
  });
});

describe('priorityOption', () => {
  it('maps each level to its label', () => {
    expect(priorityOption('high')?.label).toBe('High');
    expect(priorityOption('medium')?.label).toBe('Medium');
    expect(priorityOption('low')?.label).toBe('Low');
  });

  it('returns undefined for null or a missing (undefined) priority instead of throwing', () => {
    // The crash this guards: a `task_items` row without a `priority` column → `undefined` →
    // a blind `const { label } = priorityOption(value)` white-screens the whole list.
    expect(priorityOption(null)).toBeUndefined();
    expect(priorityOption(undefined)).toBeUndefined();
  });
});

describe('ownKey', () => {
  it('reads the rank from priority and the due as a parsed timestamp', () => {
    const key = ownKey(item('medium', '2026-06-25'));
    expect(key.rank).toBe(1);
    expect(key.due).toBe(Date.parse('2026-06-25'));
  });

  it('uses Infinity for the due when there is no due date', () => {
    expect(ownKey(item('high', null)).due).toBe(Infinity);
  });
});

describe('bestKey', () => {
  it('picks the higher priority level regardless of due date', () => {
    const high = ownKey(item('high', null)); // no due date
    const low = ownKey(item('low', '2026-01-01')); // earlier due, lower level
    expect(bestKey(high, low)).toBe(high);
    expect(bestKey(low, high)).toBe(high);
  });

  it('within the same level, picks the earlier due date', () => {
    const earlier = ownKey(item('medium', '2026-06-01'));
    const later = ownKey(item('medium', '2026-06-30'));
    expect(bestKey(earlier, later)).toBe(earlier);
    expect(bestKey(later, earlier)).toBe(earlier);
  });
});

describe('compareKey', () => {
  it('orders by level first (high → medium → low → unprioritised)', () => {
    const keys = [
      item(null, null),
      item('low', null),
      item('high', null),
      item('medium', null),
    ].map((i) => ownKey(i));
    const order = stableSorted(keys, compareKey);
    expect(order.map((k) => k.rank)).toStrictEqual([0, 1, 2, 3]);
  });

  it('within a level, orders earlier due first and no-due last', () => {
    const dated = ownKey(item('high', '2026-06-10'));
    const earlier = ownKey(item('high', '2026-06-01'));
    const noDue = ownKey(item('high', null));
    expect(stableSorted([dated, noDue, earlier], compareKey)).toStrictEqual([
      earlier,
      dated,
      noDue,
    ]);
  });
});

/** A full Item with task-relevant overrides for the ranking tests. */
function task(id: string, overrides: Partial<Item> = {}): Item {
  return {
    ...item(overrides.priority ?? null, overrides.due_date ?? null),
    id,
    title: id,
    status: overrides.status ?? 'active',
    parent_id: overrides.parent_id ?? null,
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
  };
}

describe('rankByPriority', () => {
  it('lists top-level tasks only, ordered High → Medium → Low → unprioritised', () => {
    const ranked = rankByPriority(
      [
        task('none'),
        task('low', { priority: 'low' }),
        task('high', { priority: 'high' }),
        task('medium', { priority: 'medium' }),
        task('sub', { priority: 'low', parent_id: 'high' }), // a subtask, not its own row
      ],
      false,
    );
    expect(ranked.map((t) => t.id)).toStrictEqual(['high', 'medium', 'low', 'none']);
  });

  it('rolls a High/overdue ACTIVE subtask up so its Low parent outranks a Medium task', () => {
    const ranked = rankByPriority(
      [
        task('medium', { priority: 'medium' }),
        task('lowParent', { priority: 'low' }),
        task('urgentChild', { priority: 'high', due_date: '2026-06-01', parent_id: 'lowParent' }),
      ],
      false,
    );
    expect(ranked.map((t) => t.id)).toStrictEqual(['lowParent', 'medium']);
  });

  it('does NOT let a completed subtask lift its parent', () => {
    const ranked = rankByPriority(
      [
        task('medium', { priority: 'medium' }),
        task('lowParent', { priority: 'low' }),
        task('doneChild', { priority: 'high', status: 'completed', parent_id: 'lowParent' }),
      ],
      false,
    );
    expect(ranked.map((t) => t.id)).toStrictEqual(['medium', 'lowParent']);
  });

  it('hides completed top-level tasks unless showCompleted is set', () => {
    const items = [
      task('active', { priority: 'high' }),
      task('done', { priority: 'high', status: 'completed' }),
    ];
    expect(rankByPriority(items, false).map((t) => t.id)).toStrictEqual(['active']);
    expect(rankByPriority(items, true).map((t) => t.id)).toStrictEqual(['active', 'done']);
  });
});

/** A tree node with task-relevant overrides for the recursive sorter. */
function node(id: string, overrides: Partial<Item> = {}, children: ItemNode[] = []): ItemNode {
  return { ...task(id, overrides), children };
}

describe('sortNodesByPriority', () => {
  it('ranks each sibling group by priority → due → created_at at every level', () => {
    const tree = [
      node('none'),
      node('low', { priority: 'low' }),
      node('high', { priority: 'high' }, [
        node('c-low', { priority: 'low', parent_id: 'high' }),
        node('c-high', { priority: 'high', parent_id: 'high' }),
      ]),
    ];
    const sorted = sortNodesByPriority(tree);
    expect(sorted.map((n) => n.id)).toStrictEqual(['high', 'low', 'none']);
    expect(sorted[0]?.children.map((c) => c.id)).toStrictEqual(['c-high', 'c-low']);
  });

  it('ranks by each node OWN priority (no subtree rollup) — a Low parent stays below Medium', () => {
    const tree = [
      node('medium', { priority: 'medium' }),
      node('lowParent', { priority: 'low' }, [
        node('child', { priority: 'high', parent_id: 'lowParent' }),
      ]),
    ];
    expect(sortNodesByPriority(tree).map((n) => n.id)).toStrictEqual(['medium', 'lowParent']);
  });
});
