/** @jest-environment node */
import { createClient } from '@/lib/supabase/server';

import { GET, POST } from './route';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));
jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}));

const mockCreateClient = jest.mocked(createClient);

const TEST_USER = { id: 'user-123' };
const TEST_FOLDER = { id: 'folder-1', name: 'Work', created_at: '2026-01-01T00:00:00Z' };

const STUB_REQUEST = new Request('http://localhost/api/folders');
const STUB_CONTEXT = { params: Promise.resolve({}) };

interface MockResult {
  data: unknown;
  error: { message: string } | undefined;
}

function makeQueryChain(result: MockResult) {
  return {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue(result),
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

// ---------------------------------------------------------------------------
// GET /api/folders
// ---------------------------------------------------------------------------

describe('GET /api/folders', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await GET(STUB_REQUEST, STUB_CONTEXT);
    expect(response.status).toBe(401);
  });

  it('returns folders list for authenticated user', async () => {
    const folders = [TEST_FOLDER];
    const mockSupabase = makeMockSupabase(TEST_USER, { data: folders, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await GET(STUB_REQUEST, STUB_CONTEXT);
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toStrictEqual(folders);
  });

  it('returns 500 on Supabase error', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: undefined,
      error: { message: 'DB error' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await GET(STUB_REQUEST, STUB_CONTEXT);
    expect(response.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/folders
// ---------------------------------------------------------------------------

describe('POST /api/folders', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(
      new Request('http://localhost/api/folders', {
        method: 'POST',
        body: JSON.stringify({ name: 'Work' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      STUB_CONTEXT,
    );
    expect(response.status).toBe(401);
  });

  it('returns 400 for missing name', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(
      new Request('http://localhost/api/folders', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      }),
      STUB_CONTEXT,
    );
    expect(response.status).toBe(400);
  });

  it('creates a folder and returns 201', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_FOLDER, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(
      new Request('http://localhost/api/folders', {
        method: 'POST',
        body: JSON.stringify({ name: 'Work' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      STUB_CONTEXT,
    );
    expect(response.status).toBe(201);
    const body: unknown = await response.json();
    expect(body).toStrictEqual(TEST_FOLDER);
  });
});
