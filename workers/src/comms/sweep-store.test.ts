import { spyOnFetch } from '../fetch-stub';
import type { SupabaseEnv } from '../supabase';
import { clearReclassifyRequest } from './sweep-store';

const env: SupabaseEnv = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

/** A JSON `null` — the wire speaks it, this package's source may not write it. */
const WIRE_NULL: unknown = JSON.parse('null');

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function mockSupabase(response: () => Response): Call[] {
  const calls: Call[] = [];
  spyOnFetch().mockImplementation((input, init) => {
    const rawBody = init?.body;
    calls.push({
      url: input as string,
      method: init?.method ?? 'GET',
      body: typeof rawBody === 'string' ? JSON.parse(rawBody) : undefined,
    });
    return Promise.resolve(response());
  });
  return calls;
}

describe('clearReclassifyRequest', () => {
  it('sends a real JSON null, which is the only thing that empties the column', async () => {
    const calls = mockSupabase(() => Response.json([{ id: 'message-1' }]));

    await clearReclassifyRequest(env, 'message-1');

    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url).toContain('/rest/v1/comm_messages?id=eq.message-1');
    expect(calls[0]?.body).toEqual({ reclassify_requested_at: WIRE_NULL });
  });

  it('reports how many rows matched, so a vanished message is not a silent success', async () => {
    mockSupabase(() => Response.json([]));

    await expect(clearReclassifyRequest(env, 'gone')).resolves.toBe(0);
  });

  it('throws with the shared message shape when the database refuses', async () => {
    mockSupabase(() => new Response('permission denied', { status: 403 }));

    await expect(clearReclassifyRequest(env, 'message-1')).rejects.toThrow(
      'Supabase PATCH comm_messages (message-1) failed: 403 permission denied',
    );
  });
});
