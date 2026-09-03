/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createClient } from '@/lib/supabase/server';

import {
  getLatestWeeklyPlan,
  getLatestWeeklyPlanWithItems,
  getWeeklyPlanById,
  getWeeklyPlanCohort,
  getWeeklyPlanIndex,
} from './weekly-plans';

// `import 'server-only'` throws outside a Server Component context; neutralise it under Jest.
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const HTML = '<!DOCTYPE html><html></html>';
const NEWER = { id: 'p-2', html: HTML, uploaded_at: '2026-07-24T12:00:00Z' };
const OLDER = { id: 'p-1', html: HTML, uploaded_at: '2026-07-17T12:00:00Z' };

/** The index read ends at `.order()`. */
function mockIndexClient(result: { data: unknown }) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue(result),
  };
  mockCreateClient.mockResolvedValue({ from: jest.fn().mockReturnValue(chain) } as never);
  return chain;
}

/** The latest read ends at `.limit()`, one step past `.order()`. */
function mockLatestClient(result: { data: unknown }) {
  const limit = jest.fn().mockResolvedValue(result);
  const chain = {
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnValue({ limit }),
    limit,
  };
  mockCreateClient.mockResolvedValue({ from: jest.fn().mockReturnValue(chain) } as never);
  return chain;
}

describe('getWeeklyPlanIndex', () => {
  it('reads the archive newest-first, without the documents', async () => {
    const chain = mockIndexClient({ data: [{ id: NEWER.id, uploaded_at: NEWER.uploaded_at }] });

    const result = await getWeeklyPlanIndex();

    // The index is the picker's list: shipping every document in it would defeat the point.
    expect(chain.select).toHaveBeenCalledWith('id, uploaded_at');
    expect(chain.order).toHaveBeenCalledWith('uploaded_at', { ascending: false });
    expect(result).toStrictEqual([{ id: NEWER.id, uploaded_at: NEWER.uploaded_at }]);
  });

  it('returns an empty index when nothing has been uploaded', async () => {
    mockIndexClient({ data: null });
    expect(await getWeeklyPlanIndex()).toStrictEqual([]);
  });
});

describe('getLatestWeeklyPlan', () => {
  it('returns the newest plan with its document', async () => {
    const chain = mockLatestClient({ data: [NEWER] });

    const result = await getLatestWeeklyPlan();

    expect(chain.select).toHaveBeenCalledWith('*');
    expect(chain.order).toHaveBeenCalledWith('uploaded_at', { ascending: false });
    expect(chain.limit).toHaveBeenCalledWith(1);
    expect(result).toStrictEqual(NEWER);
  });

  it('takes the head of the list rather than demanding exactly one row', async () => {
    // A cardinality-enforcing read (`.maybeSingle()`) errors the moment the archive holds
    // more than one plan and the limit fails to narrow it — that must not blank the view.
    mockLatestClient({ data: [NEWER, OLDER] });

    expect(await getLatestWeeklyPlan()).toStrictEqual(NEWER);
  });

  it('returns undefined when nothing has been uploaded', async () => {
    mockLatestClient({ data: [] });
    expect(await getLatestWeeklyPlan()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The cohort reads — each takes the Supabase client rather than creating one, because a keyed
// caller (the review coach) carries no cookie and must read through the admin client.
// ---------------------------------------------------------------------------

const PLAN_A = { id: 'p-2', uploaded_at: '2026-07-24T12:00:00Z' };
const PLAN_B = { id: 'p-1', uploaded_at: '2026-07-17T12:00:00Z' };

interface QueryResult {
  data: unknown;
  error: unknown;
}

/**
 * A Supabase double whose every builder method chains and whose terminal `await` resolves to the
 * next queued result. Each read below ends by awaiting the builder itself, so one thenable
 * covers `.select().eq().order().limit()` in any order.
 */
function mockClient(...results: QueryResult[]) {
  const queue = [...results];
  const calls: { table: string; filters: unknown[] }[] = [];
  const from = jest.fn((table: string) => {
    const record = { table, filters: [] as unknown[] };
    calls.push(record);
    // A real Promise carrying the builder methods: a PostgREST builder is awaitable at any
    // point in the chain, and attaching the methods to a promise gives that without hand-rolling
    // a thenable.
    const builder = Promise.resolve(
      queue.shift() ?? { data: [], error: null },
    ) as Promise<QueryResult> & Record<string, unknown>;
    for (const method of ['select', 'eq', 'in', 'not', 'order', 'limit']) {
      builder[method] = jest.fn((...arguments_: unknown[]) => {
        record.filters.push([method, ...arguments_]);
        return builder;
      });
    }
    return builder;
  });
  return { supabase: { from } as never, calls };
}

describe('getWeeklyPlanById', () => {
  it('returns the plan row a cohort hangs off', async () => {
    const { supabase } = mockClient({ data: [PLAN_A], error: null });

    expect(await getWeeklyPlanById(supabase, PLAN_A.id)).toStrictEqual({
      plan: PLAN_A,
      error: null,
    });
  });

  it('returns a null plan when the id names nothing — the route answers 404', async () => {
    const { supabase } = mockClient({ data: [], error: null });

    expect(await getWeeklyPlanById(supabase, 'missing')).toStrictEqual({ plan: null, error: null });
  });

  it('surfaces a read error rather than reporting the plan as missing', async () => {
    const error = { message: 'boom' };
    const { supabase } = mockClient({ data: null, error });

    expect(await getWeeklyPlanById(supabase, PLAN_A.id)).toStrictEqual({ plan: null, error });
  });
});

describe('getLatestWeeklyPlanWithItems', () => {
  it('resolves the newest plan that actually has items', async () => {
    // The newest plan is a revision nothing was created against; the one before it holds the
    // cohort, and that is the week the coach is reporting on.
    const { supabase, calls } = mockClient(
      { data: [PLAN_A, PLAN_B], error: null },
      { data: [], error: null },
      { data: [{ id: 'item-1' }], error: null },
    );

    expect(await getLatestWeeklyPlanWithItems(supabase)).toStrictEqual({
      plan: PLAN_B,
      error: null,
    });
    expect(calls.map((call) => call.table)).toStrictEqual(['weekly_plans', 'items', 'items']);
  });

  it('stops at the first plan with items instead of probing the rest', async () => {
    const { supabase, calls } = mockClient(
      { data: [PLAN_A, PLAN_B], error: null },
      { data: [{ id: 'item-1' }], error: null },
    );

    expect(await getLatestWeeklyPlanWithItems(supabase)).toStrictEqual({
      plan: PLAN_A,
      error: null,
    });
    expect(calls).toHaveLength(2);
  });

  it('returns a null plan when no cohort has ever been created', async () => {
    const { supabase } = mockClient({ data: [PLAN_A], error: null }, { data: [], error: null });

    expect(await getLatestWeeklyPlanWithItems(supabase)).toStrictEqual({
      plan: null,
      error: null,
    });
  });

  it('surfaces a read error from either query', async () => {
    const error = { message: 'boom' };
    const { supabase } = mockClient({ data: [PLAN_A], error: null }, { data: null, error });

    expect(await getLatestWeeklyPlanWithItems(supabase)).toStrictEqual({ plan: null, error });
  });
});

describe('getWeeklyPlanCohort', () => {
  const ITEM = {
    id: 'i-1',
    item_type: 'task',
    folder_id: 'f-1',
    title: 'Ship the spike',
  };
  const CODE_ITEM = { id: 'i-2', item_type: 'code', folder_id: null, title: 'Mute state' };

  it('reads the rows, then only the folders and sidecars they reference', async () => {
    const folder = { id: 'f-1', name: 'RealPlay' };
    const sidecar = {
      item_id: 'i-2',
      ref: 'RPL-142',
      lane: 'human',
      factory_state: 'done',
      done_at: '2026-07-25T12:00:00Z',
    };
    const { supabase, calls } = mockClient(
      { data: [ITEM, CODE_ITEM], error: null },
      { data: [folder], error: null },
      { data: [sidecar], error: null },
    );

    const result = await getWeeklyPlanCohort(supabase, PLAN_A.id);

    expect(result).toStrictEqual({
      items: [ITEM, CODE_ITEM],
      folders: [folder],
      code: [sidecar],
      error: null,
    });
    expect(calls.map((call) => call.table)).toStrictEqual(['items', 'folders', 'code_items']);
    // The cohort read goes to the `items` TABLE, not the `task_items` view: a planned code item
    // that entered the factory leaves that view, and it is exactly the row the review asks about.
    expect(calls[1]?.filters).toContainEqual(['in', 'id', ['f-1']]);
    expect(calls[2]?.filters).toContainEqual(['in', 'item_id', ['i-2']]);
  });

  it('asks neither follow-up question when nothing references a folder or the factory', async () => {
    const bare = { id: 'i-3', item_type: 'unclassified', folder_id: null, title: 'x' };
    const { supabase, calls } = mockClient({ data: [bare], error: null });

    expect(await getWeeklyPlanCohort(supabase, PLAN_A.id)).toStrictEqual({
      items: [bare],
      folders: [],
      code: [],
      error: null,
    });
    expect(calls).toHaveLength(1);
  });

  it('reports an empty cohort without further reads', async () => {
    const { supabase, calls } = mockClient({ data: [], error: null });

    expect(await getWeeklyPlanCohort(supabase, PLAN_A.id)).toStrictEqual({
      items: [],
      folders: [],
      code: [],
      error: null,
    });
    expect(calls).toHaveLength(1);
  });

  it('surfaces a read error instead of an empty cohort', async () => {
    const error = { message: 'boom' };
    const { supabase } = mockClient({ data: null, error });

    expect(await getWeeklyPlanCohort(supabase, PLAN_A.id)).toStrictEqual({
      items: [],
      folders: [],
      code: [],
      error,
    });
  });
});
