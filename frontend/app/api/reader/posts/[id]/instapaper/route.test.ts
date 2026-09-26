/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { READER_POST_LIST_COLUMNS, type ReaderPostForSend } from '@/lib/data/reader';
import { pinClock } from '@/lib/pin-clock';
import { makeReaderPost, makeReaderPublication } from '@/lib/reader/fixtures';
import { createClient } from '@/lib/supabase/server';

import { POST } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

pinClock('2026-09-24T12:00:00.000Z');

const PUBLICATION = makeReaderPublication('Second Thoughts');
const POST_ID = '11111111-1111-4111-8111-111111111111';

const BODY_HTML = '<html><body><p>The whole paid post, as mailed.</p></body></html>';
const BODY_TEXT = 'The whole paid post, as mailed.';

/** What the route's pre-read hands back: the bodies, and the fields a bookmark is built from. */
const STORED: ReaderPostForSend = {
  title: 'How near is the intelligence explosion, really?',
  canonical_url: 'https://open.substack.com/pub/second/p/how-near',
  gist: 'Argues the debate conflates three feedback loops.',
  html: BODY_HTML,
  text: BODY_TEXT,
  archived_at: null,
};

/** What the stamp reads back: the list row, with no body on it. */
function savedRow(overrides: Parameters<typeof makeReaderPost>[1] = {}) {
  const {
    text: _text,
    html: _html,
    ...row
  } = makeReaderPost(PUBLICATION.id, {
    id: POST_ID,
    instapaper_sent_at: '2026-09-24T12:00:00.000Z',
    instapaper_bookmark_id: 1_234_567,
    archived_at: '2026-09-24T12:00:00.000Z',
    ...overrides,
  });
  return row;
}

const CREDENTIALS = {
  INSTAPAPER_CONSUMER_KEY: 'ck-secret-looking-value',
  INSTAPAPER_CONSUMER_SECRET: 'cs-secret-looking-value',
  INSTAPAPER_ACCESS_TOKEN: 'tk-secret-looking-value',
  INSTAPAPER_ACCESS_TOKEN_SECRET: 'ts-secret-looking-value',
};

const originalEnvironment = { ...process.env };

/** A request's form body, as the fetch spy recorded it. */
function formBody(init: RequestInit | undefined): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(typeof init?.body === 'string' ? init.body : ''));
}

function configure(configured: boolean): void {
  process.env = Object.fromEntries(
    Object.entries(originalEnvironment).filter(([name]) => !name.startsWith('INSTAPAPER_')),
  ) as NodeJS.ProcessEnv;
  if (configured) Object.assign(process.env, CREDENTIALS);
}

/**
 * A signed-in client whose first `maybeSingle` is the pre-read and whose second is the stamp's
 * read-back — the route reads the post, then writes it, on the same table.
 */
function signedIn(
  stored: ReaderPostForSend | null = STORED,
  saved: unknown = savedRow(),
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({});
  supabase
    .table('reader_posts')
    .maybeSingle.mockResolvedValueOnce({ data: stored, error: null })
    .mockResolvedValueOnce({ data: saved, error: null });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

/** Instapaper's answer, for the one outbound call a send makes. */
function instapaperAnswers(body: unknown, status = 200): jest.SpiedFunction<typeof fetch> {
  return jest.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(body, { status }));
}

function send(id: string = POST_ID): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/reader/posts/${id}/instapaper`, { method: 'POST' }),
    {
      params: Promise.resolve({ id }),
    },
  );
}

/** Every argument every console method was called with, flattened to one searchable string. */
function everythingLogged(spies: jest.SpiedFunction<(...args: unknown[]) => void>[]): string {
  return JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
}

beforeEach(() => {
  configure(true);
  // A refusal logs a line by design; kept out of the test output. The logging test re-spies.
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe('POST /api/reader/posts/[id]/instapaper', () => {
  it('saves the post to Instapaper with its email HTML, then stamps it sent and archived', async () => {
    const supabase = signedIn();
    const fetchSpy = instapaperAnswers([{ type: 'bookmark', bookmark_id: 1_234_567 }]);

    const response = await send();

    expect(response.status).toBe(200);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('https://www.instapaper.com/api/1/bookmarks/add');
    expect(formBody(init)).toEqual({
      url: STORED.canonical_url,
      title: STORED.title,
      description: STORED.gist,
      content: BODY_HTML,
    });
    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith({
      instapaper_sent_at: '2026-09-24T12:00:00.000Z',
      instapaper_bookmark_id: 1_234_567,
      archived_at: '2026-09-24T12:00:00.000Z',
    });
    expect(supabase.table('reader_posts').eq).toHaveBeenCalledWith('id', POST_ID);
  });

  it('keeps an already-archived post’s archived_at — a send from the archive does not re-date it', async () => {
    const supabase = signedIn({ ...STORED, archived_at: '2026-09-17T09:00:00.000Z' });
    instapaperAnswers([{ type: 'bookmark', bookmark_id: 7 }]);

    const response = await send();

    expect(response.status).toBe(200);
    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith(
      expect.objectContaining({ archived_at: '2026-09-17T09:00:00.000Z' }),
    );
  });

  it('returns the list row — with neither text nor html — read back through the shared columns', async () => {
    const saved = savedRow();
    const supabase = signedIn(STORED, saved);
    instapaperAnswers([{ type: 'bookmark', bookmark_id: 1_234_567 }]);

    const response = await send();
    const body = (await response.json()) as Record<string, unknown>;

    expect(body).toEqual(saved);
    expect(body).not.toHaveProperty('text');
    expect(body).not.toHaveProperty('html');
    // The first select is the pre-read (which DOES want the bodies); the second is the stamp's.
    expect(supabase.table('reader_posts').select).toHaveBeenLastCalledWith(
      READER_POST_LIST_COLUMNS,
    );
  });

  it('501s when this deployment has no Instapaper credentials, with no read and no outbound call', async () => {
    configure(false);
    const supabase = signedIn();
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    const response = await send();

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: "Instapaper isn't set up on this deployment" });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('404s for a post that is not there, without calling Instapaper', async () => {
    signedIn(null);
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    const response = await send();

    expect(response.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('409s when there is no link and no body — nothing Instapaper could save', async () => {
    const supabase = signedIn({ ...STORED, canonical_url: null, html: null, text: null });
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    const response = await send();

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Nothing to send — this post has no link and no stored text',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(supabase.table('reader_posts').update).not.toHaveBeenCalled();
  });

  it('sends a link-less post as a private bookmark carrying its body', async () => {
    signedIn({ ...STORED, canonical_url: null });
    const fetchSpy = instapaperAnswers([{ type: 'bookmark', bookmark_id: 9 }]);

    await send();

    const params = formBody(fetchSpy.mock.calls[0]?.[1]);
    expect(params['is_private_from_source']).toBe('email');
    expect(params).not.toHaveProperty('url');
    expect(params['content']).toBe(BODY_HTML);
  });

  it.each([
    [
      'an opt-out',
      [{ type: 'error', error_code: 1221 }],
      400,
      422,
      'This publication has opted out of Instapaper',
    ],
    [
      'a rate limit',
      [{ type: 'error', error_code: 1040 }],
      400,
      429,
      'Instapaper is rate-limiting — try again in a minute',
    ],
    [
      'a credentials rejection',
      'Unauthorized',
      401,
      502,
      "Instapaper rejected alfred's credentials",
    ],
    ['an outage', 'Service unavailable', 503, 502, "Instapaper didn't answer — try again"],
  ])(
    'answers %s with its status and sentence, and writes nothing',
    async (_label, answer, upstream, status, detail) => {
      const supabase = signedIn();
      instapaperAnswers(answer, upstream);

      const response = await send();

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: detail });
      expect(supabase.table('reader_posts').update).not.toHaveBeenCalled();
    },
  );

  it('writes nothing when Instapaper never answers', async () => {
    const supabase = signedIn();
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    const response = await send();

    expect(response.status).toBe(502);
    expect(supabase.table('reader_posts').update).not.toHaveBeenCalled();
  });

  it('passes a failed stamp through the shared error mapping, after Instapaper saved the post', async () => {
    const supabase = makeSupabaseDouble({});
    supabase
      .table('reader_posts')
      .maybeSingle.mockResolvedValueOnce({ data: STORED, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    mockCreateClient.mockResolvedValue(supabase as never);
    instapaperAnswers([{ type: 'bookmark', bookmark_id: 1 }]);

    const response = await send();

    expect(response.status).toBe(500);
  });

  it('never logs the credentials, the Authorization header or the post’s body', async () => {
    const logs = [
      jest.spyOn(console, 'log').mockImplementation(() => {}),
      jest.spyOn(console, 'info').mockImplementation(() => {}),
      jest.spyOn(console, 'warn').mockImplementation(() => {}),
      jest.spyOn(console, 'error').mockImplementation(() => {}),
    ];

    // A refusal (the branch that logs) and a success, both carrying a body.
    signedIn();
    instapaperAnswers([{ type: 'error', error_code: 1221, message: 'x' }], 400);
    await send();
    signedIn();
    instapaperAnswers([{ type: 'bookmark', bookmark_id: 1 }]);
    await send();

    const logged = everythingLogged(logs);
    // The refusal WAS logged — by post id, outcome and code — so this is not vacuously clean.
    expect(logged).toContain(POST_ID);
    expect(logged).toContain('1221');
    for (const secret of Object.values(CREDENTIALS)) expect(logged).not.toContain(secret);
    expect(logged).not.toContain('OAuth ');
    expect(logged).not.toContain('oauth_signature');
    expect(logged).not.toContain(BODY_TEXT);
  });

  it('401s with no session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await send();

    expect(response.status).toBe(401);
  });

  it('400s on a malformed id', async () => {
    signedIn();

    const response = await send('nope');

    expect(response.status).toBe(400);
  });
});
