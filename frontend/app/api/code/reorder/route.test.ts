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
const ROW_A = { item_id: 'i1', ref: 'ALF-1', priority: 2 };
const ROW_B = { item_id: 'i2', ref: 'ALF-2', priority: 1 };

interface RpcResult {
  data: unknown;
  error: { message: string } | undefined;
}

/** Supabase stub: `swap_code_priority` is a setof RPC, awaited directly (no `.single()`). */
function makeMockSupabase(user: { id: string } | undefined, result: RpcResult) {
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    rpc: jest.fn().mockResolvedValue(result),
  };
}

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/code/reorder', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const STUB_CONTEXT = { params: Promise.resolve({}) };

describe('POST /api/code/reorder', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest({ a: 'ALF-1', b: 'ALF-2' }), STUB_CONTEXT);
    expect(response.status).toBe(401);
  });

  it('returns 400 for an invalid JSON body', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest('not-json'), STUB_CONTEXT);
    expect(response.status).toBe(400);
  });

  it('returns 400 when a ref is missing', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest({ a: 'ALF-1' }), STUB_CONTEXT);
    expect(response.status).toBe(400);
  });

  it('returns 400 when a story is asked to swap with itself', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest({ a: 'ALF-1', b: 'ALF-1' }), STUB_CONTEXT);
    expect(response.status).toBe(400);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('calls swap_code_priority with the two refs and returns the updated rows', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [ROW_A, ROW_B], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest({ a: 'ALF-1', b: 'ALF-2' }), STUB_CONTEXT);

    expect(response.status).toBe(200);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('swap_code_priority', {
      p_a: 'ALF-1',
      p_b: 'ALF-2',
    });
    const body: unknown = await response.json();
    expect(body).toStrictEqual({ rows: [ROW_A, ROW_B] });
  });

  it('maps a Supabase error to its status', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: undefined,
      error: { message: 'swap_code_priority: unknown ref' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest({ a: 'ALF-1', b: 'ALF-404' }), STUB_CONTEXT);
    expect(response.status).toBe(500);
  });
});
