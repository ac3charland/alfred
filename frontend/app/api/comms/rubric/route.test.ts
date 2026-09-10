/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { createClient } from '@/lib/supabase/server';

import { GET, POST } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const V1 = { id: 'r1', version: 1, body: 'Anything from my wife is ASAP.', created_at: 'x' };
const V2 = {
  id: 'r2',
  version: 2,
  body: 'Anything from my wife is ASAP. Invoices too.',
  created_at: 'y',
};

/**
 * The save reads the current head and then inserts, so the table is stubbed on BOTH terminals:
 * `maybeSingle` answers the read, `single` the insert, and `list` the whole-history GET.
 */
function signedIn(
  overrides: Parameters<typeof makeSupabaseDouble>[0] = {},
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({
    comm_rubrics: {
      list: { data: [V2, V1] },
      maybeSingle: { data: { version: 1 } },
      single: { data: V2 },
    },
    ...overrides,
  });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function signedOut(): void {
  mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);
}

const STUB_CONTEXT = { params: Promise.resolve({}) };

function getRequest(): Request {
  return new Request('http://localhost/api/comms/rubric');
}

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/comms/rubric', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/comms/rubric', () => {
  it('returns every version, newest first', async () => {
    const supabase = signedIn();

    const response = await GET(getRequest(), STUB_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([V2, V1]);
    expect(supabase.table('comm_rubrics').order).toHaveBeenCalledWith('version', {
      ascending: false,
    });
  });

  it('returns 401 without a session', async () => {
    signedOut();
    const response = await GET(getRequest(), STUB_CONTEXT);
    expect(response.status).toBe(401);
  });
});

describe('POST /api/comms/rubric', () => {
  it('writes a NEW version one above the current head, never updating the old row', async () => {
    const supabase = signedIn();

    const response = await POST(postRequest({ body: V2.body }), STUB_CONTEXT);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(V2);
    expect(supabase.table('comm_rubrics').insert).toHaveBeenCalledWith({
      version: 2,
      body: V2.body,
    });
  });

  it('starts at version 1 when nothing has ever been written', async () => {
    // `null` is the empty-table answer maybeSingle gives.
    const supabase = signedIn({
      comm_rubrics: { maybeSingle: { data: null }, single: { data: V1 } },
    });

    await POST(postRequest({ body: V1.body }), STUB_CONTEXT);

    expect(supabase.table('comm_rubrics').insert).toHaveBeenCalledWith({
      version: 1,
      body: V1.body,
    });
  });

  it('surfaces the unique index as a 409 when two saves race for the same number', async () => {
    signedIn({
      comm_rubrics: {
        maybeSingle: { data: { version: 3 } },
        single: {
          data: undefined,
          error: { message: 'duplicate key value violates unique constraint', code: '23505' },
        },
      },
    });

    const response = await POST(postRequest({ body: 'Be responsive.' }), STUB_CONTEXT);

    expect(response.status).toBe(409);
  });

  it('rejects an empty rubric', async () => {
    signedIn();
    const response = await POST(postRequest({ body: ' '.repeat(3) }), STUB_CONTEXT);
    expect(response.status).toBe(400);
  });

  it('returns 401 without a session', async () => {
    signedOut();
    const response = await POST(postRequest({ body: 'x' }), STUB_CONTEXT);
    expect(response.status).toBe(401);
  });
});
