import { type SupabaseEnv, patchCodeItem, patchEpic } from './supabase';

const env: SupabaseEnv = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

function mockFetch(response: Response): jest.SpyInstance {
  return jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);
}

describe('patchCodeItem', () => {
  it('PATCHes the row keyed by ref with service-role auth and returns the row count', async () => {
    const spy = mockFetch(Response.json([{ ref: 'ALF-42' }], { status: 200 }));

    const count = await patchCodeItem(env, 'ALF-42', { factory_state: 'ready_for_dev' });

    expect(count).toBe(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://proj.supabase.co/rest/v1/code_items?ref=eq.ALF-42');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ factory_state: 'ready_for_dev' }));
    const headers = init.headers as Record<string, string>;
    expect(headers['apikey']).toBe('service-role-key');
    expect(headers['Authorization']).toBe('Bearer service-role-key');
    expect(headers['Prefer']).toBe('return=representation');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('returns 0 when no row matched the ref (a ticket we do not track)', async () => {
    mockFetch(new Response('[]', { status: 200 }));
    await expect(patchCodeItem(env, 'XXX-1', { factory_state: 'done' })).resolves.toBe(0);
  });

  it('throws on a non-2xx response', async () => {
    mockFetch(new Response('permission denied', { status: 403 }));
    await expect(patchCodeItem(env, 'ALF-42', { factory_state: 'done' })).rejects.toThrow(
      /403 permission denied/,
    );
  });
});

describe('patchEpic', () => {
  it('PATCHes the epics table keyed by ref, with the same auth and row count', async () => {
    const spy = mockFetch(Response.json([{ ref: 'ALF-12' }], { status: 200 }));

    const count = await patchEpic(env, 'ALF-12', { spec_path: 'docs/specs/epics/ALF-12.html' });

    expect(count).toBe(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://proj.supabase.co/rest/v1/epics?ref=eq.ALF-12');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ spec_path: 'docs/specs/epics/ALF-12.html' }));
    const headers = init.headers as Record<string, string>;
    expect(headers['apikey']).toBe('service-role-key');
    expect(headers['Authorization']).toBe('Bearer service-role-key');
    expect(headers['Prefer']).toBe('return=representation');
  });

  it('returns 0 when no epic matched the ref', async () => {
    mockFetch(new Response('[]', { status: 200 }));
    await expect(patchEpic(env, 'XXX-1', { spec_path: 'x.html' })).resolves.toBe(0);
  });

  it('names the epics table in the error thrown on a non-2xx response', async () => {
    mockFetch(new Response('permission denied', { status: 403 }));
    await expect(patchEpic(env, 'ALF-12', { spec_path: 'x.html' })).rejects.toThrow(
      /epics \(ALF-12\).*403 permission denied/,
    );
  });
});
