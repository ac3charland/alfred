/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { createClient } from '@/lib/supabase/server';

import { POST } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const MESSAGE_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

function signedIn(rpc?: { data: unknown; error?: { message: string } }) {
  const supabase = makeSupabaseDouble({}, rpc ?? { data: 3 });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function purge(body: unknown): Request {
  return new Request('http://localhost/api/comms/purge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const STUB_CONTEXT = { params: Promise.resolve({}) };

describe('POST /api/comms/purge', () => {
  it('purges one message and reports how many rows went', async () => {
    const supabase = signedIn({ data: 1 });

    const response = await POST(purge({ message_id: MESSAGE_ID }), STUB_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ purged: 1 });
    expect(supabase.rpc).toHaveBeenCalledWith('comm_purge', { p_message: MESSAGE_ID });
  });

  it('purges one account', async () => {
    const supabase = signedIn();

    await POST(purge({ account_id: ACCOUNT_ID }), STUB_CONTEXT);

    expect(supabase.rpc).toHaveBeenCalledWith('comm_purge', { p_account: ACCOUNT_ID });
  });

  it('purges everything before a cutoff', async () => {
    const supabase = signedIn();

    await POST(purge({ before: '2026-01-01T00:00:00Z' }), STUB_CONTEXT);

    expect(supabase.rpc).toHaveBeenCalledWith('comm_purge', { p_before: '2026-01-01T00:00:00Z' });
  });

  it('sends every selector it was given, and only those', async () => {
    const supabase = signedIn();

    await POST(purge({ account_id: ACCOUNT_ID, before: '2026-01-01T00:00:00Z' }), STUB_CONTEXT);

    expect(supabase.rpc).toHaveBeenCalledWith('comm_purge', {
      p_account: ACCOUNT_ID,
      p_before: '2026-01-01T00:00:00Z',
    });
  });

  it('400s on a bodiless purge — a selector-less purge would empty the mirror', async () => {
    const supabase = signedIn();

    const response = await POST(purge({}), STUB_CONTEXT);

    expect(response.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('400s on a malformed selector', async () => {
    signedIn();

    const response = await POST(purge({ message_id: 'nope' }), STUB_CONTEXT);

    expect(response.status).toBe(400);
  });

  it('401s with no session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await POST(purge({ message_id: MESSAGE_ID }), STUB_CONTEXT);

    expect(response.status).toBe(401);
  });

  it('maps a failed purge to its status', async () => {
    signedIn({ data: null, error: { message: 'boom' } });

    const response = await POST(purge({ message_id: MESSAGE_ID }), STUB_CONTEXT);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'boom' });
  });
});
