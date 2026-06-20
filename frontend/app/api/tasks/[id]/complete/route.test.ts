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
// A fixed, deterministic UUID — the [id] segment is now UUID-validated (parseUUID),
// so the fixture id must be a real UUID (a placeholder like 'task-1' would 400).
const TEST_ID = '00000000-0000-4000-8000-000000000001';
const AFFECTED_ITEMS = [
  { id: TEST_ID, status: 'completed' },
  { id: '00000000-0000-4000-8000-000000000002', status: 'completed' },
];

interface MockResult {
  data: unknown;
  error: { message: string } | undefined;
}

function makeMockSupabase(user: { id: string } | undefined, rpcResult: MockResult) {
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    rpc: jest.fn().mockResolvedValue(rpcResult),
  };
}

const routeContext = { params: Promise.resolve({ id: TEST_ID }) };

describe('POST /api/tasks/[id]/complete', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(
      new Request(`http://localhost/api/tasks/${TEST_ID}/complete`, { method: 'POST' }),
      routeContext,
    );
    expect(response.status).toBe(401);
  });

  it('returns 400 when the id is not a valid UUID', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(
      new Request('http://localhost/api/tasks/not-a-uuid/complete', { method: 'POST' }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    );
    expect(response.status).toBe(400);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('calls rpc complete_subtree with the route id and returns affected items', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: AFFECTED_ITEMS, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(
      new Request(`http://localhost/api/tasks/${TEST_ID}/complete`, { method: 'POST' }),
      routeContext,
    );

    expect(mockSupabase.rpc).toHaveBeenCalledWith('complete_subtree', { root_id: TEST_ID });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toStrictEqual(AFFECTED_ITEMS);
  });

  it('returns 500 on Supabase RPC error', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: undefined,
      error: { message: 'RPC error' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(
      new Request(`http://localhost/api/tasks/${TEST_ID}/complete`, { method: 'POST' }),
      routeContext,
    );
    expect(response.status).toBe(500);
  });
});
