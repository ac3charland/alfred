/** @jest-environment node */
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
const SAVED_ROW = makeReaderPost(PUBLICATION.id, { id: POST_ID });

/** What the send's read sees: a post with a link, a gist and both bodies. */
const STORED: ReaderPostForSend = {
  title: 'How near is the intelligence explosion, really?',
  canonical_url: 'https://open.substack.com/pub/secondthoughts/p/how-near',
  gist: 'A gist.',
  html: '<p>SECRET-BODY-MARKUP</p>',
  text: 'SECRET-BODY-TEXT',
  archived_at: null,
};

const CREDENTIALS = {
  INSTAPAPER_CONSUMER_KEY: 'consumer-key-value',
  INSTAPAPER_CONSUMER_SECRET: 'consumer-secret-value',
  INSTAPAPER_ACCESS_TOKEN: 'access-token-value',
  INSTAPAPER_ACCESS_TOKEN_SECRET: 'access-token-secret-value',
  INSTAPAPER_API_URL: 'https://instapaper.test',
};

const originalEnvironment = { ...process.env };
const originalFetch = globalThis.fetch;
const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();

function configure(configured = true): void {
  process.env = { ...originalEnvironment };
  for (const [key, value] of Object.entries(CREDENTIALS)) {
    if (configured) process.env[key] = value;
    else Reflect.deleteProperty(process.env, key);
  }
}

/** The read answers `stored`, then the write answers `written` — both through `.maybeSingle()`. */
function signedIn(
  stored: ReaderPostForSend | null = STORED,
  written?: { data: unknown; error?: { message: string } },
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({ reader_posts: {} });
  supabase
    .table('reader_posts')
    .maybeSingle.mockResolvedValueOnce({ data: stored, error: null })
    .mockResolvedValueOnce(written ?? { data: SAVED_ROW });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function instapaperAnswers(body: string, status = 200): void {
  fetchMock.mockResolvedValue(new Response(body, { status }));
}

function send(id = POST_ID): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/reader/posts/${id}/instapaper`, { method: 'POST' }),
    {
      params: Promise.resolve({ id }),
    },
  );
}

beforeEach(() => {
  configure();
  // The failure cases log by design; the log's contents are asserted in their own test.
  jest.spyOn(console, 'warn').mockReturnValue(undefined);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  process.env = { ...originalEnvironment };
  globalThis.fetch = originalFetch;
});

describe('POST /api/reader/posts/[id]/instapaper', () => {
  it('saves the post, then stamps the send and archives it', async () => {
    const supabase = signedIn();
    instapaperAnswers('[{"type":"bookmark","bookmark_id":987654}]');

    const response = await send();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(SAVED_ROW);
    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith({
      instapaper_sent_at: '2026-09-24T12:00:00.000Z',
      instapaper_bookmark_id: 987_654,
      archived_at: '2026-09-24T12:00:00.000Z',
    });
  });

  it('sends the link, title, gist and email HTML, signed, to bookmarks/add', async () => {
    signedIn();
    instapaperAnswers('[{"type":"bookmark","bookmark_id":1}]');

    await send();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://instapaper.test/api/1/bookmarks/add');
    const body = new URLSearchParams(init?.body as string);
    expect(Object.fromEntries(body)).toEqual({
      url: STORED.canonical_url,
      title: STORED.title,
      description: STORED.gist,
      content: STORED.html,
    });
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toMatch(/^OAuth /);
    expect(headers['Authorization']).toContain('oauth_consumer_key="consumer-key-value"');
  });

  it('keeps an already-archived post’s archived_at', async () => {
    const supabase = signedIn({ ...STORED, archived_at: '2026-09-20T08:00:00.000Z' });
    instapaperAnswers('[{"type":"bookmark","bookmark_id":5}]');

    await send();

    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith(
      expect.objectContaining({ archived_at: '2026-09-20T08:00:00.000Z' }),
    );
  });

  it('answers with the list row — neither body comes back', async () => {
    const supabase = signedIn();
    instapaperAnswers('[{"type":"bookmark","bookmark_id":5}]');

    await send();

    const [columns] = supabase.table('reader_posts').select.mock.calls[1] as [string];
    expect(columns.split(',')).not.toContain('text');
    expect(columns.split(',')).not.toContain('html');
  });

  it('501s with no read and no outbound call when the deployment is unconfigured', async () => {
    configure(false);
    const supabase = signedIn();

    const response = await send();

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "Instapaper isn't set up on this deployment",
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('401s with no session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await send();
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('400s on a malformed id', async () => {
    signedIn();
    const response = await send('nope');
    expect(response.status).toBe(400);
  });

  it('404s for a post that is not there, without calling Instapaper', async () => {
    signedIn(null);

    const response = await send();

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('409s when there is nothing to send, without calling Instapaper', async () => {
    signedIn({ ...STORED, canonical_url: null, html: null, text: null });

    const response = await send();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Nothing to send — this post has no link and no stored text',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'opted out',
      400,
      '[{"type":"error","error_code":1221,"message":"x"}]',
      422,
      'This publication has opted out of Instapaper',
    ],
    [
      'rate limit',
      400,
      '[{"type":"error","error_code":1040,"message":"x"}]',
      429,
      'Instapaper is rate-limiting — try again in a minute',
    ],
    ['bad credentials', 401, 'Unauthorized', 502, "Instapaper rejected alfred's credentials"],
    ['an outage', 503, '<html>down</html>', 502, "Instapaper didn't answer — try again"],
  ])(
    'writes nothing on %s, and answers the owner’s sentence',
    async (_label, upstream, body, status, detail) => {
      const supabase = signedIn();
      instapaperAnswers(body, upstream);

      const response = await send();

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({ error: detail });
      expect(supabase.table('reader_posts').update).not.toHaveBeenCalled();
    },
  );

  it('writes nothing on a timeout', async () => {
    const supabase = signedIn();
    fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));

    const response = await send();
    expect(response.status).toBe(502);
    expect(supabase.table('reader_posts').update).not.toHaveBeenCalled();
  });

  it('maps a failed write after a save through the shared error mapper', async () => {
    signedIn(STORED, { data: null, error: { message: 'boom' } });
    instapaperAnswers('[{"type":"bookmark","bookmark_id":5}]');

    const response = await send();

    expect(response.status).toBe(500);
  });

  it('never logs the credentials, the Authorization header or the post’s content', async () => {
    const logged: unknown[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(...args);
      });
    }
    signedIn();
    instapaperAnswers('[{"type":"error","error_code":1221,"message":"Opted out"}]', 400);

    await send();

    const output = JSON.stringify(logged);
    expect(output).toContain(POST_ID);
    expect(output).toContain('1221');
    for (const secret of [
      ...Object.values(CREDENTIALS).slice(0, 4),
      'OAuth ',
      'SECRET-BODY-MARKUP',
      'SECRET-BODY-TEXT',
      'Opted out',
    ]) {
      expect(output).not.toContain(secret);
    }
  });
});
