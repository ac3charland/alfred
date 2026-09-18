/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import {
  makeReaderPost,
  makeReaderPublication,
  resetReaderFixtureClock,
} from '@/lib/reader/fixtures';
import { createClient } from '@/lib/supabase/server';

import { READER_POST_LIST_COLUMNS, getReaderPosts, getReaderSeed, patchReaderPost } from './reader';

// `import 'server-only'` throws outside a Server Component context; neutralise it under Jest.
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const PUBLICATION = makeReaderPublication('Second Thoughts');
const POST_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  resetReaderFixtureClock();
  jest.clearAllMocks();
});

describe('READER_POST_LIST_COLUMNS', () => {
  it('names every reader_posts column except text — pinned against the fixture builder', () => {
    const post = makeReaderPost(PUBLICATION.id);
    const fixtureColumns = new Set(Object.keys(post).filter((key) => key !== 'text'));
    const listedColumns = new Set(READER_POST_LIST_COLUMNS.split(','));

    // Symmetric: a migration that adds a column to the Row type (and so to the fixture
    // builder) fails this the moment the fixture is regenerated, and a stray entry left in
    // the constant after a column is dropped fails it too.
    expect(listedColumns).toStrictEqual(fixtureColumns);
    expect(listedColumns.has('text')).toBe(false);
  });
});

describe('getReaderPosts', () => {
  it('selects the shared list columns', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { list: { data: [] } } });

    await getReaderPosts(supabase as never, { scope: 'active', limit: 200 });

    expect(supabase.table('reader_posts').select).toHaveBeenCalledWith(READER_POST_LIST_COLUMNS);
  });

  it('filters to not-archived on the active scope', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { list: { data: [] } } });

    await getReaderPosts(supabase as never, { scope: 'active', limit: 200 });

    expect(supabase.table('reader_posts').is).toHaveBeenCalledWith('archived_at', null);
    expect(supabase.table('reader_posts').not).not.toHaveBeenCalled();
  });

  it('filters to archived-only on the archived scope', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { list: { data: [] } } });

    await getReaderPosts(supabase as never, { scope: 'archived', limit: 200 });

    expect(supabase.table('reader_posts').not).toHaveBeenCalledWith('archived_at', 'is', null);
    expect(supabase.table('reader_posts').is).not.toHaveBeenCalled();
  });

  it('orders newest-received first', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { list: { data: [] } } });

    await getReaderPosts(supabase as never, { scope: 'active', limit: 200 });

    expect(supabase.table('reader_posts').order).toHaveBeenCalledWith('received_at', {
      ascending: false,
    });
  });

  it('applies the given limit', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { list: { data: [] } } });

    await getReaderPosts(supabase as never, { scope: 'active', limit: 37 });

    expect(supabase.table('reader_posts').limit).toHaveBeenCalledWith(37);
  });

  it('passes a Supabase error straight through', async () => {
    const supabase = makeSupabaseDouble({
      reader_posts: { list: { data: null, error: { message: 'boom' } } },
    });

    const { data, error } = await getReaderPosts(supabase as never, {
      scope: 'active',
      limit: 200,
    });

    expect(data).toBeNull();
    expect(error).toEqual({ message: 'boom' });
  });
});

describe('getReaderSeed', () => {
  it('reads the active scope at the list default limit (200)', async () => {
    const post = makeReaderPost(PUBLICATION.id);
    const supabase = makeSupabaseDouble({ reader_posts: { list: { data: [post] } } });

    const seed = await getReaderSeed(supabase as never);

    expect(seed).toEqual({ posts: [post] });
    expect(supabase.table('reader_posts').is).toHaveBeenCalledWith('archived_at', null);
    expect(supabase.table('reader_posts').limit).toHaveBeenCalledWith(200);
  });

  it('degrades to an empty list on a read error — the shell must render', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = makeSupabaseDouble({
      reader_posts: { list: { data: null, error: { message: 'boom' } } },
    });

    const seed = await getReaderSeed(supabase as never);

    expect(seed).toEqual({ posts: [] });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('creates its own client when none is passed', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { list: { data: [] } } });
    mockCreateClient.mockResolvedValue(supabase as never);

    await getReaderSeed();

    expect(mockCreateClient).toHaveBeenCalled();
  });
});

describe('patchReaderPost', () => {
  const NOW = new Date('2026-09-18T12:00:00.000Z');

  it('archives the row, stamping archived_at at `now`', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    await patchReaderPost(supabase as never, POST_ID, { archived: true }, NOW);

    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith({
      archived_at: '2026-09-18T12:00:00.000Z',
    });
  });

  it('unarchives the row, nulling archived_at', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    await patchReaderPost(supabase as never, POST_ID, { archived: false }, NOW);

    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith({ archived_at: null });
  });

  it('marks the row opened, stamping opened_at at `now`', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    await patchReaderPost(supabase as never, POST_ID, { opened: true }, NOW);

    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith({
      opened_at: '2026-09-18T12:00:00.000Z',
    });
  });

  it('scopes the write to the given id and reads the row back through the shared columns', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    await patchReaderPost(supabase as never, POST_ID, { archived: true }, NOW);

    expect(supabase.table('reader_posts').eq).toHaveBeenCalledWith('id', POST_ID);
    expect(supabase.table('reader_posts').select).toHaveBeenCalledWith(READER_POST_LIST_COLUMNS);
  });

  it('resolves null data for a row that is not there — the route handles the 404', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    const { data, error } = await patchReaderPost(
      supabase as never,
      POST_ID,
      { archived: true },
      NOW,
    );

    expect(data).toBeNull();
    expect(error).toBeUndefined();
  });

  it('passes a Supabase error straight through', async () => {
    const supabase = makeSupabaseDouble({
      reader_posts: { maybeSingle: { data: null, error: { message: 'boom' } } },
    });

    const { error } = await patchReaderPost(supabase as never, POST_ID, { archived: true }, NOW);

    expect(error).toEqual({ message: 'boom' });
  });
});
