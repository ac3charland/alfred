/** @jest-environment node */
import { createClient } from '@/lib/supabase/server';

import { DELETE, PATCH } from './route';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));
jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}));

const mockCreateClient = jest.mocked(createClient);

const TEST_USER = { id: 'user-123' };
const TEST_FOLDER = { id: 'folder-1', name: 'Renamed', created_at: '2026-01-01T00:00:00Z' };

interface MockResult {
  data: unknown;
  error: { message: string } | undefined;
}

function makeQueryChain(result: MockResult) {
  return {
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
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

const routeContext = { params: Promise.resolve({ id: 'folder-1' }) };

// ---------------------------------------------------------------------------
// PATCH /api/folders/[id]
// ---------------------------------------------------------------------------

describe('PATCH /api/folders/[id]', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(
      new Request('http://localhost/api/folders/folder-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );
    expect(response.status).toBe(401);
  });

  it('returns 400 when name is missing', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(
      new Request('http://localhost/api/folders/folder-1', {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );
    expect(response.status).toBe(400);
  });

  it('renames folder and returns updated folder', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_FOLDER, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(
      new Request('http://localhost/api/folders/folder-1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toStrictEqual(TEST_FOLDER);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/folders/[id]
// ---------------------------------------------------------------------------

describe('DELETE /api/folders/[id]', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await DELETE(
      new Request('http://localhost/api/folders/folder-1'),
      routeContext,
    );
    expect(response.status).toBe(401);
  });

  it('returns { success: true } on successful delete', async () => {
    const chain = {
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: undefined, error: undefined }),
    };
    const mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: TEST_USER } }) },
      from: jest.fn().mockReturnValue(chain),
    };
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await DELETE(
      new Request('http://localhost/api/folders/folder-1'),
      routeContext,
    );
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toStrictEqual({ success: true });
  });

  it('returns 500 on Supabase error', async () => {
    const chain = {
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: undefined, error: { message: 'DB error' } }),
    };
    const mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: TEST_USER } }) },
      from: jest.fn().mockReturnValue(chain),
    };
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await DELETE(
      new Request('http://localhost/api/folders/folder-1'),
      routeContext,
    );
    expect(response.status).toBe(500);
  });
});
