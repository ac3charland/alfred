/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { makeCommAccount } from '@/lib/comms/fixtures';
import { makeReaderHealth } from '@/lib/reader/fixtures';
import { createClient } from '@/lib/supabase/server';

import { GET } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const HEALTH = makeReaderHealth('live');
const ACCOUNT = makeCommAccount('Personal', {
  id: '11111111-1111-4111-8111-111111111111',
  key: 'gmail-personal',
});

function signedIn(
  overrides: Parameters<typeof makeSupabaseDouble>[0] = {},
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({
    reader_health: { maybeSingle: { data: HEALTH } },
    comm_accounts: { maybeSingle: { data: ACCOUNT } },
    ...overrides,
  });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

const REQUEST = new Request('http://localhost/api/reader/health');
const STUB_CONTEXT = { params: Promise.resolve({}) };

describe('GET /api/reader/health', () => {
  it('hands back the tick’s row and the mailbox it reads, in one request', async () => {
    signedIn();

    const response = await GET(REQUEST, STUB_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ health: HEALTH, account: ACCOUNT });
  });

  it('reads the singleton row and the personal Gmail account by their keys', async () => {
    const supabase = signedIn();

    await GET(REQUEST, STUB_CONTEXT);

    expect(supabase.table('reader_health').eq).toHaveBeenCalledWith('id', 1);
    expect(supabase.table('comm_accounts').eq).toHaveBeenCalledWith('key', 'gmail-personal');
  });

  it('leaves the health field out entirely when the tick has never run', async () => {
    signedIn({ reader_health: { maybeSingle: { data: null } } });

    const response = await GET(REQUEST, STUB_CONTEXT);

    expect(response.status).toBe(200);
    // Absent, not null: the client reads a missing field as "no row", and a null would have to
    // be unpicked from a row that genuinely holds nulls.
    await expect(response.json()).resolves.toEqual({ account: ACCOUNT });
  });

  it('leaves the account out when the mailbox was never provisioned', async () => {
    signedIn({ comm_accounts: { maybeSingle: { data: null } } });

    const response = await GET(REQUEST, STUB_CONTEXT);

    await expect(response.json()).resolves.toEqual({ health: HEALTH });
  });

  it('fails the whole request when a read fails, never shipping half a snapshot', async () => {
    signedIn({ reader_health: { maybeSingle: { data: null, error: { message: 'boom' } } } });

    const response = await GET(REQUEST, STUB_CONTEXT);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'boom' });
  });

  it('401s with no session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await GET(REQUEST, STUB_CONTEXT);

    expect(response.status).toBe(401);
  });
});
