/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createClient } from '@/lib/supabase/server';

import { DELETE, PATCH } from './route';

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));
jest.mock('@/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}));

const mockCreateClient = jest.mocked(createClient);

const TEST_USER = { id: 'user-123' };
// A fixed, deterministic UUID — the [id] segment is now UUID-validated (parseUUID),
// so the fixture id must be a real UUID (a placeholder like 'folder-1' would 400).
const TEST_ID = '00000000-0000-4000-8000-000000000001';
const TEST_FOLDER = { id: TEST_ID, name: 'Renamed', created_at: '2026-01-01T00:00:00Z' };

interface MockResult {
  data: unknown;
  error: { message: string } | undefined;
}

function makeQueryChain(result: MockResult) {
  return {
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
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

const routeContext = { params: Promise.resolve({ id: TEST_ID }) };

// ---------------------------------------------------------------------------
// PATCH /api/folders/[id]
// ---------------------------------------------------------------------------

describe('PATCH /api/folders/[id]', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(
      new Request(`http://localhost/api/folders/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );
    expect(response.status).toBe(401);
  });

  it('returns 400 when the id is not a valid UUID', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(
      new Request('http://localhost/api/folders/not-a-uuid', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    );
    expect(response.status).toBe(400);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns 400 when the body carries neither a name nor a rank', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(
      new Request(`http://localhost/api/folders/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Invalid request body');
  });

  it('returns 400 for invalid JSON body', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(
      new Request(`http://localhost/api/folders/${TEST_ID}`, {
        method: 'PATCH',
        body: 'not-valid-json',
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Invalid JSON body');
  });

  it('renames folder and returns updated folder', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_FOLDER, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(
      new Request(`http://localhost/api/folders/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toStrictEqual(TEST_FOLDER);
  });

  it('updates the "folders" table with the correct name and id filter', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_FOLDER, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/folders/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    expect(mockSupabase.from).toHaveBeenCalledWith('folders');
    expect(chain.update).toHaveBeenCalledWith({ name: 'Renamed' });
    expect(chain.eq).toHaveBeenCalledWith('id', TEST_ID);
  });

  it('reorders a folder by writing only its manual rank, leaving the name alone', async () => {
    const reordered = { ...TEST_FOLDER, sort_order: 1.5 };
    const mockSupabase = makeMockSupabase(TEST_USER, { data: reordered, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(
      new Request(`http://localhost/api/folders/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ sort_order: 1.5 }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual(reordered);
    expect(mockSupabase._chain.update).toHaveBeenCalledWith({ sort_order: 1.5 });
  });

  it('accepts a fractional rank — the midpoint between two neighbours', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_FOLDER, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/folders/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed', sort_order: 0.0625 }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    expect(mockSupabase._chain.update).toHaveBeenCalledWith({
      name: 'Renamed',
      sort_order: 0.0625,
    });
  });

  it('writes a description-only body, leaving the name and rank alone', async () => {
    const described = { ...TEST_FOLDER, description: 'Doctors, dentist, the gym.' };
    const mockSupabase = makeMockSupabase(TEST_USER, { data: described, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(
      new Request(`http://localhost/api/folders/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ description: 'Doctors, dentist, the gym.' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual(described);
    expect(mockSupabase._chain.update).toHaveBeenCalledWith({
      description: 'Doctors, dentist, the gym.',
    });
  });

  it('forwards an explicit null description — it clears the column rather than being dropped', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_FOLDER, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/folders/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ description: null }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    expect(mockSupabase._chain.update).toHaveBeenCalledWith({ description: null });
  });

  it('leaves the description untouched on a rename — an absent key never reaches the update', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_FOLDER, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/folders/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    expect(mockSupabase._chain.update).toHaveBeenCalledWith({ name: 'Renamed' });
  });

  it('returns 400 for a description over 500 characters, before any Supabase call', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(
      new Request(`http://localhost/api/folders/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ description: 'x'.repeat(501) }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    expect(response.status).toBe(400);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns 400 when sort_order is not a number', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(
      new Request(`http://localhost/api/folders/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ sort_order: 'first' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    expect(response.status).toBe(400);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns 500 when Supabase returns an error on update', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: undefined,
      error: { message: 'Update error' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(
      new Request(`http://localhost/api/folders/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Renamed' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );
    expect(response.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/folders/[id]
// ---------------------------------------------------------------------------

describe('DELETE /api/folders/[id]', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await DELETE(
      new Request(`http://localhost/api/folders/${TEST_ID}`),
      routeContext,
    );
    expect(response.status).toBe(401);
  });

  it('returns 400 when the id is not a valid UUID', async () => {
    const chain = {
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: undefined, error: undefined }),
    };
    const mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: TEST_USER } }) },
      from: jest.fn().mockReturnValue(chain),
    };
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await DELETE(new Request('http://localhost/api/folders/not-a-uuid'), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });
    expect(response.status).toBe(400);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns { success: true } on successful delete', async () => {
    const chain = {
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: undefined, error: undefined }),
    };
    const mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: TEST_USER } }) },
      from: jest.fn().mockReturnValue(chain),
    };
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await DELETE(
      new Request(`http://localhost/api/folders/${TEST_ID}`),
      routeContext,
    );
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toStrictEqual({ success: true });
  });

  it('deletes from the "folders" table filtering by the correct id', async () => {
    const chain = {
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: undefined, error: undefined }),
    };
    const mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: TEST_USER } }) },
      from: jest.fn().mockReturnValue(chain),
    };
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await DELETE(new Request(`http://localhost/api/folders/${TEST_ID}`), routeContext);

    expect(mockSupabase.from).toHaveBeenCalledWith('folders');
    expect(chain.eq).toHaveBeenCalledWith('id', TEST_ID);
  });

  it('returns 500 on Supabase error', async () => {
    const chain = {
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: undefined, error: { message: 'DB error' } }),
    };
    const mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: TEST_USER } }) },
      from: jest.fn().mockReturnValue(chain),
    };
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await DELETE(
      new Request(`http://localhost/api/folders/${TEST_ID}`),
      routeContext,
    );
    expect(response.status).toBe(500);
  });
});
