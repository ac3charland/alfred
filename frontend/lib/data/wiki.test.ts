/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { createClient } from '@/lib/supabase/server';
import { makeWikiPage, makeWikiSync, toWikiIndexRow } from '@/lib/wiki/fixtures';

import {
  WIKI_PAGE_INDEX_COLUMNS,
  getWikiPageBody,
  getWikiPages,
  getWikiSeed,
  getWikiSnapshot,
  getWikiSyncState,
  searchWikiBodies,
} from './wiki';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const PAGE = makeWikiPage('wiki/concepts/habit-stacking.md');
const INDEX_ROW = toWikiIndexRow(PAGE);
const SYNC = makeWikiSync();

describe('WIKI_PAGE_INDEX_COLUMNS', () => {
  it('names every wiki_pages column except body and search — pinned against the fixture', () => {
    const fixtureColumns = new Set(
      Object.keys(PAGE).filter((key) => key !== 'body' && key !== 'search'),
    );
    const listedColumns = new Set(WIKI_PAGE_INDEX_COLUMNS.split(','));

    expect(listedColumns).toStrictEqual(fixtureColumns);
    expect(listedColumns.has('body')).toBe(false);
    expect(listedColumns.has('search')).toBe(false);
  });
});

describe('getWikiPages', () => {
  it('selects the index columns from wiki_pages', async () => {
    const supabase = makeSupabaseDouble({ wiki_pages: { list: { data: [INDEX_ROW] } } });

    const { data } = await getWikiPages(supabase as never);

    expect(data).toEqual([INDEX_ROW]);
    expect(supabase.table('wiki_pages').select).toHaveBeenCalledWith(WIKI_PAGE_INDEX_COLUMNS);
  });
});

describe('getWikiSyncState', () => {
  it('reads the singleton row with maybeSingle, so an unsynced wiki is null, not an error', async () => {
    const supabase = makeSupabaseDouble({ wiki_sync: { maybeSingle: { data: null } } });

    const { data, error } = await getWikiSyncState(supabase as never);

    expect(data).toBeNull();
    expect(error).toBeUndefined();
    expect(supabase.table('wiki_sync').eq).toHaveBeenCalledWith('id', 1);
  });
});

describe('getWikiSnapshot', () => {
  it('returns both reads, and short-circuits on the first error', async () => {
    const good = makeSupabaseDouble({
      wiki_pages: { list: { data: [INDEX_ROW] } },
      wiki_sync: { maybeSingle: { data: SYNC } },
    });
    await expect(getWikiSnapshot(good as never)).resolves.toEqual({
      data: { pages: [INDEX_ROW], sync: SYNC },
      error: null,
    });

    const broken = makeSupabaseDouble({
      wiki_pages: { list: { data: null, error: { message: 'boom' } } },
      wiki_sync: { maybeSingle: { data: SYNC } },
    });
    const result = await getWikiSnapshot(broken as never);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('boom');
    expect(broken.table('wiki_sync').select).not.toHaveBeenCalled();
  });
});

describe('getWikiSeed', () => {
  it('degrades a broken read to an empty, never-synced snapshot rather than throwing', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockCreateClient.mockResolvedValue(
      makeSupabaseDouble({
        wiki_pages: { list: { data: null, error: { message: 'boom' } } },
      }) as never,
    );

    await expect(getWikiSeed()).resolves.toEqual({ pages: [], sync: null });
    expect(consoleError).toHaveBeenCalled();
  });

  it('hands back the snapshot when both reads succeed', async () => {
    mockCreateClient.mockResolvedValue(
      makeSupabaseDouble({
        wiki_pages: { list: { data: [INDEX_ROW] } },
        wiki_sync: { maybeSingle: { data: SYNC } },
      }) as never,
    );

    await expect(getWikiSeed()).resolves.toEqual({ pages: [INDEX_ROW], sync: SYNC });
  });
});

describe('getWikiPageBody', () => {
  it('selects only the path, blob id and body of the one page', async () => {
    const supabase = makeSupabaseDouble({
      wiki_pages: {
        maybeSingle: { data: { path: PAGE.path, blob_oid: PAGE.blob_oid, body: PAGE.body } },
      },
    });

    const { data } = await getWikiPageBody(supabase as never, PAGE.path);

    expect(data).toEqual({ path: PAGE.path, blob_oid: PAGE.blob_oid, body: PAGE.body });
    expect(supabase.table('wiki_pages').select).toHaveBeenCalledWith('path,blob_oid,body');
    expect(supabase.table('wiki_pages').eq).toHaveBeenCalledWith('path', PAGE.path);
  });
});

describe('searchWikiBodies', () => {
  it('calls the search RPC with the query and limit', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [], error: null });

    await searchWikiBodies({ rpc } as never, 'forgetting', 20);

    expect(rpc).toHaveBeenCalledWith('search_wiki_pages', { p_query: 'forgetting', p_limit: 20 });
  });
});
