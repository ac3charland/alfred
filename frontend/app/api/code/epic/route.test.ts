/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createClient } from '@/lib/supabase/server';

import { POST } from './route';

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

const TEST_RESULT = {
  epic: { id: 'epic-1', name: 'Construction inbox', ref: 'ALF-40' },
  stories: [
    { item_id: 'child-1', ref: 'ALF-43', priority: -3 },
    { item_id: 'child-2', ref: 'ALF-42', priority: -2 },
  ],
};

interface MockResult {
  data: unknown;
  error: { message: string } | undefined;
}

function makeMockSupabase(user: { id: string } | undefined, result: MockResult) {
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    rpc: jest.fn().mockResolvedValue(result),
  };
}

const STUB_CONTEXT = { params: Promise.resolve({}) };

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/code/epic', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/code/epic (the epic conversion)', () => {
  const VALID_BODY = { item_id: ITEM_ID, project_id: PROJECT_ID };

  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest(VALID_BODY), STUB_CONTEXT);
    expect(response.status).toBe(401);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
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

    const response = await POST(postRequest({ item_id: ITEM_ID }), STUB_CONTEXT);
    expect(response.status).toBe(400);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('returns 400 when an id is not a uuid', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest({ ...VALID_BODY, item_id: 'nope' }), STUB_CONTEXT);
    expect(response.status).toBe(400);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('calls convert_to_code_epic with the two ids and returns the payload with 201', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_RESULT, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await POST(postRequest(VALID_BODY), STUB_CONTEXT);

    expect(response.status).toBe(201);
    expect(mockSupabase.rpc).toHaveBeenCalledWith('convert_to_code_epic', {
      p_item: ITEM_ID,
      p_project: PROJECT_ID,
    });
    const body: unknown = await response.json();
    expect(body).toStrictEqual(TEST_RESULT);
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
