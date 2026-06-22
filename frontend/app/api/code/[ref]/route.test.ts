/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createClient } from '@/lib/supabase/server';

import { PATCH } from './route';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));
jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}));

const mockCreateClient = jest.mocked(createClient);

const TEST_USER = { id: 'user-123' };
const TEST_STORY = { item_id: 'i1', ref: 'ALF-42', factory_state: 'in_refinement' };

interface MockResult {
  data: unknown;
  error: { message: string } | undefined;
}

function makeQueryChain(result: MockResult) {
  return {
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
  };
}

function makeMockSupabase(user: { id: string } | undefined, result: MockResult) {
  const chain = makeQueryChain(result);
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn().mockReturnValue(chain),
    _chain: chain,
  };
}

/**
 * A mock whose `from(table)` hands out a fresh chain per call, drawing results from a
 * per-table queue (FIFO). Needed for the epic-move path, which reads `code_items` and
 * `epics` for the cross-project guard before the `code_items` update — three `.from()` calls.
 */
function makeMockSupabaseByTable(
  user: { id: string } | undefined,
  queues: Record<string, MockResult[]>,
) {
  const chainsByTable: Record<string, ReturnType<typeof makeQueryChain>[]> = {};
  const from = jest.fn((table: string) => {
    const queue = queues[table] ?? [];
    const result = queue.shift() ?? { data: undefined, error: undefined };
    const chain = makeQueryChain(result);
    (chainsByTable[table] ??= []).push(chain);
    return chain;
  });
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from,
    _chains: chainsByTable,
  };
}

const EPIC_ID = '123e4567-e89b-42d3-a456-426614174000';

/** Extract the first-call first-arg from a mock as a plain object. */
function firstCallArg(mockFn: jest.Mock): Record<string, unknown> {
  const calls = mockFn.mock.calls as [Record<string, unknown>][];
  const firstCall = calls[0];
  if (!firstCall) throw new Error('mock was never called');
  return firstCall[0];
}

function patchRequest(body: unknown): Request {
  return new Request('http://localhost/api/code/ALF-42', {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const routeContext = { params: Promise.resolve({ ref: 'ALF-42' }) };

describe('PATCH /api/code/[ref]', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest({ factory_state: 'in_refinement' }), routeContext);
    expect(response.status).toBe(401);
  });

  it('returns 400 for invalid JSON body', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest('not-json'), routeContext);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Invalid JSON body');
  });

  it('returns 400 for an unknown factory_state value', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest({ factory_state: 'shipped' }), routeContext);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Invalid request body');
  });

  it('returns 400 when factory_state is missing', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest({ blocked_reason: 'why' }), routeContext);
    expect(response.status).toBe(400);
  });

  it('updates the factory_state and returns the row on success', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_STORY, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest({ factory_state: 'in_refinement' }), routeContext);
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toStrictEqual(TEST_STORY);
  });

  it('updates the "code_items" table filtering by the ref param', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_STORY, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(patchRequest({ factory_state: 'in_development' }), routeContext);

    const chain = mockSupabase._chain;
    expect(mockSupabase.from).toHaveBeenCalledWith('code_items');
    expect(chain.eq).toHaveBeenCalledWith('ref', 'ALF-42');
  });

  it('sends only factory_state when blocked_reason is absent (strict PATCH payload)', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_STORY, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(patchRequest({ factory_state: 'in_refinement' }), routeContext);

    const payload = firstCallArg(mockSupabase._chain.update);
    expect(Object.keys(payload)).toStrictEqual(['factory_state']);
    expect(payload['factory_state']).toBe('in_refinement');
  });

  it('includes blocked_reason in the payload when provided', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_STORY, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      patchRequest({ factory_state: 'blocked', blocked_reason: 'checks failing' }),
      routeContext,
    );

    expect(mockSupabase._chain.update).toHaveBeenCalledWith({
      factory_state: 'blocked',
      blocked_reason: 'checks failing',
    });
  });

  it('forwards a null blocked_reason (clearing it on a non-blocked hop)', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_STORY, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      patchRequest({ factory_state: 'ready_for_dev', blocked_reason: null }),
      routeContext,
    );

    const payload = firstCallArg(mockSupabase._chain.update);
    expect(payload).toStrictEqual({ factory_state: 'ready_for_dev', blocked_reason: null });
  });

  it('returns 400 for an empty patch body (nothing to update)', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest({}), routeContext);
    expect(response.status).toBe(400);
  });

  describe('moving a story to a different epic', () => {
    it('updates the sidecar epic_id and returns the row when the epic is same-project', async () => {
      const mockSupabase = makeMockSupabaseByTable(TEST_USER, {
        code_items: [
          { data: { project_id: 'p1' }, error: undefined },
          { data: { ...TEST_STORY, epic_id: EPIC_ID }, error: undefined },
        ],
        epics: [{ data: { project_id: 'p1' }, error: undefined }],
      });
      mockCreateClient.mockResolvedValue(mockSupabase as never);

      const response = await PATCH(patchRequest({ epic_id: EPIC_ID }), routeContext);
      expect(response.status).toBe(200);

      // The second code_items chain is the update; it carries only epic_id.
      const updateChain = mockSupabase._chains['code_items']?.[1];
      expect(updateChain?.update).toHaveBeenCalledWith({ epic_id: EPIC_ID });
      expect(updateChain?.eq).toHaveBeenCalledWith('ref', 'ALF-42');
    });

    it('rejects (400) a target epic in a different project and never updates', async () => {
      const mockSupabase = makeMockSupabaseByTable(TEST_USER, {
        code_items: [{ data: { project_id: 'p1' }, error: undefined }],
        epics: [{ data: { project_id: 'p2' }, error: undefined }],
      });
      mockCreateClient.mockResolvedValue(mockSupabase as never);

      const response = await PATCH(patchRequest({ epic_id: EPIC_ID }), routeContext);
      expect(response.status).toBe(400);
      // Only the guard select ran on code_items — no update chain was created.
      expect(mockSupabase._chains['code_items']).toHaveLength(1);
    });

    it('rejects (400) an unknown target epic', async () => {
      const mockSupabase = makeMockSupabaseByTable(TEST_USER, {
        code_items: [{ data: { project_id: 'p1' }, error: undefined }],
        epics: [{ data: undefined, error: undefined }],
      });
      mockCreateClient.mockResolvedValue(mockSupabase as never);

      const response = await PATCH(patchRequest({ epic_id: EPIC_ID }), routeContext);
      expect(response.status).toBe(400);
      expect(mockSupabase._chains['code_items']).toHaveLength(1);
    });
  });

  it('returns 500 on Supabase error', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: undefined,
      error: { message: 'DB error' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest({ factory_state: 'done' }), routeContext);
    expect(response.status).toBe(500);
  });
});
