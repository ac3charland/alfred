/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import {
  makeReaderCandidate,
  makeReaderPublication,
  makeReaderPublicationListItem,
  resetReaderFixtureClock,
} from '@/lib/reader/fixtures';
import { createClient } from '@/lib/supabase/server';

import {
  createReaderPublication,
  getReaderCandidates,
  getReaderPublications,
  getReaderSettingsSeed,
  updateReaderPublication,
} from './reader-publications';

// `import 'server-only'` throws outside a Server Component context; neutralise it under Jest.
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

beforeEach(() => {
  resetReaderFixtureClock();
  jest.clearAllMocks();
});

describe('getReaderPublications', () => {
  it('reads the view that carries last_post_at, ordered by name', async () => {
    const supabase = makeSupabaseDouble({ v_reader_publications: { list: { data: [] } } });

    await getReaderPublications(supabase as never);

    expect(supabase.from).toHaveBeenCalledWith('v_reader_publications');
    expect(supabase.table('v_reader_publications').order).toHaveBeenCalledWith('name', {
      ascending: true,
    });
  });

  it('passes a Supabase error straight through', async () => {
    const supabase = makeSupabaseDouble({
      v_reader_publications: { list: { data: null, error: { message: 'boom' } } },
    });

    const { data, error } = await getReaderPublications(supabase as never);

    expect(data).toBeNull();
    expect(error).toEqual({ message: 'boom' });
  });
});

describe('getReaderCandidates', () => {
  it('ranks by volume then recency — restating the order PostgREST does not guarantee', async () => {
    const supabase = makeSupabaseDouble({ v_reader_candidates: { list: { data: [] } } });

    await getReaderCandidates(supabase as never);

    expect(supabase.from).toHaveBeenCalledWith('v_reader_candidates');
    expect(supabase.table('v_reader_candidates').order).toHaveBeenNthCalledWith(
      1,
      'message_count',
      { ascending: false },
    );
    expect(supabase.table('v_reader_candidates').order).toHaveBeenNthCalledWith(2, 'last_seen_at', {
      ascending: false,
    });
  });
});

describe('getReaderSettingsSeed', () => {
  it('returns both lists when both reads answer', async () => {
    const publications = [makeReaderPublicationListItem('Second Thoughts')];
    const candidates = [makeReaderCandidate('news@example.com')];
    const supabase = makeSupabaseDouble({
      v_reader_publications: { list: { data: publications } },
      v_reader_candidates: { list: { data: candidates } },
    });

    await expect(getReaderSettingsSeed(supabase as never)).resolves.toEqual({
      publications,
      candidates,
    });
  });

  it('still reads candidates when the roster read fails, degrading only that one slice', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const candidates = [makeReaderCandidate('news@example.com')];
    const supabase = makeSupabaseDouble({
      v_reader_publications: { list: { data: null, error: { message: 'boom' } } },
      v_reader_candidates: { list: { data: candidates } },
    });

    await expect(getReaderSettingsSeed(supabase as never)).resolves.toEqual({
      publications: [],
      candidates,
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('keeps the roster when only the candidates read fails', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const publications = [makeReaderPublicationListItem('Second Thoughts')];
    const supabase = makeSupabaseDouble({
      v_reader_publications: { list: { data: publications } },
      v_reader_candidates: { list: { data: null, error: { message: 'boom' } } },
    });

    await expect(getReaderSettingsSeed(supabase as never)).resolves.toEqual({
      publications,
      candidates: [],
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('creates its own client when none is passed', async () => {
    const supabase = makeSupabaseDouble({
      v_reader_publications: { list: { data: [] } },
      v_reader_candidates: { list: { data: [] } },
    });
    mockCreateClient.mockResolvedValue(supabase as never);

    await getReaderSettingsSeed();

    expect(mockCreateClient).toHaveBeenCalled();
  });
});

describe('createReaderPublication', () => {
  it('normalises the handle, defaults the name to its local part, and derives the domain', async () => {
    const saved = makeReaderPublication('news', { handle: 'news@example.com', source: 'owner' });
    const supabase = makeSupabaseDouble({ reader_publications: { single: { data: saved } } });

    await createReaderPublication(supabase as never, { handle: '  News@Example.com  ' });

    expect(supabase.table('reader_publications').insert).toHaveBeenCalledWith({
      handle: 'news@example.com',
      name: 'news',
      domain: 'example.com',
      source: 'owner',
      enabled: true,
    });
  });

  it('keeps a supplied name rather than deriving one', async () => {
    const saved = makeReaderPublication('Weekly News');
    const supabase = makeSupabaseDouble({ reader_publications: { single: { data: saved } } });

    await createReaderPublication(supabase as never, {
      handle: 'news@example.com',
      name: 'Weekly News',
    });

    expect(supabase.table('reader_publications').insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Weekly News' }),
    );
  });

  it('passes a unique-violation error straight through for the route to map', async () => {
    const supabase = makeSupabaseDouble({
      reader_publications: {
        single: {
          data: null,
          error: {
            message:
              'duplicate key value violates unique constraint "reader_publications_handle_key"',
            code: '23505',
          },
        },
      },
    });

    const { data, error } = await createReaderPublication(supabase as never, {
      handle: 'news@example.com',
    });

    expect(data).toBeNull();
    expect(error?.code).toBe('23505');
  });
});

describe('updateReaderPublication', () => {
  const PUBLICATION_ID = '11111111-1111-4111-8111-111111111111';

  it('sends only the fields the caller actually named', async () => {
    const saved = makeReaderPublication('Second Thoughts', { id: PUBLICATION_ID, enabled: false });
    const supabase = makeSupabaseDouble({
      reader_publications: { maybeSingle: { data: saved } },
    });

    await updateReaderPublication(supabase as never, PUBLICATION_ID, { enabled: false });

    expect(supabase.table('reader_publications').update).toHaveBeenCalledWith({ enabled: false });
    expect(supabase.table('reader_publications').eq).toHaveBeenCalledWith('id', PUBLICATION_ID);
  });

  it('preserves an explicit null when the caller clears the note', async () => {
    const saved = makeReaderPublication('Second Thoughts', { id: PUBLICATION_ID, notes: null });
    const supabase = makeSupabaseDouble({
      reader_publications: { maybeSingle: { data: saved } },
    });

    await updateReaderPublication(supabase as never, PUBLICATION_ID, { notes: null });

    expect(supabase.table('reader_publications').update).toHaveBeenCalledWith({ notes: null });
  });

  it('answers null data for an id that matches nothing, for the route to turn into a 404', async () => {
    const supabase = makeSupabaseDouble({
      reader_publications: { maybeSingle: { data: null } },
    });

    const { data, error } = await updateReaderPublication(supabase as never, PUBLICATION_ID, {
      enabled: false,
    });

    expect(data).toBeNull();
    expect(error).toBeUndefined();
  });
});
