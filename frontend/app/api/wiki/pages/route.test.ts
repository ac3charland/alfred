/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { WIKI_PAGE_INDEX_COLUMNS } from '@/lib/data/wiki';
import { createClient } from '@/lib/supabase/server';
import { makeWikiPage, makeWikiSync, toWikiIndexRow } from '@/lib/wiki/fixtures';

import { GET } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const PAGE = toWikiIndexRow(makeWikiPage('wiki/concepts/habit-stacking.md'));
const SYNC = makeWikiSync();

function signedIn(
  overrides: Parameters<typeof makeSupabaseDouble>[0] = {},
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({
    wiki_pages: { list: { data: [PAGE] } },
    wiki_sync: { maybeSingle: { data: SYNC } },
    ...overrides,
  });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

const REQUEST = new Request('http://localhost/api/wiki/pages');
const STUB_CONTEXT = { params: Promise.resolve({}) };

describe('GET /api/wiki/pages', () => {
  it('returns the index and the sync row together', async () => {
    signedIn();

    const response = await GET(REQUEST, STUB_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ pages: [PAGE], sync: SYNC });
  });

  it('reads the index column set — never a page body', async () => {
    const supabase = signedIn();

    await GET(REQUEST, STUB_CONTEXT);

    expect(supabase.table('wiki_pages').select).toHaveBeenCalledWith(WIKI_PAGE_INDEX_COLUMNS);
    expect(WIKI_PAGE_INDEX_COLUMNS.split(',')).not.toContain('body');
  });

  it('reports a null sync before the first sync ever ran', async () => {
    signedIn({ wiki_sync: { maybeSingle: { data: null } } });

    const response = await GET(REQUEST, STUB_CONTEXT);

    await expect(response.json()).resolves.toEqual({ pages: [PAGE], sync: null });
  });

  it('maps a Supabase error on either read to its status', async () => {
    signedIn({ wiki_pages: { list: { data: null, error: { message: 'boom' } } } });

    const response = await GET(REQUEST, STUB_CONTEXT);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'boom' });
  });

  it('rejects an unauthenticated request with 401', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await GET(REQUEST, STUB_CONTEXT);

    expect(response.status).toBe(401);
  });
});
