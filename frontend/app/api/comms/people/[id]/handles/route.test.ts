/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { createClient } from '@/lib/supabase/server';

import { POST } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const PERSON_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const HANDLE = {
  id: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
  person_id: PERSON_ID,
  handle: '+15550102233',
  kind: 'phone',
};

function signedIn(
  overrides: Parameters<typeof makeSupabaseDouble>[0] = {},
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({
    comm_handles: { single: { data: HANDLE } },
    ...overrides,
  });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function request(body: unknown): Request {
  return new Request(`http://localhost/api/comms/people/${PERSON_ID}/handles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/comms/people/[id]/handles', () => {
  it('stores the handle normalised against the person and returns it', async () => {
    const supabase = signedIn();

    const response = await POST(
      request({ handle: '+1 (555) 010-2233', kind: 'phone' }),
      context(PERSON_ID),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(HANDLE);
    expect(supabase.table('comm_handles').insert).toHaveBeenCalledWith({
      person_id: PERSON_ID,
      handle: '+15550102233',
      kind: 'phone',
    });
  });

  it('lower-cases and trims an address', async () => {
    const supabase = signedIn();

    await POST(request({ handle: '  Dana@Example.com ', kind: 'email' }), context(PERSON_ID));

    expect(supabase.table('comm_handles').insert).toHaveBeenCalledWith({
      person_id: PERSON_ID,
      handle: 'dana@example.com',
      kind: 'email',
    });
  });

  it('answers 409 for a handle another person already claims', async () => {
    signedIn({
      comm_handles: {
        single: {
          data: undefined,
          error: { message: 'duplicate key value violates unique constraint', code: '23505' },
        },
      },
    });

    const response = await POST(
      request({ handle: 'dana@example.com', kind: 'email' }),
      context(PERSON_ID),
    );

    expect(response.status).toBe(409);
  });

  it('rejects a kind the schema does not know', async () => {
    signedIn();
    const response = await POST(request({ handle: 'x@y.z', kind: 'fax' }), context(PERSON_ID));
    expect(response.status).toBe(400);
  });

  it('rejects a malformed person id before touching the database', async () => {
    const supabase = signedIn();
    const response = await POST(request({ handle: 'x@y.z', kind: 'email' }), context('nope'));
    expect(response.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns 401 without a session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);
    const response = await POST(request({ handle: 'x@y.z', kind: 'email' }), context(PERSON_ID));
    expect(response.status).toBe(401);
  });
});
