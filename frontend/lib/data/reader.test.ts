/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeChain, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { makeCommAccount } from '@/lib/comms/fixtures';
import {
  makeReaderHealth,
  makeReaderPost,
  makeReaderPublication,
  resetReaderFixtureClock,
} from '@/lib/reader/fixtures';
import { createClient } from '@/lib/supabase/server';

import {
  READER_POST_LIST_COLUMNS,
  appendWikiSentPicks,
  deliverResearchReport,
  getReaderHealthSeed,
  getReaderHealthSnapshot,
  getReaderPostForResearch,
  getReaderPostForSend,
  getReaderPostForWiki,
  getReaderPostListItem,
  getReaderPostResummarizeState,
  getReaderPosts,
  getReaderSeed,
  getResearchPostForDelivery,
  markReaderPostSent,
  patchReaderPost,
  recordResearchFire,
} from './reader';

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
  it('names every reader_posts column except the two bodies and the research brief — pinned against the fixture builder', () => {
    const post = makeReaderPost(PUBLICATION.id);
    const fixtureColumns = new Set(
      Object.keys(post).filter(
        (key) => key !== 'text' && key !== 'html' && key !== 'research_brief',
      ),
    );
    const listedColumns = new Set(READER_POST_LIST_COLUMNS.split(','));

    // Symmetric: a migration that adds a column to the Row type (and so to the fixture
    // builder) fails this the moment the fixture is regenerated, and a stray entry left in
    // the constant after a column is dropped fails it too.
    expect(listedColumns).toStrictEqual(fixtureColumns);
    expect(listedColumns.has('text')).toBe(false);
    // The row's eyebrow and its "via Instapaper" read these two, so the list must carry them.
    expect(listedColumns.has('source')).toBe(true);
    expect(listedColumns.has('site')).toBe(true);
    expect(listedColumns.has('html')).toBe(false);
    // The row's "in Instapaper" badge is drawn from these, so the list has to carry them.
    expect(listedColumns.has('instapaper_sent_at')).toBe(true);
    expect(listedColumns.has('instapaper_bookmark_id')).toBe(true);
    // A research row's phase, its Session link and its "No report" reason are drawn from these;
    // the brief is what the Routine is fired with, read server-side only.
    for (const column of [
      'research_state',
      'research_fired_at',
      'research_session_url',
      'research_error',
      'research_delivered_at',
    ]) {
      expect(listedColumns.has(column)).toBe(true);
    }
    expect(listedColumns.has('research_brief')).toBe(false);
    // The overview's sent marks are drawn from these, one per checklist section.
    expect(listedColumns.has('wiki_sent_ideas')).toBe(true);
    expect(listedColumns.has('wiki_sent_evidence')).toBe(true);
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

  it('breaks a tie on the arrival instant by the newest insert, so a refetch never reshuffles', async () => {
    // Every article one tick takes in shares the tick's instant as its `received_at`.
    const supabase = makeSupabaseDouble({ reader_posts: { list: { data: [] } } });

    await getReaderPosts(supabase as never, { scope: 'active', limit: 200 });

    expect(supabase.table('reader_posts').order.mock.calls).toEqual([
      ['received_at', { ascending: false }],
      ['created_at', { ascending: false }],
    ]);
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

  it('re-summarising resets the state, the attempts, the error and the lease — and nothing else', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    await patchReaderPost(supabase as never, POST_ID, { resummarize: true }, NOW);

    // The headline, gist, overview, model, prompt version and summarised-at are deliberately
    // absent: the row keeps the summary it has until the tick overwrites it.
    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith({
      summary_state: 'pending',
      summarize_attempts: 0,
      last_error: null,
      summarizing_since: null,
    });
  });

  it('scopes the write to the given id and reads the row back through the shared columns', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    await patchReaderPost(supabase as never, POST_ID, { archived: true }, NOW);

    expect(supabase.table('reader_posts').eq).toHaveBeenCalledWith('id', POST_ID);
    expect(supabase.table('reader_posts').select).toHaveBeenCalledWith(READER_POST_LIST_COLUMNS);
  });

  it('re-summarising refuses a row the tick has queued, in the WHERE clause', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    await patchReaderPost(supabase as never, POST_ID, { resummarize: true }, NOW);

    // The route's pre-read can only see the state a moment ago; the filter is what makes the
    // same rule hold at the instant of the write.
    expect(supabase.table('reader_posts').neq).toHaveBeenCalledWith('summary_state', 'pending');
  });

  it.each([
    ['archiving', { archived: true }],
    ['opening', { opened: true }],
  ] as const)(
    '%s carries no state guard — those verbs apply whatever the tick is doing',
    async (_name, patch) => {
      const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

      await patchReaderPost(supabase as never, POST_ID, patch, NOW);

      expect(supabase.table('reader_posts').neq).not.toHaveBeenCalled();
    },
  );

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

describe('getReaderHealthSnapshot', () => {
  it('reads the singleton row and the personal Gmail account', async () => {
    const health = makeReaderHealth('live');
    const account = makeCommAccount('Personal', { key: 'gmail-personal' });
    const supabase = makeSupabaseDouble({
      reader_health: { maybeSingle: { data: health } },
      comm_accounts: { maybeSingle: { data: account } },
    });

    const { data, error } = await getReaderHealthSnapshot(supabase as never);

    expect(data).toEqual({ health, account });
    expect(error).toBeNull();
    expect(supabase.table('reader_health').eq).toHaveBeenCalledWith('id', 1);
    expect(supabase.table('comm_accounts').eq).toHaveBeenCalledWith('key', 'gmail-personal');
  });

  it('reports each half as undefined when it is simply not there', async () => {
    const supabase = makeSupabaseDouble({
      reader_health: { maybeSingle: { data: null } },
      comm_accounts: { maybeSingle: { data: null } },
    });

    const { data } = await getReaderHealthSnapshot(supabase as never);

    expect(data).toEqual({ health: undefined, account: undefined });
  });

  it('short-circuits on the first error rather than returning half a snapshot', async () => {
    const supabase = makeSupabaseDouble({
      reader_health: { maybeSingle: { data: null, error: { message: 'boom' } } },
      comm_accounts: {
        maybeSingle: { data: makeCommAccount('Personal', { key: 'gmail-personal' }) },
      },
    });

    const { data, error } = await getReaderHealthSnapshot(supabase as never);

    expect(data).toBeNull();
    expect(error).toEqual({ message: 'boom' });
    expect(supabase.table('comm_accounts').select).not.toHaveBeenCalled();
  });

  it('reports the account read’s error too', async () => {
    const supabase = makeSupabaseDouble({
      reader_health: { maybeSingle: { data: makeReaderHealth('live') } },
      comm_accounts: { maybeSingle: { data: null, error: { message: 'accounts are down' } } },
    });

    const { data, error } = await getReaderHealthSnapshot(supabase as never);

    expect(data).toBeNull();
    expect(error).toEqual({ message: 'accounts are down' });
  });
});

describe('getReaderHealthSeed', () => {
  it('hands the snapshot through when the reads answer', async () => {
    const health = makeReaderHealth('ceiling');
    const account = makeCommAccount('Personal', { key: 'gmail-personal' });
    const supabase = makeSupabaseDouble({
      reader_health: { maybeSingle: { data: health } },
      comm_accounts: { maybeSingle: { data: account } },
    });

    await expect(getReaderHealthSeed(supabase as never)).resolves.toEqual({ health, account });
  });

  it('degrades to an empty snapshot on a read error, never to a healthy-looking one', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = makeSupabaseDouble({
      reader_health: { maybeSingle: { data: null, error: { message: 'boom' } } },
    });

    await expect(getReaderHealthSeed(supabase as never)).resolves.toEqual({
      health: undefined,
      account: undefined,
    });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('creates its own client when none is passed', async () => {
    const supabase = makeSupabaseDouble({
      reader_health: { maybeSingle: { data: null } },
      comm_accounts: { maybeSingle: { data: null } },
    });
    mockCreateClient.mockResolvedValue(supabase as never);

    await getReaderHealthSeed();

    expect(mockCreateClient).toHaveBeenCalled();
  });
});

describe('getReaderPostResummarizeState', () => {
  const STORED = { text_swept_at: null, word_count: 3220, summary_state: 'done' };

  it('reads the sweep stamp, the word count and the state, for the row asked for', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: STORED } } });

    const { data } = await getReaderPostResummarizeState(supabase as never, POST_ID);

    expect(data).toEqual(STORED);
    expect(supabase.table('reader_posts').eq).toHaveBeenCalledWith('id', POST_ID);
  });

  it('never asks for the body — the count is the presence signal', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: STORED } } });

    await getReaderPostResummarizeState(supabase as never, POST_ID);

    // Compared as COLUMNS rather than as a substring: `text_swept_at` is a column this read does
    // want, and a substring match on "text" would read it as the body coming back.
    const [columns] = supabase.table('reader_posts').select.mock.calls[0] as [string];
    expect(columns.split(',')).not.toContain('text');
    expect(columns.split(',')).toStrictEqual(['text_swept_at', 'word_count', 'summary_state']);
  });

  it('resolves null data for a row that is not there — the route handles the 404', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    const { data } = await getReaderPostResummarizeState(supabase as never, POST_ID);

    expect(data).toBeNull();
  });

  it('passes a Supabase error straight through', async () => {
    const supabase = makeSupabaseDouble({
      reader_posts: { maybeSingle: { data: null, error: { message: 'boom' } } },
    });

    const { error } = await getReaderPostResummarizeState(supabase as never, POST_ID);

    expect(error).toEqual({ message: 'boom' });
  });
});

describe('getReaderPostForWiki', () => {
  it('reads exactly what a send needs, the body included, for the row asked for', async () => {
    const stored = makeReaderPost(PUBLICATION.id, { id: POST_ID, text: 'The body.' });
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: stored } } });

    const { data } = await getReaderPostForWiki(supabase as never, POST_ID);

    expect(data).toEqual(stored);
    expect(supabase.table('reader_posts').eq).toHaveBeenCalledWith('id', POST_ID);
    const [columns] = supabase.table('reader_posts').select.mock.calls[0] as [string];
    expect(columns.split(',')).toStrictEqual([
      'id',
      'title',
      'author',
      'canonical_url',
      'source',
      'received_at',
      'text',
      'overview',
      'wiki_sent_ideas',
      'wiki_sent_evidence',
    ]);
  });

  it('resolves null data for a row that is not there — the route handles the 404', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    const { data } = await getReaderPostForWiki(supabase as never, POST_ID);

    expect(data).toBeNull();
  });

  it('passes a Supabase error straight through', async () => {
    const supabase = makeSupabaseDouble({
      reader_posts: { maybeSingle: { data: null, error: { message: 'boom' } } },
    });

    const { error } = await getReaderPostForWiki(supabase as never, POST_ID);

    expect(error).toEqual({ message: 'boom' });
  });
});

describe('getReaderPostListItem', () => {
  it('reads one row through the shared list columns — never the body', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    await getReaderPostListItem(supabase as never, POST_ID);

    expect(supabase.table('reader_posts').select).toHaveBeenCalledWith(READER_POST_LIST_COLUMNS);
    expect(supabase.table('reader_posts').eq).toHaveBeenCalledWith('id', POST_ID);
    expect(supabase.table('reader_posts').maybeSingle).toHaveBeenCalled();
  });
});

describe('appendWikiSentPicks', () => {
  it('appends both lists through the one atomic RPC and reads the row back through the list columns', async () => {
    const { text: _text, ...saved } = makeReaderPost(PUBLICATION.id, {
      id: POST_ID,
      wiki_sent_ideas: ['Idea one'],
      wiki_sent_evidence: ['Evidence one'],
    });
    const supabase = makeSupabaseDouble({});
    const chain = makeChain({ single: { data: saved } });
    supabase.rpc.mockReturnValue(chain);

    const { data } = await appendWikiSentPicks(supabase as never, POST_ID, {
      ideas: ['Idea one'],
      evidence: ['Evidence one'],
    });

    expect(supabase.rpc).toHaveBeenCalledWith('append_wiki_sent_picks', {
      p_post: POST_ID,
      p_ideas: ['Idea one'],
      p_evidence: ['Evidence one'],
    });
    expect(chain.select).toHaveBeenCalledWith(READER_POST_LIST_COLUMNS);
    expect(chain.single).toHaveBeenCalled();
    expect(data).toEqual(saved);
  });

  it('passes a Supabase error straight through', async () => {
    const supabase = makeSupabaseDouble({});
    supabase.rpc.mockReturnValue(makeChain({ single: { data: null, error: { message: 'boom' } } }));

    const { error } = await appendWikiSentPicks(supabase as never, POST_ID, {
      ideas: ['Idea one'],
      evidence: [],
    });

    expect(error).toEqual({ message: 'boom' });
  });
});

describe('getReaderPostForSend', () => {
  it('reads exactly what a send needs — the bodies included — for the row asked for', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    await getReaderPostForSend(supabase as never, POST_ID);

    const [columns] = supabase.table('reader_posts').select.mock.calls[0] as [string];
    expect(columns.split(',')).toStrictEqual([
      'title',
      'canonical_url',
      'gist',
      'html',
      'text',
      'archived_at',
      // An Instapaper article's Send moves its own bookmark back to Unread rather than saving a
      // second one, so the route has to know which kind of post it holds, and which bookmark.
      'source',
      'instapaper_bookmark_id',
    ]);
    expect(supabase.table('reader_posts').eq).toHaveBeenCalledWith('id', POST_ID);
  });

  it('resolves null data for a row that is not there — the route handles the 404', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    const { data } = await getReaderPostForSend(supabase as never, POST_ID);

    expect(data).toBeNull();
  });
});

describe('markReaderPostSent', () => {
  const NOW = new Date('2026-09-24T12:00:00.000Z');

  it('stamps the send and the bookmark id, and archives the post at the same instant', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    await markReaderPostSent(supabase as never, POST_ID, 1_234_567, NOW, null);

    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith({
      instapaper_sent_at: '2026-09-24T12:00:00.000Z',
      instapaper_bookmark_id: 1_234_567,
      archived_at: '2026-09-24T12:00:00.000Z',
    });
  });

  it('keeps an existing archived_at — a send from the archive does not re-date the archiving', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    await markReaderPostSent(supabase as never, POST_ID, 7, NOW, '2026-09-17T09:00:00.000Z');

    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith(
      expect.objectContaining({ archived_at: '2026-09-17T09:00:00.000Z' }),
    );
  });

  it('scopes the write to the given id and reads the row back through the shared columns', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    await markReaderPostSent(supabase as never, POST_ID, 7, NOW, null);

    expect(supabase.table('reader_posts').eq).toHaveBeenCalledWith('id', POST_ID);
    expect(supabase.table('reader_posts').select).toHaveBeenCalledWith(READER_POST_LIST_COLUMNS);
  });
});

describe('getReaderPostForResearch', () => {
  it('reads what a retry needs — the phase inputs, the brief and the attempts — never a body', async () => {
    const stored = {
      source: 'research',
      research_state: 'failed',
      created_at: '2026-09-29T09:00:00.000Z',
      research_fired_at: null,
      research_brief: 'Is a heat pump worth it?',
      research_attempts: 1,
    };
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: stored } } });

    const { data } = await getReaderPostForResearch(supabase as never, POST_ID);

    expect(data).toEqual(stored);
    expect(supabase.table('reader_posts').eq).toHaveBeenCalledWith('id', POST_ID);
    const [columns] = supabase.table('reader_posts').select.mock.calls[0] as [string];
    expect(columns.split(',')).toStrictEqual([
      'source',
      'research_state',
      'created_at',
      'research_fired_at',
      'research_brief',
      'research_attempts',
    ]);
  });

  it('resolves null data for a row that is not there, and passes an error through', async () => {
    const missing = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });
    await expect(getReaderPostForResearch(missing as never, POST_ID)).resolves.toMatchObject({
      data: null,
    });

    const broken = makeSupabaseDouble({
      reader_posts: { maybeSingle: { data: null, error: { message: 'boom' } } },
    });
    const { error } = await getReaderPostForResearch(broken as never, POST_ID);
    expect(error).toEqual({ message: 'boom' });
  });
});

describe('recordResearchFire', () => {
  const NOW = new Date('2026-09-29T12:00:00.000Z');

  it('records an accepted fire: researching, when, the session link, no error, one more attempt', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    await recordResearchFire(
      supabase as never,
      POST_ID,
      { ok: true, sessionUrl: 'https://claude.ai/code/session_01Abc' },
      2,
      NOW,
    );

    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith({
      research_state: 'researching',
      research_fired_at: '2026-09-29T12:00:00.000Z',
      research_session_url: 'https://claude.ai/code/session_01Abc',
      research_error: null,
      research_attempts: 3,
    });
  });

  it('records an accepted fire that carried no session link as a null link', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    await recordResearchFire(supabase as never, POST_ID, { ok: true, sessionUrl: null }, 0, NOW);

    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith(
      expect.objectContaining({ research_session_url: null, research_attempts: 1 }),
    );
  });

  it('records a failed fire: failed, why, one more attempt — and touches nothing else', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    await recordResearchFire(
      supabase as never,
      POST_ID,
      { ok: false, error: "the Routine's daily run cap or usage limit was reached" },
      0,
      NOW,
    );

    // No fired-at and no session link: an earlier session's link still opens, and a stale
    // researching post keeps the time its last accepted fire was made.
    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith({
      research_state: 'failed',
      research_error: "the Routine's daily run cap or usage limit was reached",
      research_attempts: 1,
    });
  });

  it('scopes the write to the id and reads the row back through the shared columns', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    await recordResearchFire(supabase as never, POST_ID, { ok: true, sessionUrl: null }, 0, NOW);

    expect(supabase.table('reader_posts').eq).toHaveBeenCalledWith('id', POST_ID);
    // A report an earlier session delivered while this fire was in flight must stay delivered:
    // the guard makes the write match nothing rather than flip it back to researching.
    expect(supabase.table('reader_posts').neq).toHaveBeenCalledWith('research_state', 'done');
    expect(supabase.table('reader_posts').select).toHaveBeenCalledWith(READER_POST_LIST_COLUMNS);
  });

  it('resolves the row it wrote, and passes an error straight through', async () => {
    const row = { id: POST_ID };
    const ok = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: row } } });
    await expect(
      recordResearchFire(ok as never, POST_ID, { ok: true, sessionUrl: null }, 0, NOW),
    ).resolves.toMatchObject({ data: row });

    const broken = makeSupabaseDouble({
      reader_posts: { maybeSingle: { data: null, error: { message: 'boom' } } },
    });
    const { error } = await recordResearchFire(
      broken as never,
      POST_ID,
      { ok: true, sessionUrl: null },
      0,
      NOW,
    );
    expect(error).toEqual({ message: 'boom' });
  });
});

describe('getResearchPostForDelivery', () => {
  it('reads only the kind of post and its research state, for the id asked for', async () => {
    const stored = { source: 'research', research_state: 'researching' };
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: stored } } });

    const { data } = await getResearchPostForDelivery(supabase as never, POST_ID);

    expect(data).toEqual(stored);
    expect(supabase.table('reader_posts').select).toHaveBeenCalledWith('source,research_state');
    expect(supabase.table('reader_posts').eq).toHaveBeenCalledWith('id', POST_ID);
  });

  it('resolves null data for a row that is not there, and passes an error through', async () => {
    const supabase = makeSupabaseDouble({
      reader_posts: { maybeSingle: { data: null, error: { message: 'boom' } } },
    });

    const { data, error } = await getResearchPostForDelivery(supabase as never, POST_ID);

    expect(data).toBeNull();
    expect(error).toEqual({ message: 'boom' });
  });
});

describe('deliverResearchReport', () => {
  const NOW = new Date('2026-09-29T12:00:00.000Z');
  const REPORT = '# Is a heat pump worth it?\n\nProbably yes, if the furnace is old.';
  const HTML = '<h1>Is a heat pump worth it?</h1>\n<p>Probably yes, if the furnace is old.</p>';

  it('writes the report, its HTML and word count, the delivered state and a fresh summary state in one update', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    await deliverResearchReport(supabase as never, POST_ID, REPORT, HTML, NOW);

    expect(supabase.table('reader_posts').update).toHaveBeenCalledTimes(1);
    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith({
      text: REPORT,
      html: HTML,
      word_count: 14,
      html_extracted: false,
      research_state: 'done',
      research_delivered_at: '2026-09-29T12:00:00.000Z',
      received_at: '2026-09-29T12:00:00.000Z',
      research_error: null,
      summary_state: 'pending',
      summarize_attempts: 0,
      last_error: null,
      summarizing_since: null,
      headline: null,
      gist: null,
      overview: null,
      model: null,
      prompt_version: null,
      summarized_at: null,
    });
  });

  it.each([
    ['one two', 2],
    ['  one\ttwo\n\nthree   four  ', 4],
    ['# heading', 2],
    ['word', 1],
  ])('counts the words of %j by whitespace: %i', async (report, words) => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    await deliverResearchReport(supabase as never, POST_ID, report, HTML, NOW);

    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith(
      expect.objectContaining({ word_count: words }),
    );
  });

  it('guards the write in the WHERE clause: this post, a research post, not already delivered', async () => {
    const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });

    await deliverResearchReport(supabase as never, POST_ID, REPORT, HTML, NOW);

    // A read can only say what the row was a moment ago; the filter is what makes two racing
    // deliveries settle on one.
    expect(supabase.table('reader_posts').eq).toHaveBeenCalledWith('id', POST_ID);
    expect(supabase.table('reader_posts').eq).toHaveBeenCalledWith('source', 'research');
    expect(supabase.table('reader_posts').neq).toHaveBeenCalledWith('research_state', 'done');
  });

  it('answers only the id it wrote — the body is never read back', async () => {
    const supabase = makeSupabaseDouble({
      reader_posts: { maybeSingle: { data: { id: POST_ID } } },
    });

    const { data } = await deliverResearchReport(supabase as never, POST_ID, REPORT, HTML, NOW);

    expect(data).toEqual({ id: POST_ID });
    expect(supabase.table('reader_posts').select).toHaveBeenCalledWith('id');
  });

  it('resolves null data when the guard matched no row, and passes an error through', async () => {
    const raced = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: null } } });
    await expect(
      deliverResearchReport(raced as never, POST_ID, REPORT, HTML, NOW),
    ).resolves.toMatchObject({ data: null });

    const broken = makeSupabaseDouble({
      reader_posts: { maybeSingle: { data: null, error: { message: 'boom' } } },
    });
    const { error } = await deliverResearchReport(broken as never, POST_ID, REPORT, HTML, NOW);
    expect(error).toEqual({ message: 'boom' });
  });
});
