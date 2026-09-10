/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { pinClock } from '@/lib/pin-clock';
import { createClient } from '@/lib/supabase/server';

import { POST } from './route';

// `withSession` reaches the admin client module, whose `import 'server-only'` throws outside a
// Server Component context; neutralise it under Jest.
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

pinClock('2026-09-09T17:30:00.000Z');

const MESSAGE_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

const MESSAGE = {
  id: MESSAGE_ID,
  account_id: ACCOUNT_ID,
  sender_handle: 'dana@realplay.example',
  sender_name: 'Dana Whitfield',
  subject: 'Q3 invoice',
  body: '  Can you approve the Q3 invoice before the 5pm billing run?  ',
  tier: 'asap',
  judged_by: 'model',
  cleared_at: null,
  cleared_by: null,
};

const ACCOUNT = { id: ACCOUNT_ID, label: 'RealPlay' };

function signedIn(
  overrides: Parameters<typeof makeSupabaseDouble>[0] = {},
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({
    comm_messages: { maybeSingle: { data: MESSAGE }, single: { data: MESSAGE } },
    comm_accounts: { maybeSingle: { data: ACCOUNT } },
    comm_corrections: { single: { data: { id: 'c1' } } },
    ...overrides,
  });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function clear(exit: unknown, id = MESSAGE_ID): Request {
  return new Request(`http://localhost/api/comms/messages/${id}/clear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exit }),
  });
}

const context = { params: Promise.resolve({ id: MESSAGE_ID }) };

describe('POST /api/comms/messages/[id]/clear — not replying', () => {
  it('clears the row and records nothing: the verdict was right', async () => {
    const supabase = signedIn();

    const response = await POST(clear('not_replying'), context);

    expect(response.status).toBe(200);
    expect(supabase.table('comm_messages').update).toHaveBeenCalledWith({
      cleared_at: '2026-09-09T17:30:00.000Z',
      cleared_by: 'not_replying',
    });
    expect(supabase.from).not.toHaveBeenCalledWith('comm_corrections');
  });

  it('leaves the tier alone — declining to answer is not a re-judgment', async () => {
    const supabase = signedIn();

    await POST(clear('not_replying'), context);

    const [updates] = supabase.table('comm_messages').update.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(updates).not.toHaveProperty('tier');
    expect(updates).not.toHaveProperty('judged_by');
  });
});

describe('POST /api/comms/messages/[id]/clear — nothing to answer', () => {
  it('records a demotion correction carrying the message text', async () => {
    const supabase = signedIn();

    const response = await POST(clear('nothing_to_answer'), context);

    expect(response.status).toBe(200);
    expect(supabase.table('comm_corrections').insert).toHaveBeenCalledWith({
      message_id: MESSAGE_ID,
      account_label: 'RealPlay',
      sender_handle: 'dana@realplay.example',
      sender_name: 'Dana Whitfield',
      subject: 'Q3 invoice',
      body_excerpt: 'Can you approve the Q3 invoice before the 5pm billing run?',
      model_tier: 'asap',
      chosen_tier: 'fyi',
      kind: 'nothing_to_answer',
      created_version: 0,
    });
  });

  it('re-tiers the row to FYI and stamps the owner as the judge', async () => {
    const supabase = signedIn();

    await POST(clear('nothing_to_answer'), context);

    expect(supabase.table('comm_messages').update).toHaveBeenCalledWith({
      tier: 'fyi',
      judged_by: 'owner',
      cleared_at: '2026-09-09T17:30:00.000Z',
      cleared_by: 'nothing_to_answer',
    });
  });

  it('carries a null model tier for a row that was never judged', async () => {
    const supabase = signedIn({
      comm_messages: {
        maybeSingle: { data: { ...MESSAGE, tier: null, judged_by: null } },
        single: { data: MESSAGE },
      },
    });

    await POST(clear('nothing_to_answer'), context);

    const [insert] = supabase.table('comm_corrections').insert.mock.calls[0] as [
      { model_tier: string | null },
    ];
    expect(insert.model_tier).toBeNull();
  });

  it('truncates the excerpt so one example cannot grow the prompt without bound', async () => {
    const supabase = signedIn({
      comm_messages: {
        maybeSingle: { data: { ...MESSAGE, body: 'y'.repeat(900) } },
        single: { data: MESSAGE },
      },
    });

    await POST(clear('nothing_to_answer'), context);

    const [insert] = supabase.table('comm_corrections').insert.mock.calls[0] as [
      { body_excerpt: string },
    ];
    expect(insert.body_excerpt).toHaveLength(600);
  });

  it('stores no excerpt at all for a body-less row', async () => {
    const supabase = signedIn({
      comm_messages: {
        maybeSingle: { data: { ...MESSAGE, body: ' '.repeat(3) } },
        single: { data: MESSAGE },
      },
    });

    await POST(clear('nothing_to_answer'), context);

    const [insert] = supabase.table('comm_corrections').insert.mock.calls[0] as [
      { body_excerpt: string | null },
    ];
    expect(insert.body_excerpt).toBeNull();
  });

  it('names the gap when the account has gone missing', async () => {
    const supabase = signedIn({ comm_accounts: { maybeSingle: { data: null } } });

    await POST(clear('nothing_to_answer'), context);

    const [insert] = supabase.table('comm_corrections').insert.mock.calls[0] as [
      { account_label: string },
    ];
    expect(insert.account_label).toBe('unknown account');
  });

  it('refuses to clear when the correction cannot be written — the record is the point', async () => {
    const supabase = signedIn({
      comm_corrections: { single: { data: null, error: { message: 'insert failed' } } },
    });

    const response = await POST(clear('nothing_to_answer'), context);

    expect(response.status).toBe(500);
    expect(supabase.table('comm_messages').update).not.toHaveBeenCalled();
  });
});

describe('POST /api/comms/messages/[id]/clear — refusals', () => {
  it('401s with no session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await POST(clear('not_replying'), context);

    expect(response.status).toBe(401);
  });

  it('400s on a malformed id', async () => {
    signedIn();

    const response = await POST(clear('not_replying', 'nope'), {
      params: Promise.resolve({ id: 'nope' }),
    });

    expect(response.status).toBe(400);
  });

  it('400s on an exit the module does not have', async () => {
    signedIn();

    const response = await POST(clear('archived'), context);

    expect(response.status).toBe(400);
  });

  it('404s for a message that is not there', async () => {
    signedIn({ comm_messages: { maybeSingle: { data: null } } });

    const response = await POST(clear('not_replying'), context);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Message not found' });
  });

  it('maps a failed read to its status', async () => {
    signedIn({ comm_messages: { maybeSingle: { data: null, error: { message: 'boom' } } } });

    const response = await POST(clear('not_replying'), context);

    expect(response.status).toBe(500);
  });

  it('maps a failed account read to its status', async () => {
    signedIn({ comm_accounts: { maybeSingle: { data: null, error: { message: 'boom' } } } });

    const response = await POST(clear('nothing_to_answer'), context);

    expect(response.status).toBe(500);
  });

  it('maps a failed update to its status', async () => {
    signedIn({
      comm_messages: {
        maybeSingle: { data: MESSAGE },
        single: { data: null, error: { message: 'boom' } },
      },
    });

    const response = await POST(clear('not_replying'), context);

    expect(response.status).toBe(500);
  });
});
