/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {
  type MockResult,
  makeChain,
  makeSignedOutDouble,
  makeSupabaseDouble,
} from '@/lib/api/supabase-route-double';
import { pinClock } from '@/lib/pin-clock';
import { makeReaderOverview, makeReaderPost, makeReaderPublication } from '@/lib/reader/fixtures';
import { createClient } from '@/lib/supabase/server';
import type { ReaderPostListItem } from '@/lib/types';
import { WikiWriteError, commitEnvelopes } from '@/lib/wiki/writer/commit';
import { type WikiConfig, getWikiConfig } from '@/lib/wiki/writer/config';

import { POST } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/wiki/writer/config', () => ({ getWikiConfig: jest.fn() }));
// A partial mock: the commit is stubbed, but `WikiWriteError` stays the real class, since the
// route maps its `kind` to a status.
jest.mock('@/lib/wiki/writer/commit', () => ({
  ...jest.requireActual<typeof import('@/lib/wiki/writer/commit')>('@/lib/wiki/writer/commit'),
  commitEnvelopes: jest.fn(),
}));

const mockCreateClient = jest.mocked(createClient);
const mockGetWikiConfig = jest.mocked(getWikiConfig);
const mockCommit = jest.mocked(commitEnvelopes);

pinClock('2026-10-03T12:00:00.000Z');

const CONFIG: WikiConfig = {
  owner: 'ac3charland',
  name: 'knowledge',
  token: 'secret-token',
  apiUrl: 'https://api.github.com',
};

const PUBLICATION = makeReaderPublication('Jane Doe');
const POST_ID = '6f1c2b3a-0000-4000-8000-000000000001';
const IDEAS = [
  'Habit stacking works because the cue is an existing routine, not a time of day.',
  'Environment design beats willpower for the first thirty days.',
  'Identity-based framing outlasts outcome goals.',
];
const BODY_TEXT = 'Habits are the compound interest of self-improvement.';

/** The row the send reads — body included. */
function stored(wikiSentIdeas: string[] = []) {
  return makeReaderPost(PUBLICATION.id, {
    id: POST_ID,
    gmail_message_id: 'gmail-1',
    title: 'Why habits stick',
    author: 'Jane Doe',
    canonical_url: 'https://janedoe.substack.com/p/why-habits-stick',
    received_at: '2026-10-02T22:15:00.000Z',
    text: BODY_TEXT,
    overview: makeReaderOverview({ novel_ideas: IDEAS }),
    wiki_sent_ideas: wikiSentIdeas,
  });
}

/** The same row through the list columns, as the RPC and the list read answer it. */
function listRow(wikiSentIdeas: string[]): ReaderPostListItem {
  const { text: _text, ...row } = stored(wikiSentIdeas);
  return row;
}

function signedIn(
  row: ReturnType<typeof stored> | null = stored(),
  /** What the append answers; by default, the row with the first two bullets marked sent. */
  appended?: MockResult,
) {
  const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: row } } });
  supabase.rpc.mockReturnValue(
    makeChain({ single: appended ?? { data: listRow(IDEAS.slice(0, 2)) } }),
  );
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function send(id: string, body: unknown): Request {
  return new Request(`http://localhost/api/reader/posts/${id}/wiki`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetWikiConfig.mockReturnValue(CONFIG);
  mockCommit.mockResolvedValue({ commitSha: 'c0ffee', folders: ['inbox/x'] });
});

describe('POST /api/reader/posts/[id]/wiki', () => {
  it('commits one envelope holding the post and exactly the picked bullets', async () => {
    signedIn();

    const response = await POST(send(POST_ID, { ideas: IDEAS.slice(0, 2) }), context(POST_ID));

    expect(response.status).toBe(200);
    expect(mockCommit).toHaveBeenCalledTimes(1);
    const [config, envelopes] = mockCommit.mock.calls[0] ?? [];
    expect(config).toBe(CONFIG);
    expect(envelopes).toHaveLength(1);
    const envelope = envelopes?.[0];
    expect(envelope?.title).toBe('Why habits stick');
    expect(envelope?.captured).toBe('2026-10-03');
    expect(envelope?.files.map((file) => file.name)).toEqual(['source.md', 'picks-2026-10-03.md']);
    expect(envelope?.files[0]?.content).toContain(BODY_TEXT);
    expect(envelope?.files[0]?.content).toContain(
      'external_id: "alfred:reader-post:6f1c2b3a-0000-4000-8000-000000000001"',
    );
    expect(envelope?.files[1]?.content).toContain(`- ${IDEAS[0] ?? ''}\n- ${IDEAS[1] ?? ''}\n`);
    expect(envelope?.files[1]?.content).not.toContain(IDEAS[2]);
  });

  it('records the sent bullets through the atomic append, after the commit', async () => {
    const supabase = signedIn();

    await POST(send(POST_ID, { ideas: IDEAS.slice(0, 2) }), context(POST_ID));

    expect(supabase.rpc).toHaveBeenCalledWith('append_wiki_sent_ideas', {
      p_post: POST_ID,
      p_ideas: IDEAS.slice(0, 2),
    });
    const committed = mockCommit.mock.invocationCallOrder[0] ?? 0;
    const appended = supabase.rpc.mock.invocationCallOrder[0] ?? 0;
    expect(committed).toBeLessThan(appended);
  });

  it('answers the list-column row, and the body never appears in the response', async () => {
    signedIn();

    const response = await POST(send(POST_ID, { ideas: IDEAS.slice(0, 2) }), context(POST_ID));

    const raw = await response.text();
    const body = JSON.parse(raw) as Record<string, unknown>;
    expect(body).toEqual(listRow(IDEAS.slice(0, 2)));
    expect(Object.keys(body)).not.toContain('text');
    expect(raw).not.toContain(BODY_TEXT);
  });

  it('commits only the bullets not already sent', async () => {
    const supabase = signedIn(stored([IDEAS[0] ?? '']));

    await POST(send(POST_ID, { ideas: IDEAS.slice(0, 2) }), context(POST_ID));

    const picks = mockCommit.mock.calls[0]?.[1][0]?.files[1]?.content ?? '';
    expect(picks).toContain(IDEAS[1]);
    expect(picks).not.toContain(IDEAS[0]);
    expect(supabase.rpc).toHaveBeenCalledWith('append_wiki_sent_ideas', {
      p_post: POST_ID,
      p_ideas: [IDEAS[1]],
    });
  });

  it('commits a bullet named twice only once', async () => {
    const supabase = signedIn();
    const once = IDEAS[0] ?? '';

    await POST(send(POST_ID, { ideas: [once, once] }), context(POST_ID));

    const picks = mockCommit.mock.calls[0]?.[1][0]?.files[1]?.content ?? '';
    expect(picks.split('\n').filter((line) => line.startsWith('- '))).toEqual([`- ${once}`]);
    expect(supabase.rpc).toHaveBeenCalledWith('append_wiki_sent_ideas', {
      p_post: POST_ID,
      p_ideas: [once],
    });
  });

  it('answers 200 with the row unchanged and makes no commit when every bullet was sent', async () => {
    const supabase = makeSupabaseDouble({});
    const read = makeChain({ maybeSingle: { data: stored([...IDEAS]) } });
    const list = makeChain({ maybeSingle: { data: listRow([...IDEAS]) } });
    supabase.from.mockReturnValueOnce(read).mockReturnValueOnce(list);
    mockCreateClient.mockResolvedValue(supabase as never);

    const response = await POST(send(POST_ID, { ideas: IDEAS.slice(0, 1) }), context(POST_ID));

    expect(response.status).toBe(200);
    expect(mockCommit).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
    const raw = await response.text();
    expect(JSON.parse(raw)).toEqual(listRow([...IDEAS]));
    expect(raw).not.toContain(BODY_TEXT);
  });

  it('501s before reading anything when the writer is not configured', async () => {
    const supabase = signedIn();
    mockGetWikiConfig.mockReturnValue(undefined);

    const response = await POST(send(POST_ID, { ideas: IDEAS.slice(0, 1) }), context(POST_ID));

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: 'The wiki is not configured on this deployment',
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('404s for a post that is not there', async () => {
    signedIn(null);

    const response = await POST(send(POST_ID, { ideas: IDEAS.slice(0, 1) }), context(POST_ID));

    expect(response.status).toBe(404);
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('409s when a bullet is no longer in the overview — a re-summarise ran underneath', async () => {
    signedIn();

    const response = await POST(
      send(POST_ID, { ideas: [IDEAS[0], 'A bullet the model has since reworded.'] }),
      context(POST_ID),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "That idea isn't in this post's overview any more",
    });
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('409s when the post has no overview to pick from at all', async () => {
    signedIn(makeReaderPost(PUBLICATION.id, { id: POST_ID, overview: null }));

    const response = await POST(send(POST_ID, { ideas: IDEAS.slice(0, 1) }), context(POST_ID));

    expect(response.status).toBe(409);
  });

  it.each([
    ['busy', 503, 'The wiki repo was busy — try again'],
    ['unauthorized', 502, "Couldn't reach the wiki repo"],
    ['rejected', 502, "Couldn't reach the wiki repo"],
    ['unreachable', 502, "Couldn't reach the wiki repo"],
  ] as const)('maps a %s commit failure to %i', async (kind, status, sentence) => {
    const supabase = signedIn();
    mockCommit.mockRejectedValue(new WikiWriteError(kind, 'wiki: failed'));

    const response = await POST(send(POST_ID, { ideas: IDEAS.slice(0, 1) }), context(POST_ID));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: sentence });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('500s when the append fails after the commit landed', async () => {
    signedIn(stored(), { data: null, error: { message: 'boom' } });

    const response = await POST(send(POST_ID, { ideas: IDEAS.slice(0, 1) }), context(POST_ID));

    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(500);
  });

  it('401s with no session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await POST(send(POST_ID, { ideas: IDEAS.slice(0, 1) }), context(POST_ID));

    expect(response.status).toBe(401);
  });

  it('400s on a malformed id', async () => {
    signedIn();

    const response = await POST(send('nope', { ideas: IDEAS.slice(0, 1) }), context('nope'));

    expect(response.status).toBe(400);
  });

  it.each([
    ['no bullets at all', { ideas: [] }],
    ['an empty bullet', { ideas: [''] }],
    ['a stray key', { ideas: IDEAS.slice(0, 1), note: 'x' }],
  ])('400s on %s', async (_name, body) => {
    signedIn();

    const response = await POST(send(POST_ID, body), context(POST_ID));

    expect(response.status).toBe(400);
    expect(mockCommit).not.toHaveBeenCalled();
  });
});
