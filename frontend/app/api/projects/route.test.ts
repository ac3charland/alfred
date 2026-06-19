/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createClient } from '@/lib/supabase/server';

import { GET, POST } from './route';

// The GET handler reads through lib/data/code (a server-only module); neutralise
// `import 'server-only'` so the route's transitive import doesn't throw under Jest.
jest.mock('server-only', () => ({}));

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}));

const mockCreateClient = jest.mocked(createClient);

const TEST_USER = { id: 'user-123' };
const TEST_PROJECT = {
  id: 'p1',
  name: 'Alfred',
  key: 'ALF',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  github_url: 'https://github.com/ac3charland/alfred',
  ref_seq: 0,
  created_at: '2025-01-01T00:00:00Z',
};

interface MockResult {
  data: unknown;
  error: { message: string; code?: string } | undefined;
}

function makeQueryChain(result: MockResult) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue(result),
    single: jest.fn().mockResolvedValue(result),
  };
  return chain;
}

function makeMockSupabase(user: { id: string } | undefined, result: MockResult) {
  const chain = makeQueryChain(result);
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn().mockReturnValue(chain),
    _chain: chain,
  };
}

const STUB_CONTEXT = { params: Promise.resolve({}) };

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

const VALID_BODY = {
  name: 'Alfred',
  github_url: 'https://github.com/ac3charland/alfred',
  key: 'ALF',
};

function postRequest(body: unknown): Request {
  return makeRequest('http://localhost/api/projects', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GET /api/projects', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await GET(makeRequest('http://localhost/api/projects'), STUB_CONTEXT);
    expect(response.status).toBe(401);
  });

  it('returns the projects list for an authenticated user', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [TEST_PROJECT], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await GET(makeRequest('http://localhost/api/projects'), STUB_CONTEXT);
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toStrictEqual([TEST_PROJECT]);
  });

  it('queries the "projects" table ordered by created_at ascending', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await GET(makeRequest('http://localhost/api/projects'), STUB_CONTEXT);

    expect(mockSupabase.from).toHaveBeenCalledWith('projects');
    expect(mockSupabase._chain.order).toHaveBeenCalledWith('created_at', { ascending: true });
  });

  it('returns 500 on a Supabase error', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: undefined,
      error: { message: 'DB error' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await GET(makeRequest('http://localhost/api/projects'), STUB_CONTEXT);
    expect(response.status).toBe(500);
  });
});

describe('POST /api/projects', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest(VALID_BODY), STUB_CONTEXT);
    expect(response.status).toBe(401);
  });

  it('returns 400 for an invalid JSON body', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest('not-json'), STUB_CONTEXT);
    expect(response.status).toBe(400);
  });

  it('returns 400 when the key fails the 3-char regex', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest({ ...VALID_BODY, key: 'al' }), STUB_CONTEXT);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Invalid request body');
  });

  it('returns 400 when the github_url is not a URL', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest({ ...VALID_BODY, github_url: 'nope' }), STUB_CONTEXT);
    expect(response.status).toBe(400);
  });

  it('derives repo_owner/repo_name from the github_url and inserts', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_PROJECT, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest(VALID_BODY), STUB_CONTEXT);

    expect(response.status).toBe(201);
    expect(mockSupabase.from).toHaveBeenCalledWith('projects');
    expect(mockSupabase._chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Alfred',
        key: 'ALF',
        repo_owner: 'ac3charland',
        repo_name: 'alfred',
        github_url: 'https://github.com/ac3charland/alfred',
      }),
    );
  });

  it('returns 409 on a unique-constraint violation (duplicate key)', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: undefined,
      error: { message: 'duplicate key value', code: '23505' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest(VALID_BODY), STUB_CONTEXT);
    expect(response.status).toBe(409);
  });

  it('returns 400 on a foreign-key violation', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: undefined,
      error: { message: 'fk violation', code: '23503' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest(VALID_BODY), STUB_CONTEXT);
    expect(response.status).toBe(400);
  });

  it('returns 500 on a non-unique Supabase insert error', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: undefined,
      error: { message: 'other error' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest(VALID_BODY), STUB_CONTEXT);
    expect(response.status).toBe(500);
  });
});
