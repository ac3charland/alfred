/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import type { ReaderPostForSend } from '@/lib/data/reader';
import { pinClock } from '@/lib/pin-clock';
import { makeReaderPost, makeReaderPublication } from '@/lib/reader/fixtures';
import { createClient } from '@/lib/supabase/server';

import { POST } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

pinClock('2026-09-24T12:00:00.000Z');

const POST_ID = '11111111-1111-4111-8111-111111111111';
const PUBLICATION = makeReaderPublication('Second Thoughts');

/** Credentials no real account has — distinctive, so a leak into a log line is findable. */
const CREDENTIALS = {
  INSTAPAPER_CONSUMER_KEY: 'ck-route-test-consumer-key',
  INSTAPAPER_CONSUMER_SECRET: 'cs-route-test-consumer-secret',
  INSTAPAPER_ACCESS_TOKEN: 'at-route-test-access-token',
  INSTAPAPER_ACCESS_TOKEN_SECRET: 'ats-route-test-token-secret',
  INSTAPAPER_API_URL: 'https://instapaper.test',
};

const HTML =
  '<html><body><h1>The post</h1><p>Paid paragraph the teaser never shows.</p></body></html>';
const TEXT = 'The post\nPaid paragraph the teaser never shows.';

/** A post as the send's read sees it: a link, a gist, and both bodies. */
const STORED: ReaderPostForSend = {
  title: 'How near is the intelligence explosion, really?',
  canonical_url: 'https://secondthoughts.substack.com/p/intelligence-explosion',
  gist: 'Argues the debate conflates three feedback loops.',
  html: HTML,
  text: TEXT,
  archived_at: null,
};

/** The row the stamp writes back, as the list sees it. */
const SAVED_ROW = (() => {
  const {
    text: _text,
    html: _html,
    ...row
  } = makeReaderPost(PUBLICATION.id, {
    id: POST_ID,
    archived_at: '2026-09-24T12:00:00.000Z',
    instapaper_sent_at: '2026-09-24T12:00:00.000Z',
    instapaper_bookmark_id: 1_234_567,
  });
  return row;
})();

function signedIn(
  stored: ReaderPostForSend | null = STORED,
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({
    reader_posts: { maybeSingle: { data: stored }, single: { data: SAVED_ROW } },
  });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function send(id: string): Request {
  return new Request(`http://localhost/api/reader/posts/${id}/instapaper`, { method: 'POST' });
}

function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

/** What Instapaper answers with: a JSON array holding one bookmark or one error. */
function instapaperAnswers(status: number, body: unknown): jest.SpiedFunction<typeof fetch> {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
    );
}

const BOOKMARK = [{ type: 'bookmark', bookmark_id: 1_234_567, title: STORED.title }];

function refusal(code: number): unknown {
  return [
    { type: 'error', error_code: code, message: `Instapaper's own words for ${String(code)}` },
  ];
}

const originalEnvironment = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(process.env, CREDENTIALS);
});

afterEach(() => {
  jest.restoreAllMocks();
  process.env = { ...originalEnvironment };
});

/** The form body Instapaper was sent, decoded. */
function sentForm(fetchSpy: jest.SpiedFunction<typeof fetch>): URLSearchParams {
  const [, init] = fetchSpy.mock.calls[0] ?? [];
  return new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
}

describe('POST /api/reader/posts/[id]/instapaper', () => {
  it('401s with no session, before anything else', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);
    const fetchSpy = instapaperAnswers(200, BOOKMARK);

    const response = await POST(send(POST_ID), context(POST_ID));

    expect(response.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('400s on a malformed id', async () => {
    signedIn();

    const response = await POST(send('nope'), context('nope'));

    expect(response.status).toBe(400);
  });

  it.each(Object.keys(CREDENTIALS).filter((name) => name !== 'INSTAPAPER_API_URL'))(
    '501s with no read and no outbound call when %s is unset',
    async (name) => {
      const supabase = signedIn();
      const fetchSpy = instapaperAnswers(200, BOOKMARK);
      Reflect.deleteProperty(process.env, name);

      const response = await POST(send(POST_ID), context(POST_ID));

      expect(response.status).toBe(501);
      await expect(response.json()).resolves.toEqual({
        error: "Instapaper isn't set up on this deployment",
      });
      expect(supabase.from).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('404s for a post that is not there, without calling Instapaper', async () => {
    signedIn(null);
    const fetchSpy = instapaperAnswers(200, BOOKMARK);

    const response = await POST(send(POST_ID), context(POST_ID));

    expect(response.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps a failed read to its status, without calling Instapaper', async () => {
    const supabase = signedIn();
    supabase
      .table('reader_posts')
      .maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const fetchSpy = instapaperAnswers(200, BOOKMARK);

    const response = await POST(send(POST_ID), context(POST_ID));

    expect(response.status).toBe(500);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('409s when there is neither a link nor a body, without calling Instapaper', async () => {
    const supabase = signedIn({ ...STORED, canonical_url: null, html: null, text: null });
    const fetchSpy = instapaperAnswers(200, BOOKMARK);

    const response = await POST(send(POST_ID), context(POST_ID));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Nothing to send — this post has no link and no stored text',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(supabase.table('reader_posts').update).not.toHaveBeenCalled();
  });

  it('reads the post’s bodies server-side and sends one signed request carrying the HTML', async () => {
    signedIn();
    const fetchSpy = instapaperAnswers(200, BOOKMARK);

    await POST(send(POST_ID), context(POST_ID));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('https://instapaper.test/api/1/bookmarks/add');
    expect(new Headers(init?.headers).get('authorization')).toMatch(/^OAuth /);
    const form = sentForm(fetchSpy);
    expect(form.get('url')).toBe(STORED.canonical_url);
    expect(form.get('content')).toBe(HTML);
    expect(form.get('title')).toBe(STORED.title);
    expect(form.get('description')).toBe(STORED.gist);
  });

  it('stamps the send and archives the post on a confirmed save, answering with the list row', async () => {
    const supabase = signedIn();
    instapaperAnswers(200, BOOKMARK);

    const response = await POST(send(POST_ID), context(POST_ID));

    expect(response.status).toBe(200);
    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith({
      instapaper_sent_at: '2026-09-24T12:00:00.000Z',
      instapaper_bookmark_id: 1_234_567,
      archived_at: '2026-09-24T12:00:00.000Z',
    });
    expect(supabase.table('reader_posts').eq).toHaveBeenCalledWith('id', POST_ID);
    await expect(response.json()).resolves.toEqual(SAVED_ROW);
  });

  it('keeps an already-archived post’s archived_at', async () => {
    const supabase = signedIn({ ...STORED, archived_at: '2026-09-20T08:00:00.000Z' });
    instapaperAnswers(200, BOOKMARK);

    await POST(send(POST_ID), context(POST_ID));

    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith(
      expect.objectContaining({ archived_at: '2026-09-20T08:00:00.000Z' }),
    );
  });

  it('answers with a row that carries neither body', async () => {
    const supabase = signedIn();
    instapaperAnswers(200, BOOKMARK);

    const response = await POST(send(POST_ID), context(POST_ID));
    const body = (await response.json()) as Record<string, unknown>;

    expect(body).not.toHaveProperty('text');
    expect(body).not.toHaveProperty('html');
    // The stamp's read-back names its columns; compared as columns, since `text_swept_at` and
    // `html_extracted` are columns the list does carry.
    const columns = supabase
      .table('reader_posts')
      .select.mock.calls.map(([list]) => String(list).split(','));
    const stampColumns = columns.at(-1) ?? [];
    expect(stampColumns).not.toContain('text');
    expect(stampColumns).not.toContain('html');
  });

  it.each([
    ['1221 opted out', 400, refusal(1221), 422, 'This publication has opted out of Instapaper'],
    [
      '1220 needs content',
      400,
      refusal(1220),
      422,
      "Instapaper can't fetch this post itself, and its stored text is gone",
    ],
    ['1240 invalid URL', 400, refusal(1240), 422, "Instapaper didn't accept this post's link"],
    [
      '1040 rate limit',
      400,
      refusal(1040),
      429,
      'Instapaper is rate-limiting — try again in a minute',
    ],
    ['HTTP 401', 401, '', 502, "Instapaper rejected alfred's credentials"],
    ['HTTP 403', 403, refusal(1042), 502, "Instapaper rejected alfred's credentials"],
    ['1042 suspended', 400, refusal(1042), 502, "Instapaper rejected alfred's credentials"],
    ['1041 premium', 400, refusal(1041), 502, 'Instapaper says this needs a Premium account'],
    ['a 5xx', 503, 'Service Unavailable', 502, "Instapaper didn't answer — try again"],
    ['a non-JSON body', 200, '<html>oops</html>', 502, "Instapaper didn't answer — try again"],
    ['1246', 400, refusal(1246), 502, "Instapaper didn't answer — try again"],
    ['an unknown code', 400, refusal(1500), 502, "Instapaper didn't answer — try again"],
  ])(
    'answers %s with its own sentence and writes nothing',
    async (_name, upstreamStatus, upstreamBody, status, message) => {
      const supabase = signedIn();
      jest.spyOn(console, 'error').mockImplementation(() => {});
      instapaperAnswers(upstreamStatus, upstreamBody);

      const response = await POST(send(POST_ID), context(POST_ID));

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({ error: message });
      expect(supabase.table('reader_posts').update).not.toHaveBeenCalled();
    },
  );

  it('answers a network failure as Instapaper not answering, and writes nothing', async () => {
    const supabase = signedIn();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    const response = await POST(send(POST_ID), context(POST_ID));

    expect(response.status).toBe(502);
    expect(supabase.table('reader_posts').update).not.toHaveBeenCalled();
  });

  it('maps a failed stamp through the shared error mapper', async () => {
    const supabase = signedIn();
    supabase
      .table('reader_posts')
      .single.mockResolvedValueOnce({ data: null, error: { message: 'write failed' } });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    instapaperAnswers(200, BOOKMARK);

    const response = await POST(send(POST_ID), context(POST_ID));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'write failed' });
  });

  it('sends the stored text as paragraphs when there is no HTML', async () => {
    signedIn({ ...STORED, html: null });
    const fetchSpy = instapaperAnswers(200, BOOKMARK);

    await POST(send(POST_ID), context(POST_ID));

    expect(sentForm(fetchSpy).get('content')).toBe(
      '<p>The post</p>\n<p>Paid paragraph the teaser never shows.</p>',
    );
  });

  it('sends a link-less post with a body as a private bookmark', async () => {
    signedIn({ ...STORED, canonical_url: null });
    const fetchSpy = instapaperAnswers(200, BOOKMARK);

    await POST(send(POST_ID), context(POST_ID));

    const form = sentForm(fetchSpy);
    expect(form.has('url')).toBe(false);
    expect(form.get('is_private_from_source')).toBe('email');
  });

  it('logs no credential, no Authorization header and no post content — on any path', async () => {
    const logged: unknown[][] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args);
      });
    }

    // A refusal, a dead upstream and a success, then a failed stamp: every branch that might log.
    for (const [status, body] of [
      [400, refusal(1221)],
      [503, 'down'],
      [200, BOOKMARK],
    ] as const) {
      signedIn();
      instapaperAnswers(status, body);
      await POST(send(POST_ID), context(POST_ID));
    }
    const failingStamp = signedIn();
    failingStamp
      .table('reader_posts')
      .single.mockResolvedValueOnce({ data: null, error: { message: 'write failed' } });
    instapaperAnswers(200, BOOKMARK);
    await POST(send(POST_ID), context(POST_ID));

    expect(logged.length).toBeGreaterThan(0);
    const everything = JSON.stringify(logged.map((args) => args.map(String)));
    const serialised = JSON.stringify(logged);
    for (const secret of [
      ...Object.values(CREDENTIALS).filter((value) => value !== CREDENTIALS.INSTAPAPER_API_URL),
      'OAuth ',
      'oauth_signature',
      HTML,
      'Paid paragraph',
      "Instapaper's own words",
    ]) {
      expect(everything).not.toContain(secret);
      expect(serialised).not.toContain(secret);
    }
  });
});
