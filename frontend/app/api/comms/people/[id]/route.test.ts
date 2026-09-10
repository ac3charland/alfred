/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { createClient } from '@/lib/supabase/server';

import { DELETE, PATCH } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const PERSON_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const PERSON = {
  id: PERSON_ID,
  name: 'Dana W.',
  priority: 'normal',
  notes: null,
  comm_handles: [],
};

function signedIn(
  overrides: Parameters<typeof makeSupabaseDouble>[0] = {},
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({
    comm_people: { maybeSingle: { data: PERSON }, list: { data: undefined } },
    ...overrides,
  });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function signedOut(): void {
  mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(body: unknown): Request {
  return new Request(`http://localhost/api/comms/people/${PERSON_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function deleteRequest(): Request {
  return new Request(`http://localhost/api/comms/people/${PERSON_ID}`, { method: 'DELETE' });
}

describe('PATCH /api/comms/people/[id]', () => {
  it('applies only the fields the caller sent and answers with the person plus handles', async () => {
    const supabase = signedIn();

    const response = await PATCH(
      patchRequest({ name: 'Dana W.', priority: 'normal' }),
      context(PERSON_ID),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(PERSON);
    const chain = supabase.table('comm_people');
    expect(chain.update).toHaveBeenCalledWith({ name: 'Dana W.', priority: 'normal' });
    expect(chain.select).toHaveBeenCalledWith('*,comm_handles(*)');
  });

  it('clears the note when a null is sent, rather than skipping the field', async () => {
    const supabase = signedIn();

    await PATCH(patchRequest({ notes: null }), context(PERSON_ID));

    expect(supabase.table('comm_people').update).toHaveBeenCalledWith({ notes: null });
  });

  it('rejects an empty patch — there is nothing to write', async () => {
    signedIn();
    const response = await PATCH(patchRequest({}), context(PERSON_ID));
    expect(response.status).toBe(400);
  });

  it('rejects a malformed id before touching the database', async () => {
    const supabase = signedIn();
    const response = await PATCH(patchRequest({ name: 'Dana' }), context('not-a-uuid'));
    expect(response.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('answers 404 for an id the roster no longer holds', async () => {
    // `null` is what PostgREST's maybeSingle hands back when nothing matched.
    signedIn({ comm_people: { maybeSingle: { data: null } } });
    const response = await PATCH(patchRequest({ name: 'Dana' }), context(PERSON_ID));
    expect(response.status).toBe(404);
  });

  it('returns 401 without a session', async () => {
    signedOut();
    const response = await PATCH(patchRequest({ name: 'Dana' }), context(PERSON_ID));
    expect(response.status).toBe(401);
  });
});

describe('DELETE /api/comms/people/[id]', () => {
  it('drops the person and reports success', async () => {
    const supabase = signedIn();

    const response = await DELETE(deleteRequest(), context(PERSON_ID));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    const chain = supabase.table('comm_people');
    expect(chain.delete).toHaveBeenCalled();
    expect(chain.eq).toHaveBeenCalledWith('id', PERSON_ID);
  });

  it('maps a failed delete to its status', async () => {
    signedIn({ comm_people: { list: { data: undefined, error: { message: 'boom' } } } });
    const response = await DELETE(deleteRequest(), context(PERSON_ID));
    expect(response.status).toBe(500);
  });

  it('returns 401 without a session', async () => {
    signedOut();
    const response = await DELETE(deleteRequest(), context(PERSON_ID));
    expect(response.status).toBe(401);
  });
});
