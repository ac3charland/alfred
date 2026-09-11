/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { createClient } from '@/lib/supabase/server';

import { POST } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const MESSAGE_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

const MESSAGE = {
  id: MESSAGE_ID,
  account_id: ACCOUNT_ID,
  sender_handle: 'marcus@example.com',
  sender_name: 'Marcus Okonkwo',
  subject: null,
  body: 'Any chance of an intro to someone on the platform team?',
  tier: 'whenever',
  judged_by: 'model',
  cleared_at: null,
  cleared_by: null,
};

function signedIn(
  overrides: Parameters<typeof makeSupabaseDouble>[0] = {},
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({
    comm_messages: { maybeSingle: { data: MESSAGE }, single: { data: MESSAGE } },
    comm_accounts: { maybeSingle: { data: { id: ACCOUNT_ID, label: 'personal' } } },
    comm_corrections: { single: { data: { id: 'c1' } } },
    ...overrides,
  });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function changeTier(tier: unknown): Request {
  return new Request(`http://localhost/api/comms/messages/${MESSAGE_ID}/tier`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier }),
  });
}

const context = { params: Promise.resolve({ id: MESSAGE_ID }) };

describe('POST /api/comms/messages/[id]/tier', () => {
  it('records the correction with both tiers — the model’s guess and the owner’s answer', async () => {
    const supabase = signedIn();

    const response = await POST(changeTier('today'), context);

    expect(response.status).toBe(200);
    expect(supabase.table('comm_corrections').insert).toHaveBeenCalledWith(
      expect.objectContaining({
        message_id: MESSAGE_ID,
        account_label: 'personal',
        model_tier: 'whenever',
        chosen_tier: 'today',
        kind: 'tier_change',
        created_version: 0,
      }),
    );
  });

  it('moves the row and stamps the owner as its judge', async () => {
    const supabase = signedIn();

    await POST(changeTier('asap'), context);

    expect(supabase.table('comm_messages').update).toHaveBeenCalledWith({
      tier: 'asap',
      judged_by: 'owner',
      cleared_at: null,
      cleared_by: null,
    });
  });

  it('re-opens a cleared row promoted back into a counted tier — the false-negative path', async () => {
    const supabase = signedIn({
      comm_messages: {
        maybeSingle: {
          data: {
            ...MESSAGE,
            tier: 'fyi',
            cleared_at: '2026-09-01T00:00:00Z',
            cleared_by: 'reply',
          },
        },
        single: { data: MESSAGE },
      },
    });

    await POST(changeTier('today'), context);

    expect(supabase.table('comm_messages').update).toHaveBeenCalledWith({
      tier: 'today',
      judged_by: 'owner',
      cleared_at: null,
      cleared_by: null,
    });
  });

  it('leaves the exit alone when the owner demotes to the shelf', async () => {
    const supabase = signedIn();

    await POST(changeTier('fyi'), context);

    expect(supabase.table('comm_messages').update).toHaveBeenCalledWith({
      tier: 'fyi',
      judged_by: 'owner',
    });
  });

  it('is a no-op when the row is already in that tier — self-agreement teaches nothing', async () => {
    const supabase = signedIn();

    const response = await POST(changeTier('whenever'), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(MESSAGE);
    expect(supabase.from).not.toHaveBeenCalledWith('comm_corrections');
    expect(supabase.table('comm_messages').update).not.toHaveBeenCalled();
  });

  it('refuses to move the row when the correction cannot be written', async () => {
    const supabase = signedIn({
      comm_corrections: { single: { data: null, error: { message: 'insert failed' } } },
    });

    const response = await POST(changeTier('today'), context);

    expect(response.status).toBe(500);
    expect(supabase.table('comm_messages').update).not.toHaveBeenCalled();
  });

  it('401s with no session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await POST(changeTier('today'), context);

    expect(response.status).toBe(401);
  });

  it('400s on a tier outside the enum', async () => {
    signedIn();

    const response = await POST(changeTier('urgent'), context);

    expect(response.status).toBe(400);
  });

  it('400s on a malformed id', async () => {
    signedIn();

    const response = await POST(changeTier('today'), { params: Promise.resolve({ id: 'nope' }) });

    expect(response.status).toBe(400);
  });

  it('404s for a message that is not there', async () => {
    signedIn({ comm_messages: { maybeSingle: { data: null } } });

    const response = await POST(changeTier('today'), context);

    expect(response.status).toBe(404);
  });

  it('maps a failed read to its status', async () => {
    signedIn({ comm_messages: { maybeSingle: { data: null, error: { message: 'boom' } } } });

    const response = await POST(changeTier('today'), context);

    expect(response.status).toBe(500);
  });

  it('maps a failed account read to its status', async () => {
    signedIn({ comm_accounts: { maybeSingle: { data: null, error: { message: 'boom' } } } });

    const response = await POST(changeTier('today'), context);

    expect(response.status).toBe(500);
  });

  it('maps a failed update to its status', async () => {
    signedIn({
      comm_messages: {
        maybeSingle: { data: MESSAGE },
        single: { data: null, error: { message: 'boom' } },
      },
    });

    const response = await POST(changeTier('today'), context);

    expect(response.status).toBe(500);
  });
});
