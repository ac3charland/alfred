/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { createClient } from '@/lib/supabase/server';

import { POST } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

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
  inbox_item_id: null,
};

const ACCOUNT = { id: ACCOUNT_ID, kind: 'gmail', label: 'RealPlay' };

const ITEM = { id: ITEM_ID, title: 'Needs the Q3 invoice approved before the 5pm billing run.' };

interface RpcResult {
  data: unknown;
  error: { message: string; code?: string } | undefined;
}

/** The `comm_create_inbox_item` RPC's shape, matching a message freshly linked to ITEM. */
function rpcResult(overrides: { created?: boolean } = {}): RpcResult {
  return {
    data: {
      item: ITEM,
      message: { ...MESSAGE, inbox_item_id: ITEM_ID },
      created: overrides.created ?? true,
    },
    error: undefined,
  };
}

function signedIn(
  tables: Parameters<typeof makeSupabaseDouble>[0] = {},
  rpc: RpcResult = rpcResult(),
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble(
    {
      comm_messages: { maybeSingle: { data: MESSAGE } },
      comm_accounts: { maybeSingle: { data: ACCOUNT } },
      ...tables,
    },
    rpc,
  );
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
  it('calls comm_create_inbox_item with the ask as the title', async () => {
    const supabase = signedIn();

    const response = await POST(makeItem(), context);

    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith('comm_create_inbox_item', {
      p_message: MESSAGE_ID,
      p_title: 'Needs the Q3 invoice approved before the 5pm billing run.',
      p_notes:
        'From Dana Whitfield via RealPlay\n\nCan you approve the Q3 invoice before the 5pm billing run?',
      p_source_url: 'message://%3Cinvoice-99@realplay.example%3E',
    });
  });

  // The two writes (INSERT items, then UPDATE comm_messages) used to be separate Supabase
  // calls, so a genuine server-side failure between them could leave the item orphaned with
  // nothing pointing back at it — a retry couldn't tell "both writes landed" from "only the
  // first did", and minted a second item on top of the first. Routing the whole write through
  // one `comm_create_inbox_item` RPC call closes that gap structurally: there is no second,
  // independent statement left for the route itself to fail after the first has committed. Red
  // against the old two-write route.ts (which calls `.from('items').insert()` and
  // `.from('comm_messages').update()` directly and never calls this RPC at all); green once the
  // route delegates to the RPC. Real atomicity — that the RPC's own two writes commit or roll
  // back together inside Postgres — is proven against a real database by the
  // `comm_create_inbox_item` assertion in database/src/assertions.ts; a mocked unit test has no
  // real transaction to inspect, only the route's own call shape.
  it('writes the item and clears the message atomically through one RPC call, never as two separate writes', async () => {
    const supabase = signedIn();

    await POST(makeItem(), context);

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.table('items').insert).not.toHaveBeenCalled();
    expect(supabase.table('comm_messages').update).not.toHaveBeenCalled();
  });

  it('returns the item and message with 201 when the RPC minted a fresh item', async () => {
    signedIn();

    const response = await POST(makeItem(), context);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      message: { ...MESSAGE, inbox_item_id: ITEM_ID },
      item: ITEM,
    });
  });

  it('returns the item and message with 200 when the RPC reused an already-linked item', async () => {
    signedIn({}, rpcResult({ created: false }));

    const response = await POST(makeItem(), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      message: { ...MESSAGE, inbox_item_id: ITEM_ID },
      item: ITEM,
    });
  });

  it('falls back to the handle when nobody named the sender', async () => {
    const supabase = signedIn({
      comm_messages: { maybeSingle: { data: { ...MESSAGE, sender_name: null } } },
    });

    await POST(makeItem(), context);

    const [, args] = supabase.rpc.mock.calls[0] as [string, { p_notes: string }];
    expect(args.p_notes).toContain('From dana@realplay.example via RealPlay');
  });

  it('carries no link when the row has nothing to open', async () => {
    const supabase = signedIn({
      comm_messages: { maybeSingle: { data: { ...MESSAGE, rfc822_message_id: null } } },
    });

    await POST(makeItem(), context);

    // Left off rather than sent as null: the generated arg type has no `| null`, so an omitted
    // key is how "no link" reaches the default-NULL parameter.
    const [, args] = supabase.rpc.mock.calls[0] as [string, { p_source_url?: string }];
    expect(args.p_source_url).toBeUndefined();
  });

  it('truncates a long body rather than pasting a whole thread into the notes', async () => {
    const supabase = signedIn({
      comm_messages: { maybeSingle: { data: { ...MESSAGE, body: 'z'.repeat(3000) } } },
    });

    await POST(makeItem(), context);

    const [, args] = supabase.rpc.mock.calls[0] as [string, { p_notes: string }];
    expect(args.p_notes).toHaveLength('From Dana Whitfield via RealPlay\n\n'.length + 2000);
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

  it('maps a failed RPC call to its status', async () => {
    signedIn({}, { data: null, error: { message: 'boom' } });

    const response = await POST(makeItem(), context);

    expect(response.status).toBe(500);
  });

  it('500s when the RPC returns a shape the route does not recognise', async () => {
    signedIn({}, { data: { unexpected: true }, error: undefined });

    const response = await POST(makeItem(), context);

    expect(response.status).toBe(500);
  });
});
