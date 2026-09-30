/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { SHELF_LIMIT_MAX, SHELF_PAGE_SIZE, WATCH_LIMIT_MAX } from '@/lib/comms/queue';
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
  watched: [],
};
const STUB_CONTEXT = { params: Promise.resolve({}) };

/** The snapshot URL asking for `value` to be watched — the raw comma-separated list. */
const watchUrl = (value: string) => `http://localhost/api/comms/snapshot?watch=${value}`;

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
    expect(mockReadCommsSnapshot).toHaveBeenCalledWith(supabase, SHELF_PAGE_SIZE, []);
  });

  it('reads as many shelf rows as the tab is showing', async () => {
    const supabase = signedIn();
    mockReadCommsSnapshot.mockResolvedValue({ seed: SEED, error: null });

    await GET(new Request('http://localhost/api/comms/snapshot?shelf=150'), STUB_CONTEXT);

    expect(mockReadCommsSnapshot).toHaveBeenCalledWith(supabase, 150, []);
  });

  it('reads a shelf of a few thousand rows, and 400s one past the most a tab ever asks for', async () => {
    const supabase = signedIn();
    mockReadCommsSnapshot.mockResolvedValue({ seed: SEED, error: null });

    const large = await GET(
      new Request('http://localhost/api/comms/snapshot?shelf=6000'),
      STUB_CONTEXT,
    );
    const tooLarge = await GET(
      new Request(`http://localhost/api/comms/snapshot?shelf=${String(SHELF_LIMIT_MAX + 1)}`),
      STUB_CONTEXT,
    );

    expect(large.status).toBe(200);
    expect(mockReadCommsSnapshot).toHaveBeenCalledWith(supabase, 6000, []);
    expect(tooLarge.status).toBe(400);
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

  describe('watch', () => {
    const ID_A = '11111111-1111-4111-8111-111111111111';
    const ID_B = '22222222-2222-4222-8222-222222222222';

    it('hands the named rows to the read, in the order asked', async () => {
      const supabase = signedIn();
      mockReadCommsSnapshot.mockResolvedValue({ seed: SEED, error: null });

      const response = await GET(new Request(watchUrl(`${ID_A},${ID_B}`)), STUB_CONTEXT);

      expect(response.status).toBe(200);
      expect(mockReadCommsSnapshot).toHaveBeenCalledWith(supabase, SHELF_PAGE_SIZE, [ID_A, ID_B]);
    });

    it('returns whatever the read found in `watched`', async () => {
      signedIn();
      const seed: CommsSeed = { ...SEED, watched: [{ id: ID_A } as never] };
      mockReadCommsSnapshot.mockResolvedValue({ seed, error: null });

      const response = await GET(new Request(watchUrl(ID_A)), STUB_CONTEXT);

      await expect(response.json()).resolves.toMatchObject({ watched: [{ id: ID_A }] });
    });

    it('asks for nothing to be watched when the parameter is absent or empty', async () => {
      const supabase = signedIn();
      mockReadCommsSnapshot.mockResolvedValue({ seed: SEED, error: null });

      await GET(new Request(watchUrl('')), STUB_CONTEXT);

      expect(mockReadCommsSnapshot).toHaveBeenCalledWith(supabase, SHELF_PAGE_SIZE, []);
    });

    it('400s a malformed id, and reads nothing', async () => {
      signedIn();

      const response = await GET(new Request(watchUrl(`${ID_A},not-an-id`)), STUB_CONTEXT);

      expect(response.status).toBe(400);
      expect(mockReadCommsSnapshot).not.toHaveBeenCalled();
    });

    it('400s a trailing comma: an empty id is a malformed one', async () => {
      signedIn();

      const response = await GET(new Request(watchUrl(`${ID_A},`)), STUB_CONTEXT);

      expect(response.status).toBe(400);
    });

    it('takes exactly the most it allows, and 400s one more', async () => {
      const supabase = signedIn();
      mockReadCommsSnapshot.mockResolvedValue({ seed: SEED, error: null });
      const ids = Array.from(
        { length: WATCH_LIMIT_MAX + 1 },
        (_unused, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      );

      const atTheLimit = await GET(
        new Request(watchUrl(ids.slice(0, WATCH_LIMIT_MAX).join(','))),
        STUB_CONTEXT,
      );
      const overTheLimit = await GET(new Request(watchUrl(ids.join(','))), STUB_CONTEXT);

      expect(WATCH_LIMIT_MAX).toBe(20);
      expect(atTheLimit.status).toBe(200);
      expect(mockReadCommsSnapshot).toHaveBeenCalledWith(
        supabase,
        SHELF_PAGE_SIZE,
        ids.slice(0, WATCH_LIMIT_MAX),
      );
      expect(overTheLimit.status).toBe(400);
    });
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
