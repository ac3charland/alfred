/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { createClient } from '@/lib/supabase/server';

import { GET } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const ACCOUNT = { id: '11111111-1111-4111-8111-111111111111', last_seen_at: '2026-09-09T11:59Z' };
const HEALTH = { id: 1, last_success_at: '2026-09-09T11:59Z' };

function signedIn(
  overrides: Parameters<typeof makeSupabaseDouble>[0] = {},
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({
    comm_accounts: { list: { data: [ACCOUNT] } },
    comm_classifier_health: { maybeSingle: { data: HEALTH } },
    ...overrides,
  });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

const REQUEST = new Request('http://localhost/api/comms/health');
const STUB_CONTEXT = { params: Promise.resolve({}) };

describe('GET /api/comms/health', () => {
  it('hands back both halves of the health surface in one read', async () => {
    signedIn();

    const response = await GET(REQUEST, STUB_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accounts: [ACCOUNT], health: HEALTH });
  });

  it('reads the accounts in registration order, so the dots keep the seed’s order', async () => {
    const supabase = signedIn();

    await GET(REQUEST, STUB_CONTEXT);

    expect(supabase.table('comm_accounts').order).toHaveBeenCalledWith('created_at', {
      ascending: true,
    });
  });

  it('says the classifier row is absent rather than null — the sweep has never run', async () => {
    signedIn({ comm_classifier_health: { maybeSingle: { data: null } } });

    const response = await GET(REQUEST, STUB_CONTEXT);

    await expect(response.json()).resolves.toEqual({ accounts: [ACCOUNT] });
  });

  it('401s with no session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await GET(REQUEST, STUB_CONTEXT);

    expect(response.status).toBe(401);
  });

  it('fails outright when the roster read fails — an empty one would blank every dot', async () => {
    signedIn({ comm_accounts: { list: { data: null, error: { message: 'boom' } } } });

    const response = await GET(REQUEST, STUB_CONTEXT);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'boom' });
  });

  it('fails outright when the classifier read fails', async () => {
    signedIn({
      comm_classifier_health: { maybeSingle: { data: null, error: { message: 'nope' } } },
    });

    const response = await GET(REQUEST, STUB_CONTEXT);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'nope' });
  });
});
