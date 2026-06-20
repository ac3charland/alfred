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
const EPIC_ID = 'e4f5a6b7-c8d9-4e0f-a1b2-c3d4e5f6a7b8';
const TEST_EPIC = {
  id: EPIC_ID,
  project_id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  name: 'Communication Firewall',
  notes: 'Updated notes',
  ref_number: 1,
  ref: 'ALF-1',
  archived_at: null,
  created_at: '2025-01-01T00:00:00Z',
};

interface MockResult {
  data: unknown;
  error: { message: string } | undefined;
}

/** A chainable Supabase mock: `from().update().eq().select().single()` resolves with `result`. */
function makeChain(result: MockResult) {
  const chain = {
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
  };
  return chain;
}

function makeMockSupabase(user: { id: string } | undefined, result: MockResult) {
  const chain = makeChain(result);
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn().mockReturnValue(chain),
    _chain: chain,
  };
}

function patchRequest(body: unknown): Request {
  return new Request(`http://localhost/api/epics/${EPIC_ID}`, {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const CONTEXT = { params: Promise.resolve({ id: EPIC_ID }) };

describe('PATCH /api/epics/[id]', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest({ notes: 'hi' }), CONTEXT);
    expect(response.status).toBe(401);
  });

  it('returns 400 for an invalid JSON body', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest('not-json'), CONTEXT);
    expect(response.status).toBe(400);
  });

  it('returns 400 when the id is not a valid UUID', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(
      new Request('http://localhost/api/epics/not-a-uuid', {
        method: 'PATCH',
        body: JSON.stringify({ notes: 'hi' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    );
    expect(response.status).toBe(400);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty body (no fields to update)', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest({}), CONTEXT);
    expect(response.status).toBe(400);
  });

  it('returns 400 for a non-ISO archived_at', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest({ archived_at: 'yesterday' }), CONTEXT);
    expect(response.status).toBe(400);
  });

  it('updates name and returns the row', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: { ...TEST_EPIC, name: 'New Epic Name' },
      error: undefined,
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest({ name: 'New Epic Name' }), CONTEXT);

    expect(response.status).toBe(200);
    expect(mockSupabase._chain.update).toHaveBeenCalledWith({ name: 'New Epic Name' });
    const body: unknown = await response.json();
    expect(body).toMatchObject({ name: 'New Epic Name' });
  });

  it('returns 400 when name is an empty string', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest({ name: '' }), CONTEXT);
    expect(response.status).toBe(400);
  });

  it('updates notes and returns the row', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_EPIC, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest({ notes: 'Updated notes' }), CONTEXT);

    expect(response.status).toBe(200);
    expect(mockSupabase.from).toHaveBeenCalledWith('epics');
    expect(mockSupabase._chain.update).toHaveBeenCalledWith({ notes: 'Updated notes' });
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith('id', EPIC_ID);
    const body: unknown = await response.json();
    expect(body).toStrictEqual(TEST_EPIC);
  });

  it('archives by setting archived_at to a timestamp', async () => {
    const archivedAt = '2026-02-01T00:00:00Z';
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: { ...TEST_EPIC, archived_at: archivedAt },
      error: undefined,
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest({ archived_at: archivedAt }), CONTEXT);

    expect(response.status).toBe(200);
    expect(mockSupabase._chain.update).toHaveBeenCalledWith({ archived_at: archivedAt });
  });

  it('un-archives by sending archived_at: null (a present null clears it)', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_EPIC, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(patchRequest({ archived_at: null }), CONTEXT);

    expect(mockSupabase._chain.update).toHaveBeenCalledWith({ archived_at: null });
  });

  it('forwards only the keys the caller sent (notes absent → untouched)', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_EPIC, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(patchRequest({ archived_at: null }), CONTEXT);

    // A strict object match proves `notes` was not forwarded (only archived_at is present).
    expect(mockSupabase._chain.update).toHaveBeenCalledWith({ archived_at: null });
  });

  it('returns 500 on a Supabase error', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: undefined,
      error: { message: 'DB error' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(patchRequest({ notes: 'x' }), CONTEXT);
    expect(response.status).toBe(500);
  });
});
