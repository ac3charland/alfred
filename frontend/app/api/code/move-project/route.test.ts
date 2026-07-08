/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createClient } from '@/lib/supabase/server';

import { POST } from './route';

// Neutralise `import 'server-only'` reached transitively through the auth helper under Jest.
jest.mock('server-only', () => ({}));

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}));

const mockCreateClient = jest.mocked(createClient);

const TEST_USER = { id: 'user-123' };
const MOVED_ROW = { item_id: 'i1', ref: 'ALF-1', priority: -1.5 };

interface RpcResult {
  data: unknown;
  error: { message: string } | undefined;
}

/** Supabase stub: `move_code_priority_in_project` is a setof RPC, awaited directly (no `.single()`). */
function makeMockSupabase(user: { id: string } | undefined, result: RpcResult) {
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    rpc: jest.fn().mockResolvedValue(result),
  };
}

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/code/move-project', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const STUB_CONTEXT = { params: Promise.resolve({}) };

describe('POST /api/code/move-project', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest({ ref: 'ALF-1', to_top: true }), STUB_CONTEXT);
    expect(response.status).toBe(401);
  });

  it('returns 400 for an invalid JSON body', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest('not-json'), STUB_CONTEXT);
    expect(response.status).toBe(400);
  });

  it('returns 400 when to_top is missing', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest({ ref: 'ALF-1' }), STUB_CONTEXT);
    expect(response.status).toBe(400);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('calls move_code_priority_in_project with the ref and direction and returns the updated row', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [MOVED_ROW], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest({ ref: 'ALF-1', to_top: true }), STUB_CONTEXT);

    expect(response.status).toBe(200);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('move_code_priority_in_project', {
      p_ref: 'ALF-1',
      p_to_top: true,
    });
    const body: unknown = await response.json();
    expect(body).toStrictEqual({ rows: [MOVED_ROW] });
  });

  it('forwards to_top false for a jump to the bottom of the project', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [MOVED_ROW], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await POST(postRequest({ ref: 'ALF-1', to_top: false }), STUB_CONTEXT);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('move_code_priority_in_project', {
      p_ref: 'ALF-1',
      p_to_top: false,
    });
  });

  it('maps a Supabase error to its status', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: undefined,
      error: { message: 'move_code_priority_in_project: unknown ref' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest({ ref: 'ALF-404', to_top: true }), STUB_CONTEXT);
    expect(response.status).toBe(500);
  });
});
