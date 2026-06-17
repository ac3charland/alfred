/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
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
const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const EPIC_ID = '33333333-3333-4333-8333-333333333333';

const TEST_STORY = { item_id: ITEM_ID, ref: 'ALF-9', factory_state: 'needs_refinement' };
const TEST_SIDECAR = {
  item_id: ITEM_ID,
  project_id: PROJECT_ID,
  epic_id: EPIC_ID,
  ref: 'ALF-9',
  ref_number: 9,
  factory_state: 'needs_refinement',
};

interface MockResult {
  data: unknown;
  error: { message: string } | undefined;
}

/**
 * Chainable mock covering the v_code_stories read
 * (`from().select().order().overrideTypes()`) and the gate RPC (`rpc().single()`).
 * `overrideTypes` and `single` resolve with `result`.
 */
function makeChain(result: MockResult) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    overrideTypes: jest.fn().mockResolvedValue(result),
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
  return makeRequest('http://localhost/api/code', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GET /api/code', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await GET(makeRequest('http://localhost/api/code'), STUB_CONTEXT);
    expect(response.status).toBe(401);
  });

  it('returns the code-story list from v_code_stories, ordered by ref_number', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: [TEST_STORY], error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await GET(makeRequest('http://localhost/api/code'), STUB_CONTEXT);
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toStrictEqual([TEST_STORY]);
    expect(mockSupabase.from).toHaveBeenCalledWith('v_code_stories');
    expect(mockSupabase._chain.order).toHaveBeenCalledWith('ref_number', { ascending: true });
  });

  it('returns 500 on a Supabase error', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: undefined,
      error: { message: 'DB error' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await GET(makeRequest('http://localhost/api/code'), STUB_CONTEXT);
    expect(response.status).toBe(500);
  });
});

describe('POST /api/code (the gate)', () => {
  const VALID_BODY = { item_id: ITEM_ID, project_id: PROJECT_ID, epic_id: EPIC_ID };

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

  it('returns 400 when a required id is missing', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(
      postRequest({ item_id: ITEM_ID, project_id: PROJECT_ID }),
      STUB_CONTEXT,
    );
    expect(response.status).toBe(400);
  });

  it('returns 400 when an id is not a uuid', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest({ ...VALID_BODY, item_id: 'nope' }), STUB_CONTEXT);
    expect(response.status).toBe(400);
  });

  it('calls enter_code_module with the three ids and returns 201', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_SIDECAR, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest(VALID_BODY), STUB_CONTEXT);

    expect(response.status).toBe(201);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('enter_code_module', {
      p_item: ITEM_ID,
      p_project: PROJECT_ID,
      p_epic: EPIC_ID,
    });
    const body: unknown = await response.json();
    expect(body).toStrictEqual(TEST_SIDECAR);
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

describe('POST /api/code (new story)', () => {
  const TITLE = 'Wire the webhook';
  const VALID_NEW_BODY = { title: TITLE, project_id: PROJECT_ID, epic_id: EPIC_ID };
  const NEW_SIDECAR = {
    item_id: '44444444-4444-4444-8444-444444444444',
    project_id: PROJECT_ID,
    epic_id: EPIC_ID,
    ref: 'ALF-10',
    ref_number: 10,
    factory_state: 'needs_refinement',
  };

  it('calls create_code_story with the right params and returns 201', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: NEW_SIDECAR, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest(VALID_NEW_BODY), STUB_CONTEXT);

    expect(response.status).toBe(201);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('create_code_story', {
      p_project: PROJECT_ID,
      p_epic: EPIC_ID,
      p_title: TITLE,
      p_notes: null,
    });
    const body: unknown = await response.json();
    expect(body).toStrictEqual(NEW_SIDECAR);
  });

  it('forwards a supplied notes value to create_code_story', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: NEW_SIDECAR, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await POST(postRequest({ ...VALID_NEW_BODY, notes: 'Some context' }), STUB_CONTEXT);

    expect(mockSupabase.rpc).toHaveBeenCalledWith('create_code_story', {
      p_project: PROJECT_ID,
      p_epic: EPIC_ID,
      p_title: TITLE,
      p_notes: 'Some context',
    });
  });

  it('returns 400 when title is missing and item_id is also absent', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(
      postRequest({ project_id: PROJECT_ID, epic_id: EPIC_ID }),
      STUB_CONTEXT,
    );
    expect(response.status).toBe(400);
  });

  it('returns 400 when title is an empty string', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(
      postRequest({ title: '', project_id: PROJECT_ID, epic_id: EPIC_ID }),
      STUB_CONTEXT,
    );
    expect(response.status).toBe(400);
  });

  it('returns 500 when create_code_story errors', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: undefined,
      error: { message: 'rpc error' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest(VALID_NEW_BODY), STUB_CONTEXT);
    expect(response.status).toBe(500);
  });
});
