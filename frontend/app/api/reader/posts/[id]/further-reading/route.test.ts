/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeChain, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import type { ReaderPostFurtherReadingRow } from '@/lib/data/reader';
import { makeFurtherReading, makeReaderOverview, makeReaderPost } from '@/lib/reader/fixtures';
import { createClient } from '@/lib/supabase/server';

import { POST } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const POST_ID = '11111111-1111-4111-8111-111111111111';
const ITEMS = makeFurtherReading();
const [FIRST, SECOND, THIRD] = ITEMS.map((item) => item.url) as [string, string, string];

const CREDENTIALS = {
  INSTAPAPER_CONSUMER_KEY: 'ck-secret-looking-value',
  INSTAPAPER_CONSUMER_SECRET: 'cs-secret-looking-value',
  INSTAPAPER_ACCESS_TOKEN: 'tk-secret-looking-value',
  INSTAPAPER_ACCESS_TOKEN_SECRET: 'ts-secret-looking-value',
};

const originalEnvironment = { ...process.env };

function configure(configured: boolean): void {
  process.env = Object.fromEntries(
    Object.entries(originalEnvironment).filter(([name]) => !name.startsWith('INSTAPAPER_')),
  ) as NodeJS.ProcessEnv;
  if (configured) Object.assign(process.env, CREDENTIALS);
}

/** The route's pre-read: the overview and both sent lists. */
function stored(overrides: Partial<ReaderPostFurtherReadingRow> = {}): ReaderPostFurtherReadingRow {
  return {
    id: POST_ID,
    overview: makeReaderOverview({ further_reading: ITEMS }) as never,
    further_sent_reader: [],
    further_sent_instapaper: [],
    ...overrides,
  };
}

/** The list row the append (or the unchanged read) hands back. */
function listRow(overrides: Parameters<typeof makeReaderPost>[1] = {}) {
  const {
    text: _text,
    html: _html,
    ...row
  } = makeReaderPost('pub-1', {
    id: POST_ID,
    gmail_message_id: 'gmail-1',
    received_at: '2026-09-24T12:00:00.000Z',
    ...overrides,
  });
  return row;
}

/**
 * A signed-in client: the first `maybeSingle` is the pre-read, a second (only on a send with
 * nothing left) the unchanged list row; the append RPC answers `appended`.
 */
function signedIn(
  pre: ReaderPostFurtherReadingRow | null = stored(),
  appended: unknown = listRow(),
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({});
  supabase
    .table('reader_posts')
    .maybeSingle.mockResolvedValueOnce({ data: pre, error: null })
    .mockResolvedValueOnce({ data: listRow(), error: null });
  supabase.rpc.mockReturnValue(makeChain({ single: { data: appended } }));
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

const FOLDERS = [
  { type: 'folder', folder_id: 10, title: 'Long reads' },
  { type: 'folder', folder_id: 4242, title: 'To Reader' },
];

function bookmark(id: number) {
  return [{ type: 'bookmark', bookmark_id: id }];
}

function error(code: number, status = 400) {
  return Response.json([{ type: 'error', error_code: code, message: 'no' }], { status });
}

/** Instapaper's answers, in call order. */
function instapaper(...answers: (Response | unknown[])[]): jest.SpiedFunction<typeof fetch> {
  const spy = jest.spyOn(globalThis, 'fetch');
  for (const answer of answers) {
    spy.mockResolvedValueOnce(answer instanceof Response ? answer : Response.json(answer));
  }
  return spy;
}

/** A request's path and form body, as the fetch spy recorded it. */
function calls(spy: jest.SpiedFunction<typeof fetch>): [string, Record<string, string>][] {
  return spy.mock.calls.map(([input, init]) => [
    new URL(input as string).pathname,
    Object.fromEntries(new URLSearchParams(typeof init?.body === 'string' ? init.body : '')),
  ]);
}

function send(body: unknown, id: string = POST_ID): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/reader/posts/${id}/further-reading`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  configure(true);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...originalEnvironment };
  jest.restoreAllMocks();
});

describe('POST /api/reader/posts/[id]/further-reading — saving', () => {
  it('saves each link to Unread in turn, then marks them all sent to Instapaper', async () => {
    const appended = listRow({ further_sent_instapaper: [FIRST, SECOND] });
    const supabase = signedIn(stored(), appended);
    const fetchSpy = instapaper(bookmark(1), bookmark(2));

    const response = await send({ destination: 'instapaper', urls: [FIRST, SECOND] });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ post: appended, unsent: [] });
    expect(calls(fetchSpy)).toEqual([
      ['/api/1/bookmarks/add', { url: FIRST, title: ITEMS[0]?.title, description: ITEMS[0]?.note }],
      [
        '/api/1/bookmarks/add',
        { url: SECOND, title: ITEMS[1]?.title, description: ITEMS[1]?.note },
      ],
    ]);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('append_further_reading_sent', {
      p_post: POST_ID,
      p_destination: 'instapaper',
      p_urls: [FIRST, SECOND],
    });
  });

  it('saves a send to the Reader into the “To Reader” folder, found by its exact title', async () => {
    const supabase = signedIn();
    const fetchSpy = instapaper(FOLDERS, bookmark(1));

    const response = await send({ destination: 'reader', urls: [FIRST] });

    expect(response.status).toBe(200);
    expect(calls(fetchSpy)).toEqual([
      ['/api/1.1/folders/list', {}],
      [
        '/api/1/bookmarks/add',
        { url: FIRST, title: ITEMS[0]?.title, description: ITEMS[0]?.note, folder_id: '4242' },
      ],
    ]);
    expect(supabase.rpc).toHaveBeenCalledWith('append_further_reading_sent', {
      p_post: POST_ID,
      p_destination: 'reader',
      p_urls: [FIRST],
    });
  });

  it('marks only what landed, answering 200 with the links that did not go', async () => {
    const supabase = signedIn();
    instapaper(FOLDERS, bookmark(1), error(1500, 503));

    const response = await send({ destination: 'reader', urls: [FIRST, SECOND] });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      post: listRow(),
      unsent: [SECOND],
      failure: "Instapaper didn't answer",
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'append_further_reading_sent',
      expect.objectContaining({ p_urls: [FIRST] }),
    );
  });

  it('answers the first failure’s status and sentence when nothing landed, marking nothing', async () => {
    const supabase = signedIn();
    instapaper(error(1040, 400), error(1500, 503));

    const response = await send({ destination: 'instapaper', urls: [FIRST, SECOND] });

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: 'Instapaper is rate-limiting — try again in a minute',
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('words a refused link as a link, not as the post', async () => {
    signedIn();
    instapaper(error(1240, 400));

    const response = await send({ destination: 'instapaper', urls: [FIRST] });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Instapaper didn't accept that link" });
  });

  it('409s a send to the Reader when there is no “To Reader” folder, saving nothing', async () => {
    const supabase = signedIn();
    const fetchSpy = instapaper([{ type: 'folder', folder_id: 10, title: 'to reader' }]);

    const response = await send({ destination: 'reader', urls: [FIRST] });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'There is no “To Reader” folder in Instapaper',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('answers a failed folder listing the way a failed save is answered', async () => {
    signedIn();
    instapaper(error(1042, 403));

    const response = await send({ destination: 'reader', urls: [FIRST] });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Instapaper rejected alfred's credentials" });
  });

  it('stops starting saves after 20 seconds and reports the rest unsent', async () => {
    signedIn();
    let now = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => now);
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
      now += 12_000;
      return Promise.resolve(Response.json(bookmark(1)));
    });

    const response = await send({ destination: 'instapaper', urls: [FIRST, SECOND, THIRD] });

    // The first save ends at 12 s and the second starts; the second ends at 24 s, past the line.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(await response.json()).toMatchObject({
      unsent: [THIRD],
      failure: "Instapaper didn't answer",
    });
  });
});

describe('POST /api/reader/posts/[id]/further-reading — what may be sent', () => {
  it('sends only links still in the overview, and drops any already sent to either place', async () => {
    const supabase = signedIn(
      stored({ further_sent_reader: [FIRST], further_sent_instapaper: [SECOND] }),
    );
    const fetchSpy = instapaper(bookmark(3));

    const response = await send({
      destination: 'instapaper',
      urls: [FIRST, SECOND, THIRD, 'https://example.com/never-in-the-overview'],
    });

    expect(response.status).toBe(200);
    expect(calls(fetchSpy).map(([, form]) => form['url'])).toEqual([THIRD]);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'append_further_reading_sent',
      expect.objectContaining({ p_urls: [THIRD] }),
    );
  });

  it('sends a repeated link once', async () => {
    signedIn();
    const fetchSpy = instapaper(bookmark(1));

    await send({ destination: 'instapaper', urls: [FIRST, FIRST] });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('answers the row unchanged, calling nobody, when every link is already sent or gone', async () => {
    const supabase = signedIn(stored({ further_sent_reader: [FIRST] }));
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    const response = await send({ destination: 'reader', urls: [FIRST, 'https://example.com/x'] });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ post: listRow(), unsent: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('treats a post with no further reading — a v1 summary — as having nothing to send', async () => {
    signedIn(stored({ overview: makeReaderOverview() as never }));
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    const response = await send({ destination: 'instapaper', urls: [FIRST] });

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('POST /api/reader/posts/[id]/further-reading — refusals', () => {
  it('501s with no credentials, before any read or outbound call', async () => {
    configure(false);
    const supabase = signedIn();
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    const response = await send({ destination: 'reader', urls: [FIRST] });

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: "Instapaper isn't set up on this deployment" });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['no destination', { urls: [FIRST] }],
    ['an unknown destination', { destination: 'wiki', urls: [FIRST] }],
    ['no links', { destination: 'reader', urls: [] }],
    ['a non-http link', { destination: 'reader', urls: ['javascript:alert(1)'] }],
  ])('400s a body with %s', async (_name, body) => {
    signedIn();

    const response = await send(body);

    expect(response.status).toBe(400);
  });

  it('400s a malformed post id', async () => {
    signedIn();

    const response = await send({ destination: 'reader', urls: [FIRST] }, 'not-a-uuid');

    expect(response.status).toBe(400);
  });

  it('404s a post that is not there, without calling Instapaper', async () => {
    signedIn(null);
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    const response = await send({ destination: 'reader', urls: [FIRST] });

    expect(response.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('500s when the links were saved but could not be marked', async () => {
    const supabase = makeSupabaseDouble({});
    supabase
      .table('reader_posts')
      .maybeSingle.mockResolvedValueOnce({ data: stored(), error: null });
    supabase.rpc.mockReturnValue(makeChain({ single: { data: null, error: { message: 'boom' } } }));
    mockCreateClient.mockResolvedValue(supabase as never);
    instapaper(bookmark(1));

    const response = await send({ destination: 'instapaper', urls: [FIRST] });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Saved to Instapaper, but couldn't mark the links as sent",
    });
  });

  it('never logs the credentials', async () => {
    signedIn();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    instapaper(error(1500, 503));

    await send({ destination: 'instapaper', urls: [FIRST] });

    const logged = JSON.stringify(warn.mock.calls);
    for (const secret of Object.values(CREDENTIALS)) expect(logged).not.toContain(secret);
  });
});
