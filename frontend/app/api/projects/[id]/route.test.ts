/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createClient } from '@/lib/supabase/server';

import { PATCH } from './route';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));
jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}));

const mockCreateClient = jest.mocked(createClient);

const TEST_USER = { id: 'user-123' };
// The [id] segment is UUID-validated (parseUUID), so the fixture id must be a real UUID.
const TEST_ID = '00000000-0000-4000-8000-000000000001';
const TEST_PROJECT = {
  id: TEST_ID,
  name: 'Alfred',
  key: 'ALF',
  repo_owner: 'ac3charland',
  repo_name: 'alfred',
  github_url: null,
  ref_seq: 9,
  created_at: '2026-01-01T00:00:00Z',
  description: 'My capture-first task system.',
};

interface MockResult {
  data: unknown;
  error: { message: string } | undefined;
}

function makeMockSupabase(user: { id: string } | undefined, result: MockResult) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
  };
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn().mockReturnValue(chain),
    _chain: chain,
  };
}

function patchRequest(body: unknown, id: string = TEST_ID): Request {
  return new Request(`http://localhost/api/projects/${id}`, {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const routeContext = { params: Promise.resolve({ id: TEST_ID }) };

describe('PATCH /api/projects/[id]', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest({ description: 'Described' }), routeContext);
    expect(response.status).toBe(401);
  });

  it('returns 400 when the id is not a valid UUID, before any Supabase call', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest({ description: 'Described' }, 'not-a-uuid'), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });

    expect(response.status).toBe(400);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty body', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest({}), routeContext);

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Invalid request body');
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON body', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest('not-valid-json'), routeContext);

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Invalid JSON body');
  });

  it('updates the description and returns the saved row', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_PROJECT, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(
      patchRequest({ description: 'My capture-first task system.' }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual(TEST_PROJECT);
    expect(mockSupabase.from).toHaveBeenCalledWith('projects');
    expect(mockSupabase._chain.update).toHaveBeenCalledWith({
      description: 'My capture-first task system.',
    });
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith('id', TEST_ID);
  });

  it('forwards an explicit null description — it clears the column', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: { ...TEST_PROJECT, description: null },
      error: undefined,
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(patchRequest({ description: null }), routeContext);

    expect(mockSupabase._chain.update).toHaveBeenCalledWith({ description: null });
  });

  it('never lets an unsupported field reach the update — name, key and repo stay immutable', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_PROJECT, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      patchRequest({
        description: 'Described',
        name: 'Renamed',
        key: 'XXX',
        github_url: 'https://github.com/someone/else',
        repo_owner: 'someone',
      }),
      routeContext,
    );

    expect(mockSupabase._chain.update).toHaveBeenCalledWith({ description: 'Described' });
  });

  it('returns 400 for a description over 500 characters, rather than a Postgres CHECK 500', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest({ description: 'x'.repeat(501) }), routeContext);

    expect(response.status).toBe(400);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('maps a Supabase error through mapSupabaseError', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: undefined,
      error: { message: 'Update error' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest({ description: 'Described' }), routeContext);

    expect(response.status).toBe(500);
  });
});
