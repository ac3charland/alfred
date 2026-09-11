/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { pinClock } from '@/lib/pin-clock';
import { createClient } from '@/lib/supabase/server';

import { PATCH } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

// The prune stamps `pruned_at` from the server clock, so pin it rather than assert around it.
pinClock('2026-07-28T12:00:00.000Z');

const mockCreateClient = jest.mocked(createClient);

const EXAMPLE_ID = 'c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f';
const PRUNED = {
  id: EXAMPLE_ID,
  chosen_tier: 'fyi',
  kind: 'nothing_to_answer',
  created_version: 3,
  pruned_version: 7,
  pruned_at: '2026-07-28T12:00:00.000Z',
};

function signedIn(
  overrides: Parameters<typeof makeSupabaseDouble>[0] = {},
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({
    comm_corrections: { maybeSingle: { data: PRUNED } },
    ...overrides,
  });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function request(body: unknown): Request {
  return new Request(`http://localhost/api/comms/examples/${EXAMPLE_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('PATCH /api/comms/examples/[id]', () => {
  it('prunes by stamping pruned_at only — the set version is the trigger’s to assign', async () => {
    const supabase = signedIn();

    const response = await PATCH(request({ pruned: true }), context(EXAMPLE_ID));

    expect(response.status).toBe(200);
    // The row comes back carrying the version the database stamped.
    await expect(response.json()).resolves.toEqual(PRUNED);
    const chain = supabase.table('comm_corrections');
    expect(chain.update).toHaveBeenCalledWith({ pruned_at: '2026-07-28T12:00:00.000Z' });
    expect(chain.eq).toHaveBeenCalledWith('id', EXAMPLE_ID);
  });

  it('restores by clearing BOTH prune columns, which the CHECK keeps null together', async () => {
    const supabase = signedIn({
      comm_corrections: {
        maybeSingle: { data: { ...PRUNED, pruned_at: null, pruned_version: null } },
      },
    });

    const response = await PATCH(request({ pruned: false }), context(EXAMPLE_ID));

    expect(response.status).toBe(200);
    expect(supabase.table('comm_corrections').update).toHaveBeenCalledWith({
      pruned_at: null,
      pruned_version: null,
    });
  });

  it('answers 404 for a correction that is not there', async () => {
    signedIn({ comm_corrections: { maybeSingle: { data: null } } });
    const response = await PATCH(request({ pruned: true }), context(EXAMPLE_ID));
    expect(response.status).toBe(404);
  });

  it('rejects a body that says nothing about pruning', async () => {
    signedIn();
    const response = await PATCH(request({}), context(EXAMPLE_ID));
    expect(response.status).toBe(400);
  });

  it('rejects a malformed id before touching the database', async () => {
    const supabase = signedIn();
    const response = await PATCH(request({ pruned: true }), context('nope'));
    expect(response.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns 401 without a session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);
    const response = await PATCH(request({ pruned: true }), context(EXAMPLE_ID));
    expect(response.status).toBe(401);
  });
});
