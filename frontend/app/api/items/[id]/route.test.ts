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
const TEST_ITEM = { id: 'item-1', title: 'Updated', status: 'active' };
// A fixed, deterministic UUID — the [id] segment is now UUID-validated (parseUUID),
// so the fixture id must be a real UUID (a placeholder like 'item-1' would 400).
const TEST_ID = '00000000-0000-4000-8000-000000000001';

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

/** Extract the first-call first-arg from a mock as a plain object. */
function firstCallArg(mockFn: jest.Mock): Record<string, unknown> {
  const calls = mockFn.mock.calls as [Record<string, unknown>][];
  const firstCall = calls[0];
  if (!firstCall) throw new Error('mock was never called');
  return firstCall[0];
}

const routeContext = { params: Promise.resolve({ id: TEST_ID }) };

// ---------------------------------------------------------------------------
// PATCH /api/items/[id]
// ---------------------------------------------------------------------------

describe('PATCH /api/items/[id]', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated' }),
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
      new Request('http://localhost/api/items/not-a-uuid', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    );
    expect(response.status).toBe(400);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid body (bad status value)', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'archived' }),
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
      new Request(`http://localhost/api/items/${TEST_ID}`, {
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

  it('updates item and returns it on success', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toStrictEqual(TEST_ITEM);
  });

  it('sends only title in update payload when only title is provided', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'New title' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    const payload = firstCallArg(chain.update);
    expect(Object.keys(payload)).toStrictEqual(['title']);
    expect(payload['title']).toBe('New title');
  });

  it('does NOT include title in update payload when title is absent from body', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    // title key must NOT be present in the payload (strict PATCH semantics)
    const payload = firstCallArg(chain.update);
    expect(Object.keys(payload)).not.toContain('title');
  });

  it('includes notes in update payload when notes is provided', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ notes: 'new notes' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    expect(chain.update).toHaveBeenCalledWith({ notes: 'new notes' });
  });

  it('does NOT include notes in payload when notes is absent', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Only title' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    const payload = firstCallArg(chain.update);
    expect(Object.keys(payload)).not.toContain('notes');
  });

  it('includes source_url in update payload when provided', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ source_url: 'https://example.com' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    expect(chain.update).toHaveBeenCalledWith({ source_url: 'https://example.com' });
  });

  it('does NOT include source_url in payload when absent', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Only title' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    const payload = firstCallArg(chain.update);
    expect(Object.keys(payload)).not.toContain('source_url');
  });

  it('includes priority in update payload when provided', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ priority: 'high' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    expect(chain.update).toHaveBeenCalledWith({ priority: 'high' });
  });

  it('includes priority: null in payload to clear it', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ priority: null }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    expect(chain.update).toHaveBeenCalledWith({ priority: null });
  });

  it('does NOT include priority in payload when absent', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Only title' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    const payload = firstCallArg(chain.update);
    expect(Object.keys(payload)).not.toContain('priority');
  });

  it('returns 400 for an invalid priority value', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ priority: 'urgent' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );
    expect(response.status).toBe(400);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('includes due_date in update payload when provided', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ due_date: '2026-12-31' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    expect(chain.update).toHaveBeenCalledWith({ due_date: '2026-12-31' });
  });

  it('does NOT include due_date in payload when absent', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Only title' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    const payload = firstCallArg(chain.update);
    expect(Object.keys(payload)).not.toContain('due_date');
  });

  it('includes folder_id in update payload when provided', async () => {
    const folderId = 'e4f5a6b7-c8d9-4e0f-a1b2-c3d4e5f6a7b8';
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ folder_id: folderId }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    expect(chain.update).toHaveBeenCalledWith({ folder_id: folderId });
  });

  it('does NOT include folder_id in payload when absent', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Only title' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    const payload = firstCallArg(chain.update);
    expect(Object.keys(payload)).not.toContain('folder_id');
  });

  it('includes parent_id in update payload when provided', async () => {
    const parentId = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ parent_id: parentId }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    expect(chain.update).toHaveBeenCalledWith({ parent_id: parentId });
  });

  it('does NOT include parent_id in payload when absent', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Only title' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    const payload = firstCallArg(chain.update);
    expect(Object.keys(payload)).not.toContain('parent_id');
  });

  it('includes item_type in update payload when provided', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ item_type: 'task' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    expect(chain.update).toHaveBeenCalledWith({ item_type: 'task' });
  });

  it('does NOT include item_type in payload when absent', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Only title' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    const payload = firstCallArg(chain.update);
    expect(Object.keys(payload)).not.toContain('item_type');
  });

  it('includes status in update payload when provided', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    expect(chain.update).toHaveBeenCalledWith({ status: 'completed' });
  });

  it('does NOT include status in payload when absent', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Only title' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    const payload = firstCallArg(chain.update);
    expect(Object.keys(payload)).not.toContain('status');
  });

  it('updates the "items" table filtering by the correct id', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: TEST_ITEM, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );

    const chain = mockSupabase._chain;
    expect(mockSupabase.from).toHaveBeenCalledWith('items');
    expect(chain.eq).toHaveBeenCalledWith('id', TEST_ID);
  });

  it('returns 500 on Supabase error', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: undefined,
      error: { message: 'DB error' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await PATCH(
      new Request(`http://localhost/api/items/${TEST_ID}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      routeContext,
    );
    expect(response.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/items/[id]
// ---------------------------------------------------------------------------

describe('DELETE /api/items/[id]', () => {
  it('returns 401 when no session', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await DELETE(
      new Request(`http://localhost/api/items/${TEST_ID}`),
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

    const response = await DELETE(new Request('http://localhost/api/items/not-a-uuid'), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });
    expect(response.status).toBe(400);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns { success: true } on successful deletion', async () => {
    // For DELETE the chain ends with .eq() resolving directly (no .single())
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
      new Request(`http://localhost/api/items/${TEST_ID}`),
      routeContext,
    );
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toStrictEqual({ success: true });
  });

  it('deletes from the "items" table filtering by the correct id', async () => {
    const chain = {
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: undefined, error: undefined }),
    };
    const mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: TEST_USER } }) },
      from: jest.fn().mockReturnValue(chain),
    };
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    await DELETE(new Request(`http://localhost/api/items/${TEST_ID}`), routeContext);

    expect(mockSupabase.from).toHaveBeenCalledWith('items');
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
      new Request(`http://localhost/api/items/${TEST_ID}`),
      routeContext,
    );
    expect(response.status).toBe(500);
  });
});
