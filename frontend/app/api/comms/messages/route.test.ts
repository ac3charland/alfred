/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { createClient } from '@/lib/supabase/server';

import { GET } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const ROW = { id: '11111111-1111-4111-8111-111111111111', tier: 'today' };

function signedIn(
  overrides: Parameters<typeof makeSupabaseDouble>[0] = {},
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({
    comm_messages: { list: { data: [ROW] } },
    ...overrides,
  });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function read(query: string): Request {
  return new Request(`http://localhost/api/comms/messages?${query}`);
}

const STUB_CONTEXT = { params: Promise.resolve({}) };

describe('GET /api/comms/messages', () => {
  it('reads the queue: inbound, uncleared, and in one of the three counted tiers', async () => {
    const supabase = signedIn();

    const response = await GET(read('scope=queue'), STUB_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([ROW]);
    const chain = supabase.table('comm_messages');
    expect(chain.eq).toHaveBeenCalledWith('direction', 'inbound');
    expect(chain.is).toHaveBeenCalledWith('cleared_at', null);
    expect(chain.in).toHaveBeenCalledWith('tier', ['asap', 'today', 'whenever']);
  });

  it('reads the shelf: the FYI tier plus every row that left the queue by an exit', async () => {
    const supabase = signedIn();

    const response = await GET(read('scope=shelf'), STUB_CONTEXT);

    expect(response.status).toBe(200);
    expect(supabase.table('comm_messages').or).toHaveBeenCalledWith(
      'tier.eq.fyi,cleared_at.not.is.null',
    );
  });

  it('orders newest first, whichever side is asked for', async () => {
    const supabase = signedIn();

    await GET(read('scope=shelf'), STUB_CONTEXT);

    expect(supabase.table('comm_messages').order).toHaveBeenCalledWith('received_at', {
      ascending: false,
    });
  });

  it('applies a limit when one is asked for — the shelf is browsed a page at a time', async () => {
    const supabase = signedIn();

    await GET(read('scope=shelf&limit=50'), STUB_CONTEXT);

    expect(supabase.table('comm_messages').limit).toHaveBeenCalledWith(50);
  });

  it('asks for no limit when none was given — the queue never needs one', async () => {
    const supabase = signedIn();

    await GET(read('scope=queue'), STUB_CONTEXT);

    expect(supabase.table('comm_messages').limit).not.toHaveBeenCalled();
  });

  it('400s when the scope is absent — neither side is the accidental default', async () => {
    signedIn();

    const response = await GET(read(''), STUB_CONTEXT);

    expect(response.status).toBe(400);
  });

  it('400s on a scope the module does not have', async () => {
    signedIn();

    const response = await GET(read('scope=everything'), STUB_CONTEXT);

    expect(response.status).toBe(400);
  });

  it('401s with no session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await GET(read('scope=queue'), STUB_CONTEXT);

    expect(response.status).toBe(401);
  });

  it('maps a failed read to its status', async () => {
    signedIn({ comm_messages: { list: { data: null, error: { message: 'boom' } } } });

    const response = await GET(read('scope=queue'), STUB_CONTEXT);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'boom' });
  });
});
