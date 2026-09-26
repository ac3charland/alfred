/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { createClient } from '@/lib/supabase/server';

import { GET } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const BODY = {
  path: 'wiki/concepts/habit-stacking.md',
  blob_oid: 'b10b1',
  body: '# Habit stacking\n',
};

function signedIn(
  overrides: Parameters<typeof makeSupabaseDouble>[0] = {},
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({
    wiki_pages: { maybeSingle: { data: BODY } },
    ...overrides,
  });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function read(path: string): Request {
  return new Request(`http://localhost/api/wiki/page?path=${encodeURIComponent(path)}`);
}

const STUB_CONTEXT = { params: Promise.resolve({}) };

describe('GET /api/wiki/page', () => {
  it('returns the body pinned to its blob id, selecting only those three columns', async () => {
    const supabase = signedIn();

    const response = await GET(read('wiki/concepts/habit-stacking.md'), STUB_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(BODY);
    expect(supabase.table('wiki_pages').select).toHaveBeenCalledWith('path,blob_oid,body');
    expect(supabase.table('wiki_pages').eq).toHaveBeenCalledWith(
      'path',
      'wiki/concepts/habit-stacking.md',
    );
  });

  it.each([
    'wiki/concepts/habit-stacking',
    'wiki/raw/habit-stacking.md',
    'raw/2026/2026-10-01-atomic-habits/source.md',
    'wiki/concepts/../entities/x.md',
    'wiki/concepts/a/b.md',
    '',
  ])('refuses %j with 400 before any read', async (path) => {
    const supabase = signedIn();

    const response = await GET(read(path), STUB_CONTEXT);

    expect(response.status).toBe(400);
    expect(supabase.table('wiki_pages').select).not.toHaveBeenCalled();
  });

  it('refuses a missing path with 400', async () => {
    signedIn();

    const response = await GET(new Request('http://localhost/api/wiki/page'), STUB_CONTEXT);

    expect(response.status).toBe(400);
  });

  it('answers 404 for a page not in the snapshot', async () => {
    signedIn({ wiki_pages: { maybeSingle: { data: null } } });

    const response = await GET(read('wiki/concepts/not-yet.md'), STUB_CONTEXT);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Page not found' });
  });

  it('maps a Supabase error to its status', async () => {
    signedIn({ wiki_pages: { maybeSingle: { data: null, error: { message: 'boom' } } } });

    const response = await GET(read('wiki/concepts/habit-stacking.md'), STUB_CONTEXT);

    expect(response.status).toBe(500);
  });

  it('rejects an unauthenticated request with 401', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await GET(read('wiki/concepts/habit-stacking.md'), STUB_CONTEXT);

    expect(response.status).toBe(401);
  });
});
