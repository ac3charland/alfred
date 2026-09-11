/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { pinClock } from '@/lib/pin-clock';
import { createClient } from '@/lib/supabase/server';

import { POST } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

pinClock('2026-09-09T17:30:00.000Z');

const MESSAGE_ID = '11111111-1111-4111-8111-111111111111';
const MESSAGE = { id: MESSAGE_ID, tier: 'today', judged_by: 'unjudged', classify_attempts: 5 };

function signedIn(
  overrides: Parameters<typeof makeSupabaseDouble>[0] = {},
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({
    comm_messages: { maybeSingle: { data: MESSAGE }, single: { data: MESSAGE } },
    ...overrides,
  });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function reclassify(): Request {
  return new Request(`http://localhost/api/comms/messages/${MESSAGE_ID}/reclassify`, {
    method: 'POST',
  });
}

const context = { params: Promise.resolve({ id: MESSAGE_ID }) };

describe('POST /api/comms/messages/[id]/reclassify', () => {
  it('stamps the request and resets the attempt count so an exhausted row is reachable', async () => {
    const supabase = signedIn();

    const response = await POST(reclassify(), context);

    expect(response.status).toBe(200);
    expect(supabase.table('comm_messages').update).toHaveBeenCalledWith({
      reclassify_requested_at: '2026-09-09T17:30:00.000Z',
      classify_attempts: 0,
    });
  });

  it('does not touch the tier — the sweep re-judges, the request only asks', async () => {
    const supabase = signedIn();

    await POST(reclassify(), context);

    const [updates] = supabase.table('comm_messages').update.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(updates).not.toHaveProperty('tier');
    expect(updates).not.toHaveProperty('verdict_id');
  });

  it('401s with no session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await POST(reclassify(), context);

    expect(response.status).toBe(401);
  });

  it('400s on a malformed id', async () => {
    signedIn();

    const response = await POST(reclassify(), { params: Promise.resolve({ id: 'nope' }) });

    expect(response.status).toBe(400);
  });

  it('404s for a message that is not there', async () => {
    signedIn({ comm_messages: { maybeSingle: { data: null } } });

    const response = await POST(reclassify(), context);

    expect(response.status).toBe(404);
  });

  it('maps a failed read to its status', async () => {
    signedIn({ comm_messages: { maybeSingle: { data: null, error: { message: 'boom' } } } });

    const response = await POST(reclassify(), context);

    expect(response.status).toBe(500);
  });

  it('maps a failed update to its status', async () => {
    signedIn({
      comm_messages: {
        maybeSingle: { data: MESSAGE },
        single: { data: null, error: { message: 'boom' } },
      },
    });

    const response = await POST(reclassify(), context);

    expect(response.status).toBe(500);
  });
});
