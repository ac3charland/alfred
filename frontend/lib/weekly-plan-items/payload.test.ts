import type { CodeFactoryState, Item } from '@/lib/types';

import type { WeeklyPlanCodeSidecar } from './payload';
import { toWeeklyPlanItemsPayload } from './payload';

const PLAN = { id: 'plan-1', uploaded_at: '2026-09-05T21:03:11.482Z' };

/** An `items` row with everything the cohort read doesn't care about already at its default. */
function row(overrides: Partial<Item> & Pick<Item, 'id' | 'title'>): Item {
  return {
    notes: null,
    source_url: null,
    item_type: 'task',
    created_at: '2026-09-05T21:04:02.118Z',
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
    weekly_plan_id: PLAN.id,
    ...overrides,
  };
}

function sidecar(
  itemId: string,
  factoryState: CodeFactoryState,
  doneAt: string | null = null,
): WeeklyPlanCodeSidecar {
  return {
    item_id: itemId,
    ref: 'RPL-142',
    lane: 'human',
    factory_state: factoryState,
    done_at: doneAt,
  };
}

/** The payload for a cohort of `items`, with no folders and no factory sidecars. */
function payloadOf(items: Item[]) {
  return toWeeklyPlanItemsPayload({ plan: PLAN, items, folders: [], code: [] });
}

describe('toWeeklyPlanItemsPayload — shape and ordering', () => {
  it('nests children under their root and reports the plan it resolved', () => {
    const result = payloadOf([
      row({ id: 'child-b', title: 'Second subtask', parent_id: 'root', sort_order: 2 }),
      row({ id: 'root', title: 'Ship the spike' }),
      row({ id: 'child-a', title: 'First subtask', parent_id: 'root', sort_order: 1 }),
    ]);

    expect(result.plan).toStrictEqual(PLAN);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe('Ship the spike');
    expect(result.items[0]?.children.map((child) => child.title)).toStrictEqual([
      'First subtask',
      'Second subtask',
    ]);
  });

  it('orders roots newest-created first — the order the batch was sent in', () => {
    const result = payloadOf([
      row({ id: 'b', title: 'second sent', created_at: '2026-09-05T21:04:02.117Z' }),
      row({ id: 'a', title: 'first sent', created_at: '2026-09-05T21:04:02.118Z' }),
      row({ id: 'c', title: 'third sent', created_at: '2026-09-05T21:04:02.116Z' }),
    ]);

    expect(result.items.map((item) => item.title)).toStrictEqual([
      'first sent',
      'second sent',
      'third sent',
    ]);
  });

  it('reports an orphan child as a root rather than dropping it', () => {
    // The owner deleted the parent; the subtask is still real work the review planned.
    const result = payloadOf([row({ id: 'orphan', title: 'Survivor', parent_id: 'deleted' })]);

    expect(result.items.map((item) => item.title)).toStrictEqual(['Survivor']);
  });

  it('resolves the folder an item was filed into, and null while it carries none', () => {
    const result = toWeeklyPlanItemsPayload({
      plan: PLAN,
      items: [
        row({
          id: 'filed',
          title: 'Filed',
          folder_id: 'f1',
          dispatched_at: '2026-09-07T10:00:00Z',
        }),
        row({ id: 'bare', title: 'Bare' }),
      ],
      folders: [{ id: 'f1', name: 'RealPlay' }],
      code: [],
    });

    const [bare, filed] = [result.items[1], result.items[0]];
    expect(filed?.folder).toStrictEqual({ id: 'f1', name: 'RealPlay' });
    expect(filed?.in_inbox).toBe(false);
    expect(bare?.folder).toBeNull();
    expect(bare?.in_inbox).toBe(true);
  });

  it('carries the item fields a review quotes', () => {
    const result = payloadOf([
      row({
        id: 'a',
        title: 'Ship the spike',
        notes: 'Timebox to Tuesday morning',
        due_date: '2026-09-08',
        priority: 'high',
      }),
    ]);

    expect(result.items[0]).toMatchObject({
      id: 'a',
      item_type: 'task',
      title: 'Ship the spike',
      notes: 'Timebox to Tuesday morning',
      due_date: '2026-09-08',
      priority: 'high',
      created_at: '2026-09-05T21:04:02.118Z',
    });
  });

  it('never surfaces the raw status / completed_at columns at the top level', () => {
    const result = payloadOf([row({ id: 'a', title: 'x', status: 'completed' })]);

    expect(result.items[0]).not.toHaveProperty('status');
    expect(result.items[0]).not.toHaveProperty('completed_at');
  });

  it('reports an empty cohort as a real answer, not an absence', () => {
    const result = toWeeklyPlanItemsPayload({ plan: null, items: [], folders: [], code: [] });

    expect(result).toStrictEqual({
      plan: null,
      counts: { total: 0, done: 0, open: 0, abandoned: 0, untriaged: 0 },
      items: [],
    });
  });
});

describe('toWeeklyPlanItemsPayload — the derived state / done / done_at, per family', () => {
  it('derives a completed task from its status and completed_at', () => {
    const result = payloadOf([
      row({
        id: 'a',
        title: 'done task',
        status: 'completed',
        completed_at: '2026-09-08T19:41:08.221Z',
      }),
    ]);

    expect(result.items[0]).toMatchObject({
      state: 'completed',
      done: true,
      done_at: '2026-09-08T19:41:08.221Z',
      code: null,
    });
  });

  it('derives an active task as open with no completion instant', () => {
    const result = payloadOf([row({ id: 'a', title: 'open task' })]);

    expect(result.items[0]).toMatchObject({ state: 'active', done: false, done_at: null });
  });

  it("reports a shipped story's factory state, its done_at and its sidecar identity", () => {
    const result = toWeeklyPlanItemsPayload({
      plan: PLAN,
      items: [row({ id: 'a', title: 'Mixer mute', item_type: 'code' })],
      folders: [],
      code: [sidecar('a', 'done', '2026-09-10T16:22:41.900Z')],
    });

    expect(result.items[0]).toMatchObject({
      state: 'done',
      done: true,
      done_at: '2026-09-10T16:22:41.900Z',
      code: { ref: 'RPL-142', lane: 'human' },
    });
  });

  it('reports a story mid-flight by its factory state, not done', () => {
    const result = toWeeklyPlanItemsPayload({
      plan: PLAN,
      items: [row({ id: 'a', title: 'Mute state', item_type: 'code' })],
      folders: [],
      code: [sidecar('a', 'ready_for_review')],
    });

    expect(result.items[0]).toMatchObject({
      state: 'ready_for_review',
      done: false,
      done_at: null,
    });
  });

  it('reports a story that reached done before the column existed as done with a null done_at', () => {
    const result = toWeeklyPlanItemsPayload({
      plan: PLAN,
      items: [row({ id: 'a', title: 'Old story', item_type: 'code' })],
      folders: [],
      code: [sidecar('a', 'done', null)],
    });

    expect(result.items[0]).toMatchObject({ state: 'done', done: true, done_at: null });
  });

  it('reports a code item that never entered the factory as active with no sidecar', () => {
    const result = payloadOf([row({ id: 'a', title: 'Planned as code', item_type: 'code' })]);

    expect(result.items[0]).toMatchObject({
      item_type: 'code',
      state: 'active',
      done: false,
      done_at: null,
      code: null,
    });
  });

  it('derives the same fields on a child as on a root', () => {
    const result = payloadOf([
      row({ id: 'root', title: 'parent' }),
      row({
        id: 'kid',
        title: 'child',
        parent_id: 'root',
        status: 'completed',
        completed_at: '2026-09-08T14:02:55.010Z',
      }),
    ]);

    expect(result.items[0]?.children[0]).toMatchObject({
      done: true,
      done_at: '2026-09-08T14:02:55.010Z',
      state: 'completed',
    });
  });
});

describe('toWeeklyPlanItemsPayload — the counts', () => {
  /** A deliberately mixed cohort: both families, both outcomes, plus an abandoned story. */
  const MIXED = {
    plan: PLAN,
    items: [
      row({
        id: 'r1',
        title: 'done task',
        status: 'completed',
        completed_at: '2026-09-08T19:00:00Z',
        dispatched_at: '2026-09-06T09:00:00Z',
        folder_id: 'f1',
      }),
      row({
        id: 'r1c',
        title: 'open subtask',
        parent_id: 'r1',
        dispatched_at: '2026-09-06T09:00:00Z',
        folder_id: 'f1',
      }),
      row({ id: 'r2', title: 'open task' }),
      row({ id: 'r3', title: 'shipped story', item_type: 'code' }),
      row({ id: 'r4', title: 'abandoned story', item_type: 'code' }),
      row({ id: 'r5', title: 'story in flight', item_type: 'code' }),
    ],
    folders: [{ id: 'f1', name: 'RealPlay' }],
    code: [
      sidecar('r3', 'done', '2026-09-10T16:00:00Z'),
      sidecar('r4', 'abandoned'),
      sidecar('r5', 'in_development'),
    ],
  };

  it('counts every node in the cohort, children included', () => {
    expect(toWeeklyPlanItemsPayload(MIXED).counts.total).toBe(6);
  });

  it('counts done as exactly the nodes reporting done: true, across both families', () => {
    const { counts, items } = toWeeklyPlanItemsPayload(MIXED);
    const flat = items.flatMap((item) => [item, ...item.children]);

    expect(counts.done).toBe(flat.filter((node) => node.done).length);
    expect(counts.done).toBe(2);
  });

  it('counts an abandoned story as neither done nor open', () => {
    const { counts } = toWeeklyPlanItemsPayload(MIXED);

    expect(counts.abandoned).toBe(1);
    expect(counts.done + counts.open + counts.abandoned).toBe(counts.total);
    expect(counts.open).toBe(3);
  });

  it('counts untriaged independently — it cross-cuts done / open / abandoned', () => {
    const { counts } = toWeeklyPlanItemsPayload(MIXED);

    // Four rows never left the Inbox; two were dispatched into a folder.
    expect(counts.untriaged).toBe(4);
    expect(counts.done + counts.open + counts.abandoned).not.toBe(
      counts.done + counts.open + counts.abandoned + counts.untriaged,
    );
  });
});
