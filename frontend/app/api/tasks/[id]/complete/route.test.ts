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
const AFFECTED_ITEMS = [
  { id: 'task-1', status: 'completed' },
  { id: 'task-2', status: 'completed' },
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

const routeContext = { params: Promise.resolve({ id: 'task-1' }) };

describe('POST /api/tasks/[id]/complete', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(
      new Request('http://localhost/api/tasks/task-1/complete', { method: 'POST' }),
      routeContext,
    );
    expect(response.status).toBe(401);
  });

  it('calls rpc complete_subtree with the route id and returns affected items', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: AFFECTED_ITEMS, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(
      new Request('http://localhost/api/tasks/task-1/complete', { method: 'POST' }),
      routeContext,
    );

    expect(mockSupabase.rpc).toHaveBeenCalledWith('complete_subtree', { root_id: 'task-1' });
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
      new Request('http://localhost/api/tasks/task-1/complete', { method: 'POST' }),
      routeContext,
    );
    expect(response.status).toBe(500);
  });
});
