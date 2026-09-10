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
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';

const MESSAGE = {
  id: MESSAGE_ID,
  account_id: ACCOUNT_ID,
  rfc822_message_id: '<invoice-99@realplay.example>',
  sender_handle: 'dana@realplay.example',
  sender_name: 'Dana Whitfield',
  chat_name: null,
  participants: [],
  subject: 'Q3 invoice',
  body: 'Can you approve the Q3 invoice before the 5pm billing run?',
  ask: 'Needs the Q3 invoice approved before the 5pm billing run.',
};

const ACCOUNT = { id: ACCOUNT_ID, kind: 'gmail', label: 'RealPlay' };

function signedIn(
  overrides: Parameters<typeof makeSupabaseDouble>[0] = {},
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({
    comm_messages: { maybeSingle: { data: MESSAGE }, single: { data: MESSAGE } },
    comm_accounts: { maybeSingle: { data: ACCOUNT } },
    items: { single: { data: { id: ITEM_ID, title: 'x' } } },
    ...overrides,
  });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function makeItem(): Request {
  return new Request(`http://localhost/api/comms/messages/${MESSAGE_ID}/inbox-item`, {
    method: 'POST',
  });
}

const context = { params: Promise.resolve({ id: MESSAGE_ID }) };

describe('POST /api/comms/messages/[id]/inbox-item', () => {
  it('creates an untriaged Inbox item titled with the ask', async () => {
    const supabase = signedIn();

    const response = await POST(makeItem(), context);

    expect(response.status).toBe(201);
    expect(supabase.table('items').insert).toHaveBeenCalledWith({
      title: 'Needs the Q3 invoice approved before the 5pm billing run.',
      notes:
        'From Dana Whitfield via RealPlay\n\nCan you approve the Q3 invoice before the 5pm billing run?',
      source_url: 'message://%3Cinvoice-99@realplay.example%3E',
      item_type: 'unclassified',
      status: 'active',
    });
  });

  it('clears the comms row at that moment — the third exit from the queue', async () => {
    const supabase = signedIn();

    await POST(makeItem(), context);

    expect(supabase.table('comm_messages').update).toHaveBeenCalledWith({
      inbox_item_id: ITEM_ID,
      cleared_at: '2026-09-09T17:30:00.000Z',
      cleared_by: 'inbox_item',
    });
  });

  it('returns both rows: the item to hold, the message to drop from the queue', async () => {
    signedIn();

    const response = await POST(makeItem(), context);

    await expect(response.json()).resolves.toEqual({
      message: MESSAGE,
      item: { id: ITEM_ID, title: 'x' },
    });
  });

  it('falls back to the handle when nobody named the sender', async () => {
    const supabase = signedIn({
      comm_messages: {
        maybeSingle: { data: { ...MESSAGE, sender_name: null } },
        single: { data: MESSAGE },
      },
    });

    await POST(makeItem(), context);

    const [insert] = supabase.table('items').insert.mock.calls[0] as [{ notes: string }];
    expect(insert.notes).toContain('From dana@realplay.example via RealPlay');
  });

  it('carries no link when the row has nothing to open', async () => {
    const supabase = signedIn({
      comm_messages: {
        maybeSingle: { data: { ...MESSAGE, rfc822_message_id: null } },
        single: { data: MESSAGE },
      },
    });

    await POST(makeItem(), context);

    const [insert] = supabase.table('items').insert.mock.calls[0] as [{ source_url: null }];
    expect(insert.source_url).toBeNull();
  });

  it('truncates a long body rather than pasting a whole thread into the notes', async () => {
    const supabase = signedIn({
      comm_messages: {
        maybeSingle: { data: { ...MESSAGE, body: 'z'.repeat(3000) } },
        single: { data: MESSAGE },
      },
    });

    await POST(makeItem(), context);

    const [insert] = supabase.table('items').insert.mock.calls[0] as [{ notes: string }];
    expect(insert.notes).toHaveLength('From Dana Whitfield via RealPlay\n\n'.length + 2000);
  });

  it('leaves the comms row untouched when the item cannot be created', async () => {
    const supabase = signedIn({ items: { single: { data: null, error: { message: 'boom' } } } });

    const response = await POST(makeItem(), context);

    expect(response.status).toBe(500);
    expect(supabase.table('comm_messages').update).not.toHaveBeenCalled();
  });

  it('401s with no session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await POST(makeItem(), context);

    expect(response.status).toBe(401);
  });

  it('400s on a malformed id', async () => {
    signedIn();

    const response = await POST(makeItem(), { params: Promise.resolve({ id: 'nope' }) });

    expect(response.status).toBe(400);
  });

  it('404s for a message that is not there', async () => {
    signedIn({ comm_messages: { maybeSingle: { data: null } } });

    const response = await POST(makeItem(), context);

    expect(response.status).toBe(404);
  });

  it('maps a failed read to its status', async () => {
    signedIn({ comm_messages: { maybeSingle: { data: null, error: { message: 'boom' } } } });

    const response = await POST(makeItem(), context);

    expect(response.status).toBe(500);
  });

  it('maps a failed account read to its status', async () => {
    signedIn({ comm_accounts: { maybeSingle: { data: null, error: { message: 'boom' } } } });

    const response = await POST(makeItem(), context);

    expect(response.status).toBe(500);
  });

  it('maps a failed clear to its status', async () => {
    signedIn({
      comm_messages: {
        maybeSingle: { data: MESSAGE },
        single: { data: null, error: { message: 'boom' } },
      },
    });

    const response = await POST(makeItem(), context);

    expect(response.status).toBe(500);
  });
});
