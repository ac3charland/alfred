/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { pinClock } from '@/lib/pin-clock';
import { makeReaderPost, makeReaderPublication } from '@/lib/reader/fixtures';
import { createClient } from '@/lib/supabase/server';

import { POST as SEND } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

pinClock('2026-09-24T12:00:00.000Z');
const NOW = '2026-09-24T12:00:00.000Z';

const PUBLICATION = makeReaderPublication('Second Thoughts');
const POST_ID = '11111111-1111-4111-8111-111111111111';

/** The four credentials, as a configured deployment has them. */
const CREDENTIALS = {
  INSTAPAPER_CONSUMER_KEY: 'consumer-key',
  INSTAPAPER_CONSUMER_SECRET: 'consumer-secret-SHOULD-NEVER-BE-LOGGED',
  INSTAPAPER_ACCESS_TOKEN: 'access-token',
  INSTAPAPER_ACCESS_TOKEN_SECRET: 'access-token-secret-SHOULD-NEVER-BE-LOGGED',
};

/** What `getReaderPostForSend` reads — bodies included, which no other read here asks for. */
const SENDABLE = {
  title: 'How near is the intelligence explosion, really?',
  canonical_url: 'https://open.substack.com/pub/second-thoughts/p/how-near',
  gist: 'Argues the recursive self-improvement debate conflates three feedback loops.',
  html: '<html><body><p>THE-ARTICLE-BODY</p></body></html>',
  text: 'THE-ARTICLE-BODY',
  archived_at: null,
};

/** What the write answers with — the list row, carrying neither body. */
const SENT_ROW = makeReaderPost(PUBLICATION.id, {
  id: POST_ID,
  instapaper_sent_at: NOW,
  instapaper_bookmark_id: 1_234_567,
  archived_at: NOW,
});

const originalEnvironment = { ...process.env };
const originalFetch = globalThis.fetch;

/**
 * Point the route at a configured deployment, or at one with no credentials at all. Cleared
 * first because the ambient environment may carry some of its own.
 */
function withCredentials(configured: boolean): void {
  process.env = { ...originalEnvironment };
  delete process.env.INSTAPAPER_CONSUMER_KEY;
  delete process.env.INSTAPAPER_CONSUMER_SECRET;
  delete process.env.INSTAPAPER_ACCESS_TOKEN;
  delete process.env.INSTAPAPER_ACCESS_TOKEN_SECRET;
  delete process.env.INSTAPAPER_API_URL;
  if (configured) Object.assign(process.env, CREDENTIALS);
}

/**
 * A signed-in client whose `reader_posts` chain answers the route's TWO `.maybeSingle()` calls
 * in order: the pre-read first, the write second. One stub cannot serve both — they are
 * deliberately different shapes, and that ordering is what the assertions below rest on.
 */
function signedIn(
  options: { read?: unknown; written?: unknown; readError?: unknown; writeError?: unknown } = {},
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({ reader_posts: {} });
  const chain = supabase.table('reader_posts');
  chain.maybeSingle
    .mockResolvedValueOnce({
      data: 'read' in options ? options.read : SENDABLE,
      error: options.readError ?? null,
    })
    .mockResolvedValueOnce({
      data: 'written' in options ? options.written : SENT_ROW,
      error: options.writeError ?? null,
    });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

/** Answer the one outbound call to Instapaper. */
function mockInstapaper(respond: () => Response | Promise<Response>): jest.Mock {
  const fetchMock = jest.fn(async () => respond());
  globalThis.fetch = fetchMock;
  return fetchMock;
}

function saved(bookmarkId = 1_234_567): Response {
  return Response.json([{ type: 'bookmark', bookmark_id: bookmarkId }], { status: 200 });
}

function instapaperError(code: number, status = 400): Response {
  return Response.json([{ type: 'error', error_code: code, message: 'internal detail' }], {
    status,
  });
}

function request(id: string): Request {
  return new Request(`http://localhost/api/reader/posts/${id}/instapaper`, { method: 'POST' });
}

function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

async function detail(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { error?: string };
  return body.error;
}

beforeEach(() => {
  withCredentials(true);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...originalEnvironment };
  globalThis.fetch = originalFetch;
});

describe('POST /api/reader/posts/[id]/instapaper — a successful send', () => {
  it('stamps the send, the bookmark id and the archive, and returns the row', async () => {
    const supabase = signedIn();
    mockInstapaper(saved);

    const response = await SEND(request(POST_ID), context(POST_ID));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SENT_ROW);
    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith({
      instapaper_sent_at: NOW,
      instapaper_bookmark_id: 1_234_567,
      archived_at: NOW,
    });
  });

  it('keeps an already-archived post’s own archived_at rather than re-dating it', async () => {
    // Sending from the archive. Writing `now` would silently move every archived post the owner
    // sends to the top of the archive.
    const archivedAt = '2026-09-16T08:30:00.000Z';
    const supabase = signedIn({ read: { ...SENDABLE, archived_at: archivedAt } });
    mockInstapaper(saved);

    await SEND(request(POST_ID), context(POST_ID));

    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith(
      expect.objectContaining({ archived_at: archivedAt }),
    );
  });

  it('sends the post body as the bookmark’s content, signed', async () => {
    signedIn();
    const fetchMock = mockInstapaper(saved);

    await SEND(request(POST_ID), context(POST_ID));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://www.instapaper.com/api/1/bookmarks/add');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toContain('oauth_signature=');
    const sent = new URLSearchParams(init.body as string);
    expect(sent.get('content')).toContain('THE-ARTICLE-BODY');
    expect(sent.get('url')).toBe(SENDABLE.canonical_url);
    expect(sent.get('title')).toBe(SENDABLE.title);
    expect(sent.get('description')).toBe(SENDABLE.gist);
  });

  it('answers with the shared list columns, so neither body comes back', async () => {
    const supabase = signedIn();
    mockInstapaper(saved);

    await SEND(request(POST_ID), context(POST_ID));

    // Compared as COLUMNS, not as a substring: `text_swept_at` is a column the list does carry.
    // The double's mock is loosely typed, so the column list is read through its own narrow
    // signature rather than indexed out of an `any` call tuple.
    const selects = (supabase.table('reader_posts').select.mock.calls as [string][]).map(
      ([columns]) => columns,
    );
    const listColumns = (selects.at(-1) ?? '').split(',');
    expect(listColumns).not.toContain('text');
    expect(listColumns).not.toContain('html');
    expect(listColumns).toContain('instapaper_sent_at');
    expect(listColumns).toContain('instapaper_bookmark_id');
  });

  it('reads the bodies exactly once, in the one read that is allowed to', async () => {
    const supabase = signedIn();
    mockInstapaper(saved);

    await SEND(request(POST_ID), context(POST_ID));

    const [readColumns] = (supabase.table('reader_posts').select.mock.calls as [string][])[0] ?? [
      '',
    ];
    expect(readColumns.split(',')).toStrictEqual([
      'title',
      'canonical_url',
      'gist',
      'html',
      'text',
      'archived_at',
    ]);
  });
});

describe('POST /api/reader/posts/[id]/instapaper — refusals before the call', () => {
  it('501s on an unconfigured deployment, with no read and no outbound call', async () => {
    withCredentials(false);
    const supabase = signedIn();
    const fetchMock = mockInstapaper(saved);

    const response = await SEND(request(POST_ID), context(POST_ID));

    expect(response.status).toBe(501);
    expect(await detail(response)).toBe("Instapaper isn't set up on this deployment");
    expect(fetchMock).not.toHaveBeenCalled();
    // Nothing is learned about the post either: the row is never touched.
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('401s with no session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);
    const fetchMock = mockInstapaper(saved);

    const response = await SEND(request(POST_ID), context(POST_ID));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400s on a malformed id', async () => {
    signedIn();
    const fetchMock = mockInstapaper(saved);

    const response = await SEND(request('nope'), context('nope'));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('404s for a post that is not there', async () => {
    const supabase = signedIn({ read: null });
    const fetchMock = mockInstapaper(saved);

    const response = await SEND(request(POST_ID), context(POST_ID));

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(supabase.table('reader_posts').update).not.toHaveBeenCalled();
  });

  it('409s for a post with no link and no stored text, without calling Instapaper', async () => {
    // A swept post that never had a canonical URL. There is no article and no address to find
    // one at, so there is nothing to ask for.
    const supabase = signedIn({
      read: { ...SENDABLE, canonical_url: null, html: null, text: null },
    });
    const fetchMock = mockInstapaper(saved);

    const response = await SEND(request(POST_ID), context(POST_ID));

    expect(response.status).toBe(409);
    expect(await detail(response)).toBe(
      'Nothing to send — this post has no link and no stored text',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(supabase.table('reader_posts').update).not.toHaveBeenCalled();
  });

  it('500s when the pre-read itself fails', async () => {
    const supabase = signedIn({ read: null, readError: { code: 'XX000', message: 'boom' } });
    const fetchMock = mockInstapaper(saved);

    const response = await SEND(request(POST_ID), context(POST_ID));

    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(supabase.table('reader_posts').update).not.toHaveBeenCalled();
  });
});

describe('POST /api/reader/posts/[id]/instapaper — what Instapaper said', () => {
  it.each([
    [1221, 422, 'This publication has opted out of Instapaper'],
    [1220, 422, "Instapaper can't fetch this post itself, and its stored text is gone"],
    [1240, 422, "Instapaper didn't accept this post's link"],
    [1040, 429, 'Instapaper is rate-limiting — try again in a minute'],
    [1041, 502, 'Instapaper says this needs a Premium account'],
    [1042, 502, "Instapaper rejected alfred's credentials"],
    [1246, 502, "Instapaper didn't answer — try again"],
    [9999, 502, "Instapaper didn't answer — try again"],
  ])('maps error %i to %i with its own sentence', async (code, status, message) => {
    const supabase = signedIn();
    mockInstapaper(() => instapaperError(code));

    const response = await SEND(request(POST_ID), context(POST_ID));

    expect(response.status).toBe(status);
    expect(await detail(response)).toBe(message);
    // Nothing is written unless Instapaper confirms the save — which is what makes the store's
    // optimistic send safe to roll back.
    expect(supabase.table('reader_posts').update).not.toHaveBeenCalled();
  });

  it.each([401, 403])('maps an HTTP %i to a credentials 502', async (status) => {
    signedIn();
    mockInstapaper(() => Response.json([], { status }));

    const response = await SEND(request(POST_ID), context(POST_ID));

    expect(response.status).toBe(502);
    expect(await detail(response)).toBe("Instapaper rejected alfred's credentials");
  });

  it.each([
    [
      'a timeout or network error',
      () => {
        throw new Error('The operation was aborted due to timeout');
      },
    ],
    ['a 5xx', () => new Response('upstream', { status: 503 })],
    ['a body that is not JSON', () => new Response('<html>maintenance</html>', { status: 200 })],
    ['an unrecognised JSON shape', () => Response.json({ ok: true }, { status: 200 })],
  ])('502s on %s, writing nothing', async (_label, respond) => {
    const supabase = signedIn();
    mockInstapaper(respond);

    const response = await SEND(request(POST_ID), context(POST_ID));

    expect(response.status).toBe(502);
    expect(await detail(response)).toBe("Instapaper didn't answer — try again");
    expect(supabase.table('reader_posts').update).not.toHaveBeenCalled();
  });

  it("never shows Instapaper's own message, which its docs say is not for users", async () => {
    signedIn();
    mockInstapaper(() => instapaperError(1221));

    const response = await SEND(request(POST_ID), context(POST_ID));

    expect(await detail(response)).not.toContain('internal detail');
  });

  it('maps a failed write after a confirmed save through the shared error mapper', async () => {
    // Instapaper HAS the post. The owner sees a failure and a row still on the list; pressing
    // again is safe, because Instapaper moves an existing bookmark rather than duplicating it.
    signedIn({ written: null, writeError: { code: 'XX000', message: 'boom' } });
    mockInstapaper(saved);

    const response = await SEND(request(POST_ID), context(POST_ID));

    expect(response.status).toBe(500);
  });

  it('404s when the row vanished between the read and the write', async () => {
    signedIn({ written: null });
    mockInstapaper(saved);

    const response = await SEND(request(POST_ID), context(POST_ID));

    expect(response.status).toBe(404);
  });
});

describe('POST /api/reader/posts/[id]/instapaper — what it logs', () => {
  it('logs the post id and the error code, and never a credential, header or the content', async () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    signedIn();
    mockInstapaper(() => instapaperError(1221));

    await SEND(request(POST_ID), context(POST_ID));

    const lines = JSON.stringify(logged.mock.calls);
    expect(lines).toContain(POST_ID);
    expect(lines).toContain('1221');
    expect(lines).not.toContain('consumer-secret-SHOULD-NEVER-BE-LOGGED');
    expect(lines).not.toContain('access-token-secret-SHOULD-NEVER-BE-LOGGED');
    expect(lines).not.toContain('consumer-key');
    expect(lines).not.toContain('OAuth ');
    expect(lines).not.toContain('THE-ARTICLE-BODY');
  });

  it('logs nothing at all on a successful send', async () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    signedIn();
    mockInstapaper(saved);

    await SEND(request(POST_ID), context(POST_ID));

    expect(logged).not.toHaveBeenCalled();
  });
});
