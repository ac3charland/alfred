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
const PROJECT_ID = 'e4f5a6b7-c8d9-4e0f-a1b2-c3d4e5f6a7b8';
const TEST_EPIC = {
  id: 'e1',
  project_id: PROJECT_ID,
  name: 'Communication Firewall',
  notes: null,
  ref_number: 1,
  ref: 'ALF-1',
  archived_at: null,
  created_at: '2025-01-01T00:00:00Z',
};

interface MockResult {
  data: unknown;
  error: { message: string } | undefined;
}

/**
 * A chainable Supabase mock covering both a table query (`from().select().eq().order()`)
 * and an RPC (`rpc().single()`). `order` and `single` resolve with `result`.
 */
function makeChain(result: MockResult) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue(result),
    single: jest.fn().mockResolvedValue(result),
  };
  return chain;
}

function makeMockSupabase(user: { id: string } | undefined, result: MockResult) {
  const chain = makeChain(result);
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn().mockReturnValue(chain),
    rpc: jest.fn().mockReturnValue(chain),
    _chain: chain,
  };
}

const STUB_CONTEXT = { params: Promise.resolve({}) };

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

function postRequest(body: unknown): Request {
  return makeRequest('http://localhost/api/epics', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GET /api/epics', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await GET(makeRequest('http://localhost/api/epics'), STUB_CONTEXT);
    expect(response.status).toBe(401);
  });

  it('returns the epics list for an authenticated user', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [TEST_EPIC], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await GET(makeRequest('http://localhost/api/epics'), STUB_CONTEXT);
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toStrictEqual([TEST_EPIC]);
    expect(mockSupabase.from).toHaveBeenCalledWith('epics');
  });

  it('filters by project when ?project= is given (.eq on project_id)', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await GET(makeRequest(`http://localhost/api/epics?project=${PROJECT_ID}`), STUB_CONTEXT);

    expect(mockSupabase._chain.eq).toHaveBeenCalledWith('project_id', PROJECT_ID);
  });

  it('does NOT filter by project when no project param is given', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await GET(makeRequest('http://localhost/api/epics'), STUB_CONTEXT);

    expect(mockSupabase._chain.eq).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid (non-uuid) project param', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await GET(
      makeRequest('http://localhost/api/epics?project=nope'),
      STUB_CONTEXT,
    );
    expect(response.status).toBe(400);
  });

  it('returns 500 on a Supabase error', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: undefined,
      error: { message: 'DB error' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await GET(makeRequest('http://localhost/api/epics'), STUB_CONTEXT);
    expect(response.status).toBe(500);
  });
});

describe('POST /api/epics', () => {
  const VALID_BODY = { project_id: PROJECT_ID, name: 'New epic' };

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

  it('returns 400 when project_id is missing', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest({ name: 'No project' }), STUB_CONTEXT);
    expect(response.status).toBe(400);
  });

  it('calls the create_epic RPC with the project + name and returns 201', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_EPIC, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest(VALID_BODY), STUB_CONTEXT);

    expect(response.status).toBe(201);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('create_epic', {
      p_project: PROJECT_ID,
      p_name: 'New epic',
    });
    const body: unknown = await response.json();
    expect(body).toStrictEqual(TEST_EPIC);
  });

  it('returns 500 when the RPC errors', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: undefined,
      error: { message: 'rpc error' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest(VALID_BODY), STUB_CONTEXT);
    expect(response.status).toBe(500);
  });
});
