/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
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

  it('queries the "items" table with select(*)', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await GET(makeRequest('http://localhost/api/items'), STUB_CONTEXT);

    const chain = mockSupabase._chain;
    expect(mockSupabase.from).toHaveBeenCalledWith('items');
    expect(chain.select).toHaveBeenCalledWith('*');
  });

  it('applies .eq("status", "active") by default (no status param)', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await GET(makeRequest('http://localhost/api/items'), STUB_CONTEXT);

    const chain = mockSupabase._chain;
    expect(chain.eq).toHaveBeenCalledWith('status', 'active');
  });

  it('does NOT apply status filter when status=all', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await GET(makeRequest('http://localhost/api/items?status=all'), STUB_CONTEXT);

    const chain = mockSupabase._chain;
    expect(chain.eq).not.toHaveBeenCalledWith('status', expect.anything());
  });

  it('applies .eq("status", "completed") when status=completed', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await GET(makeRequest('http://localhost/api/items?status=completed'), STUB_CONTEXT);

    const chain = mockSupabase._chain;
    expect(chain.eq).toHaveBeenCalledWith('status', 'completed');
  });

  it('orders results by created_at descending', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await GET(makeRequest('http://localhost/api/items'), STUB_CONTEXT);

    const chain = mockSupabase._chain;
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
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

  it('uses .eq("folder_id", folderId) for folder filter (not inbox path)', async () => {
    const folderId = 'e4f5a6b7-c8d9-4e0f-a1b2-c3d4e5f6a7b8';
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await GET(makeRequest(`http://localhost/api/items?folder=${folderId}`), STUB_CONTEXT);

    const chain = mockSupabase._chain;
    expect(chain.eq).toHaveBeenCalledWith('folder_id', folderId);
    expect(chain.is).not.toHaveBeenCalled();
  });

  it('does not apply folder filter when neither inbox nor folder param is provided', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await GET(makeRequest('http://localhost/api/items'), STUB_CONTEXT);

    const chain = mockSupabase._chain;
    // Neither .is() nor .eq('folder_id', ...) should be called for unscoped query.
    // Explicitly check no call had 'folder_id' as first arg (covers undefined second arg too).
    expect(chain.is).not.toHaveBeenCalled();
    const eqCallsWithFolderId = (jest.mocked(chain.eq).mock.calls as [string, unknown][]).filter(
      ([col]) => col === 'folder_id',
    );
    expect(eqCallsWithFolderId).toHaveLength(0);
  });

  it('reads "folder" query param by name (not a different param name)', async () => {
    const folderId = 'e4f5a6b7-c8d9-4e0f-a1b2-c3d4e5f6a7b8';
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    // Use the correct 'folder' param key — a mutation to '' would not apply filter
    await GET(makeRequest(`http://localhost/api/items?folder=${folderId}`), STUB_CONTEXT);

    const chain = mockSupabase._chain;
    expect(chain.eq).toHaveBeenCalledWith('folder_id', folderId);
  });

  it('returns 400 for invalid status query param', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await GET(
      makeRequest('http://localhost/api/items?status=invalid'),
      STUB_CONTEXT,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Invalid query parameters');
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
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Invalid request body');
  });

  it('returns 400 for invalid JSON body (authenticated session)', async () => {
    const chain = makeQueryChain({ data: TEST_ITEM, error: undefined });
    const mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: TEST_USER } }) },
      from: jest.fn().mockReturnValue(chain),
    };
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    // Must pass auth first — use session auth path with invalid JSON body
    const response = await POST(
      makeRequest('http://localhost/api/items', {
        method: 'POST',
        body: 'not-valid-json',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Invalid JSON body');
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

  it('inserts into the "items" table', async () => {
    const chain = makeQueryChain({ data: TEST_ITEM, error: undefined });
    const mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: TEST_USER } }) },
      from: jest.fn().mockReturnValue(chain),
    };
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await POST(
      makeRequest('http://localhost/api/items', {
        method: 'POST',
        body: JSON.stringify({ title: 'New task' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(mockSupabase.from).toHaveBeenCalledWith('items');
  });

  it('inserts item with status="active" and item_type="unclassified" as defaults', async () => {
    const chain = makeQueryChain({ data: TEST_ITEM, error: undefined });
    const mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: TEST_USER } }) },
      from: jest.fn().mockReturnValue(chain),
    };
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await POST(
      makeRequest('http://localhost/api/items', {
        method: 'POST',
        body: JSON.stringify({ title: 'New task' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'active',
        item_type: 'unclassified',
      }),
    );
  });

  it('inserts item with null for optional fields not provided (notes, source_url, due_date, folder_id, parent_id)', async () => {
    const chain = makeQueryChain({ data: TEST_ITEM, error: undefined });
    const mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: TEST_USER } }) },
      from: jest.fn().mockReturnValue(chain),
    };
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await POST(
      makeRequest('http://localhost/api/items', {
        method: 'POST',
        body: JSON.stringify({ title: 'New task' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: null,
        source_url: null,
        due_date: null,
        folder_id: null,
        parent_id: null,
      }),
    );
  });

  it('uses provided item_type instead of default unclassified', async () => {
    const chain = makeQueryChain({ data: TEST_ITEM, error: undefined });
    const mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: TEST_USER } }) },
      from: jest.fn().mockReturnValue(chain),
    };
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await POST(
      makeRequest('http://localhost/api/items', {
        method: 'POST',
        body: JSON.stringify({ title: 'Code task', item_type: 'task' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ item_type: 'task' }));
  });

  it('passes through non-null optional fields (notes, source_url, due_date, folder_id)', async () => {
    const chain = makeQueryChain({ data: TEST_ITEM, error: undefined });
    const mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: TEST_USER } }) },
      from: jest.fn().mockReturnValue(chain),
    };
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const folderId = 'e4f5a6b7-c8d9-4e0f-a1b2-c3d4e5f6a7b8';

    await POST(
      makeRequest('http://localhost/api/items', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Task with extras',
          notes: 'some notes',
          source_url: 'https://example.com',
          folder_id: folderId,
        }),
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: 'some notes',
        source_url: 'https://example.com',
        folder_id: folderId,
      }),
    );
  });

  it('returns 500 on Supabase insert error', async () => {
    const chain = makeQueryChain({ data: undefined, error: { message: 'Insert error' } });
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
    expect(response.status).toBe(500);
  });
});
