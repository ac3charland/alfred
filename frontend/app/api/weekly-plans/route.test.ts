/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { POST } from './route';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}));

const mockCreateClient = jest.mocked(createClient);
const mockCreateAdminClient = jest.mocked(createAdminClient);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const API_KEY = 'test-ingest-key';
const TEST_USER = { id: 'user-123' };
const PLAN_HTML =
  '<!DOCTYPE html><html><head><title>Week 12</title></head><body><h1>Week 12</h1></body></html>';
const SAVED_ROW = { id: 'plan-1', uploaded_at: '2026-07-24T21:03:11.482Z' };

interface MockResult {
  data: unknown;
  error: { message: string; code?: string } | undefined;
}

function makeQueryChain(result: MockResult) {
  return {
    insert: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
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

/** A POST carrying the API key, a Content-Type, and the given raw body. */
function keyedRequest(body: string, contentType = 'text/html'): Request {
  return new Request('http://localhost/api/weekly-plans', {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, 'Content-Type': contentType },
    body,
  });
}

beforeEach(() => {
  process.env.INGEST_API_KEY = API_KEY;
});

// ---------------------------------------------------------------------------
// POST /api/weekly-plans
// ---------------------------------------------------------------------------

describe('POST /api/weekly-plans', () => {
  it('returns 401 with neither an API key nor a session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(
      new Request('http://localhost/api/weekly-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'text/html' },
        body: PLAN_HTML,
      }),
    );

    expect(response.status).toBe(401);
  });

  it('accepts a logged-in session instead of the API key (same dual path as /api/items)', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: SAVED_ROW, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(
      new Request('http://localhost/api/weekly-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'text/html' },
        body: PLAN_HTML,
      }),
    );

    expect(response.status).toBe(201);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('routes a valid API key through the ADMIN client (bypassing RLS)', async () => {
    const adminSupabase = makeMockSupabase(undefined, { data: SAVED_ROW, error: undefined });
    mockCreateAdminClient.mockReturnValue(adminSupabase as never);

    const response = await POST(keyedRequest(PLAN_HTML));

    expect(response.status).toBe(201);
    expect(mockCreateAdminClient).toHaveBeenCalled();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('stores the document verbatim and returns 201 { id, uploaded_at }', async () => {
    const adminSupabase = makeMockSupabase(undefined, { data: SAVED_ROW, error: undefined });
    mockCreateAdminClient.mockReturnValue(adminSupabase as never);

    const response = await POST(keyedRequest(PLAN_HTML));

    expect(response.status).toBe(201);
    expect(adminSupabase.from).toHaveBeenCalledWith('weekly_plans');
    expect(adminSupabase._chain.insert).toHaveBeenCalledWith({ html: PLAN_HTML });
    expect(await response.json()).toStrictEqual(SAVED_ROW);
  });

  it('returns only id + uploaded_at, never echoing the document back', async () => {
    const adminSupabase = makeMockSupabase(undefined, { data: SAVED_ROW, error: undefined });
    mockCreateAdminClient.mockReturnValue(adminSupabase as never);

    await POST(keyedRequest(PLAN_HTML));

    expect(adminSupabase._chain.select).toHaveBeenCalledWith('id, uploaded_at');
  });

  it('returns 415 when the Content-Type is not text/html', async () => {
    const adminSupabase = makeMockSupabase(undefined, { data: SAVED_ROW, error: undefined });
    mockCreateAdminClient.mockReturnValue(adminSupabase as never);

    const response = await POST(keyedRequest(PLAN_HTML, 'application/json'));

    expect(response.status).toBe(415);
    expect(await response.json()).toStrictEqual({ error: 'Expected Content-Type: text/html' });
  });

  it('returns 415 when the Content-Type header is absent', async () => {
    const adminSupabase = makeMockSupabase(undefined, { data: SAVED_ROW, error: undefined });
    mockCreateAdminClient.mockReturnValue(adminSupabase as never);

    // Request() defaults an absent Content-Type to text/plain for a string body — send a
    // Blob with an empty type so the header really is missing.
    const response = await POST(
      new Request('http://localhost/api/weekly-plans', {
        method: 'POST',
        headers: { 'x-api-key': API_KEY },
        body: new Blob([PLAN_HTML], { type: '' }),
      }),
    );

    expect(response.status).toBe(415);
  });

  it('accepts text/html with a charset parameter', async () => {
    const adminSupabase = makeMockSupabase(undefined, { data: SAVED_ROW, error: undefined });
    mockCreateAdminClient.mockReturnValue(adminSupabase as never);

    const response = await POST(keyedRequest(PLAN_HTML, 'text/html; charset=utf-8'));

    expect(response.status).toBe(201);
  });

  it('returns 400 for an empty body', async () => {
    const adminSupabase = makeMockSupabase(undefined, { data: SAVED_ROW, error: undefined });
    mockCreateAdminClient.mockReturnValue(adminSupabase as never);

    const response = await POST(keyedRequest(''));

    expect(response.status).toBe(400);
    expect(await response.json()).toStrictEqual({ error: 'Empty request body' });
  });

  it('returns 400 for a whitespace-only body', async () => {
    const adminSupabase = makeMockSupabase(undefined, { data: SAVED_ROW, error: undefined });
    mockCreateAdminClient.mockReturnValue(adminSupabase as never);

    const response = await POST(keyedRequest('   \n\t  '));

    expect(response.status).toBe(400);
    expect(await response.json()).toStrictEqual({ error: 'Empty request body' });
  });

  it('returns 413 for a body over 1MB', async () => {
    const adminSupabase = makeMockSupabase(undefined, { data: SAVED_ROW, error: undefined });
    mockCreateAdminClient.mockReturnValue(adminSupabase as never);

    const oversize = `<!DOCTYPE html><html><body>${'x'.repeat(1024 * 1024)}</body></html>`;
    const response = await POST(keyedRequest(oversize));

    expect(response.status).toBe(413);
    expect(await response.json()).toStrictEqual({ error: 'Weekly plan exceeds 1MB' });
    expect(adminSupabase._chain.insert).not.toHaveBeenCalled();
  });

  it('accepts a body just under the 1MB cap', async () => {
    const adminSupabase = makeMockSupabase(undefined, { data: SAVED_ROW, error: undefined });
    mockCreateAdminClient.mockReturnValue(adminSupabase as never);

    const prefix = '<!DOCTYPE html><html><body>';
    const suffix = '</body></html>';
    const filler = 'x'.repeat(1024 * 1024 - prefix.length - suffix.length);
    const response = await POST(keyedRequest(`${prefix}${filler}${suffix}`));

    expect(response.status).toBe(201);
  });

  it('returns 400 when the body is not an HTML document', async () => {
    const adminSupabase = makeMockSupabase(undefined, { data: SAVED_ROW, error: undefined });
    mockCreateAdminClient.mockReturnValue(adminSupabase as never);

    const response = await POST(keyedRequest('# Just some markdown'));

    expect(response.status).toBe(400);
    expect(await response.json()).toStrictEqual({ error: 'Body must be an HTML document' });
    expect(adminSupabase._chain.insert).not.toHaveBeenCalled();
  });

  it('maps a Supabase insert failure through the shared error envelope', async () => {
    const adminSupabase = makeMockSupabase(undefined, {
      data: undefined,
      error: { message: 'DB exploded' },
    });
    mockCreateAdminClient.mockReturnValue(adminSupabase as never);

    const response = await POST(keyedRequest(PLAN_HTML));

    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({ error: 'DB exploded' });
  });
});
