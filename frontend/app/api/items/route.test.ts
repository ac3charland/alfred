/** @jest-environment node */
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { GET, POST } from './route';

// ---------------------------------------------------------------------------
// Mock the Supabase clients
// ---------------------------------------------------------------------------

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}));

const mockCreateClient = jest.mocked(createClient);
const mockCreateAdminClient = jest.mocked(createAdminClient);

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_USER = { id: 'user-123' };
const TEST_ITEM = { id: 'item-1', title: 'Buy milk', status: 'active' };

interface MockResult {
  data: unknown;
  error: { message: string } | undefined;
}

/** Builds a chainable Supabase query mock. Terminal methods resolve with `result`. */
function makeQueryChain(result: MockResult) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue(result),
    single: jest.fn().mockResolvedValue(result),
  };
  return chain;
}

function makeMockSupabase(user: { id: string } | undefined, result: MockResult) {
  const chain = makeQueryChain(result);
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user } }),
    },
    from: jest.fn().mockReturnValue(chain),
    _chain: chain,
  };
}

const STUB_CONTEXT = { params: Promise.resolve({}) };

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

// ---------------------------------------------------------------------------
// GET /api/items
// ---------------------------------------------------------------------------

describe('GET /api/items', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await GET(makeRequest('http://localhost/api/items'), STUB_CONTEXT);
    expect(response.status).toBe(401);
  });

  it('returns items list for authenticated user (default active status)', async () => {
    const items = [TEST_ITEM];
    const mockSupabase = makeMockSupabase(TEST_USER, { data: items, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await GET(makeRequest('http://localhost/api/items'), STUB_CONTEXT);
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toStrictEqual(items);
  });

  it('uses .is() for inbox=true filter (not .eq on folder_id)', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await GET(makeRequest('http://localhost/api/items?inbox=true'), STUB_CONTEXT);

    const chain = mockSupabase._chain;
    // Verify .is('folder_id', null) was called — the route must use .is() not .eq()
    // for SQL IS NULL semantics (Supabase .eq() on a null column returns zero rows).
    expect(chain.is).toHaveBeenCalledWith('folder_id', null);
    expect(chain.eq).not.toHaveBeenCalledWith('folder_id', expect.anything());
  });

  it('returns 400 for invalid status query param', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await GET(
      makeRequest('http://localhost/api/items?status=invalid'),
      STUB_CONTEXT,
    );
    expect(response.status).toBe(400);
  });

  it('returns 500 on Supabase error', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: undefined,
      error: { message: 'DB error' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await GET(makeRequest('http://localhost/api/items'), STUB_CONTEXT);
    expect(response.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// POST /api/items
// ---------------------------------------------------------------------------

describe('POST /api/items', () => {
  it('returns 401 when no API key and no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(
      makeRequest('http://localhost/api/items', {
        method: 'POST',
        body: JSON.stringify({ title: 'Test' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(response.status).toBe(401);
  });

  it('uses createAdminClient when valid x-api-key header is present', async () => {
    process.env.INGEST_API_KEY = 'secret-key-123';

    const chain = makeQueryChain({ data: TEST_ITEM, error: undefined });
    const adminClient = { from: jest.fn().mockReturnValue(chain) };
    mockCreateAdminClient.mockReturnValue(adminClient as never);

    const response = await POST(
      makeRequest('http://localhost/api/items', {
        method: 'POST',
        body: JSON.stringify({ title: 'Siri capture' }),
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'secret-key-123',
        },
      }),
    );

    expect(mockCreateAdminClient).toHaveBeenCalled();
    expect(response.status).toBe(201);

    delete process.env.INGEST_API_KEY;
  });

  it('uses createAdminClient when valid Authorization: Bearer header is present', async () => {
    process.env.INGEST_API_KEY = 'secret-key-456';

    const chain = makeQueryChain({ data: TEST_ITEM, error: undefined });
    const adminClient = { from: jest.fn().mockReturnValue(chain) };
    mockCreateAdminClient.mockReturnValue(adminClient as never);

    const response = await POST(
      makeRequest('http://localhost/api/items', {
        method: 'POST',
        body: JSON.stringify({ title: 'Siri capture via Bearer' }),
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret-key-456',
        },
      }),
    );

    expect(mockCreateAdminClient).toHaveBeenCalled();
    expect(response.status).toBe(201);

    delete process.env.INGEST_API_KEY;
  });

  it('maps text field to title + raw_capture for Siri path', async () => {
    process.env.INGEST_API_KEY = 'key-789';

    const chain = makeQueryChain({ data: TEST_ITEM, error: undefined });
    const adminClient = { from: jest.fn().mockReturnValue(chain) };
    mockCreateAdminClient.mockReturnValue(adminClient as never);

    await POST(
      makeRequest('http://localhost/api/items', {
        method: 'POST',
        body: JSON.stringify({ text: 'buy coffee' }),
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'key-789',
        },
      }),
    );

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'buy coffee', raw_capture: 'buy coffee' }),
    );

    delete process.env.INGEST_API_KEY;
  });

  it('returns 400 for missing title and text', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(
      makeRequest('http://localhost/api/items', {
        method: 'POST',
        body: JSON.stringify({ notes: 'no title here' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(response.status).toBe(400);
  });

  it('creates item with 201 for authenticated session', async () => {
    const chain = makeQueryChain({ data: TEST_ITEM, error: undefined });
    const mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: TEST_USER } }) },
      from: jest.fn().mockReturnValue(chain),
    };
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(
      makeRequest('http://localhost/api/items', {
        method: 'POST',
        body: JSON.stringify({ title: 'New task' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(response.status).toBe(201);
    const body: unknown = await response.json();
    expect(body).toStrictEqual(TEST_ITEM);
  });
});
