/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { SHELF_PAGE_SIZE } from '@/lib/comms/queue';
import { readCommsSnapshot } from '@/lib/data/comms';
import { createClient } from '@/lib/supabase/server';
import type { CommsSeed } from '@/lib/types';

import { GET } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
// The reads themselves are pinned in `lib/data/comms.test.ts`; this pins the route around them.
jest.mock('@/lib/data/comms', () => ({ readCommsSnapshot: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);
const mockReadCommsSnapshot = jest.mocked(readCommsSnapshot);

const SEED: CommsSeed = {
  accounts: [],
  messages: [],
  verdicts: [],
  health: undefined,
  shelfCount: 3,
  readerClaimedCount: 1,
  lastClassifiedAt: null,
  readAt: '2026-09-09T12:00:00.000Z',
};
const STUB_CONTEXT = { params: Promise.resolve({}) };

function signedIn() {
  const supabase = makeSupabaseDouble({});
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/comms/snapshot', () => {
  it('hands back the whole view, the first shelf page by default', async () => {
    const supabase = signedIn();
    mockReadCommsSnapshot.mockResolvedValue({ seed: SEED, error: null });

    const response = await GET(new Request('http://localhost/api/comms/snapshot'), STUB_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(SEED);
    expect(mockReadCommsSnapshot).toHaveBeenCalledWith(supabase, SHELF_PAGE_SIZE);
  });

  it('reads as many shelf rows as the tab is showing', async () => {
    const supabase = signedIn();
    mockReadCommsSnapshot.mockResolvedValue({ seed: SEED, error: null });

    await GET(new Request('http://localhost/api/comms/snapshot?shelf=150'), STUB_CONTEXT);

    expect(mockReadCommsSnapshot).toHaveBeenCalledWith(supabase, 150);
  });

  it('400s a shelf size that is not a positive whole number', async () => {
    signedIn();

    const response = await GET(
      new Request('http://localhost/api/comms/snapshot?shelf=-3'),
      STUB_CONTEXT,
    );

    expect(response.status).toBe(400);
    expect(mockReadCommsSnapshot).not.toHaveBeenCalled();
  });

  it('fails outright on a partial read — the caller replaces its whole view with this', async () => {
    signedIn();
    mockReadCommsSnapshot.mockResolvedValue({
      seed: SEED,
      error: { message: 'boom', details: '', hint: '', code: 'XX000' } as never,
    });

    const response = await GET(new Request('http://localhost/api/comms/snapshot'), STUB_CONTEXT);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'boom' });
  });

  it('401s with no session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await GET(new Request('http://localhost/api/comms/snapshot'), STUB_CONTEXT);

    expect(response.status).toBe(401);
    expect(mockReadCommsSnapshot).not.toHaveBeenCalled();
  });
});
