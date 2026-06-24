/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createClient } from '@/lib/supabase/server';

import { POST } from './route';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));
jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}));

const mockCreateClient = jest.mocked(createClient);

const TEST_USER = { id: 'user-123' };
// A fixed, deterministic UUID — the [id] segment is UUID-validated (parseUUID), so the
// fixture id must be a real UUID (a placeholder like 'task-1' would 400).
const TEST_ID = '00000000-0000-4000-8000-000000000001';
const AFFECTED_ITEMS = [
  { id: TEST_ID, status: 'completed' },
  { id: '00000000-0000-4000-8000-000000000002', status: 'completed' },
];

/** A loaded `items` row's recurrence metadata (the columns the route selects). */
interface TaskMeta {
  recurrence: unknown;
  due_date: string | null;
  occurrence_index: number | null;
  recurrence_series_id: string | null;
  parent_id: string | null;
  item_type: string;
}

const NON_RECURRING: TaskMeta = {
  recurrence: null,
  due_date: null,
  occurrence_index: null,
  recurrence_series_id: null,
  parent_id: null,
  item_type: 'task',
};

const DAILY: TaskMeta = {
  recurrence: { freq: 'daily', interval: 1, end: { type: 'never' } },
  due_date: '2026-06-01',
  occurrence_index: 1,
  recurrence_series_id: null,
  parent_id: null,
  item_type: 'task',
};

interface MockOptions {
  task?: TaskMeta;
  taskError?: { message: string };
  rpc?: { data: unknown; error: { message: string } | undefined };
  updateError?: { message: string };
}

function makeMockSupabase(user: { id: string } | undefined, options: MockOptions = {}) {
  const single = jest.fn().mockResolvedValue({
    data: options.task ?? NON_RECURRING,
    error: options.taskError,
  });
  const selectEq = jest.fn().mockReturnValue({ single });
  const select = jest.fn().mockReturnValue({ eq: selectEq });
  const updateEq = jest.fn().mockResolvedValue({ error: options.updateError });
  const update = jest.fn().mockReturnValue({ eq: updateEq });
  const from = jest.fn().mockReturnValue({ select, update });
  const rpc = jest
    .fn()
    .mockResolvedValue(options.rpc ?? { data: AFFECTED_ITEMS, error: undefined });
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from,
    rpc,
    update,
    updateEq,
  };
}

const routeContext = { params: Promise.resolve({ id: TEST_ID }) };

function postRequest() {
  return new Request(`http://localhost/api/tasks/${TEST_ID}/complete`, { method: 'POST' });
}

describe('POST /api/tasks/[id]/complete', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined);
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest(), routeContext);
    expect(response.status).toBe(401);
  });

  it('returns 400 when the id is not a valid UUID', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER);
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(
      new Request('http://localhost/api/tasks/not-a-uuid/complete', { method: 'POST' }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    );
    expect(response.status).toBe(400);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  // ── Non-recurring path (backward-compatible) ───────────────────────────────
  it('calls complete_subtree for a non-recurring task and returns the affected items', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { task: NON_RECURRING });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest(), routeContext);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('complete_subtree', { root_id: TEST_ID });
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual(AFFECTED_ITEMS);
  });

  it('returns 500 when loading the task fails', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { taskError: { message: 'load error' } });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest(), routeContext);
    expect(response.status).toBe(500);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('returns 500 on a complete_subtree RPC error', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      task: NON_RECURRING,
      rpc: { data: undefined, error: { message: 'RPC error' } },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest(), routeContext);
    expect(response.status).toBe(500);
  });

  // ── Recurring path (complete_and_spawn) ────────────────────────────────────
  it('spawns the next occurrence for a recurring top-level task', async () => {
    const spawnResult = {
      completed: AFFECTED_ITEMS,
      spawned: { id: 'new-occurrence', due_date: '2026-06-02' },
    };
    const mockSupabase = makeMockSupabase(TEST_USER, {
      task: DAILY,
      rpc: { data: spawnResult, error: undefined },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest(), routeContext);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('complete_and_spawn', {
      root_id: TEST_ID,
      next_due: '2026-06-02',
      next_index: 2,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual(spawnResult);
  });

  it('lazily stamps the series id on the original the first time it recurs', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      task: DAILY,
      rpc: { data: { completed: AFFECTED_ITEMS, spawned: {} }, error: undefined },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await POST(postRequest(), routeContext);

    // The original (series id null) gets tagged before the spawn.
    expect(mockSupabase.update).toHaveBeenCalledTimes(1);
    expect(mockSupabase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        occurrence_index: 1,
        recurrence_series_id: expect.any(String) as unknown,
      }),
    );
  });

  it('does not re-stamp a task that already has a series id', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      task: { ...DAILY, recurrence_series_id: 'existing-series', occurrence_index: 3 },
      rpc: { data: { completed: AFFECTED_ITEMS, spawned: {} }, error: undefined },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await POST(postRequest(), routeContext);

    expect(mockSupabase.update).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).toHaveBeenCalledWith('complete_and_spawn', {
      root_id: TEST_ID,
      next_due: '2026-06-02',
      next_index: 4,
    });
  });

  it('does NOT spawn when the series has ended (falls back to complete_subtree)', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      task: {
        ...DAILY,
        recurrence: { freq: 'daily', interval: 1, end: { type: 'after', count: 1 } },
        occurrence_index: 1,
      },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest(), routeContext);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('complete_subtree', { root_id: TEST_ID });
    expect(response.status).toBe(200);
  });

  it('does NOT spawn for a recurring SUBTASK (parent_id set)', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      task: { ...DAILY, parent_id: '00000000-0000-4000-8000-000000000009' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await POST(postRequest(), routeContext);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('complete_subtree', { root_id: TEST_ID });
  });

  it('does NOT spawn when the recurring task has no due date', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      task: { ...DAILY, due_date: null },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await POST(postRequest(), routeContext);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('complete_subtree', { root_id: TEST_ID });
  });

  it('returns 500 when the lazy series-id tag fails', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      task: DAILY,
      updateError: { message: 'tag failed' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest(), routeContext);
    expect(response.status).toBe(500);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });
});
