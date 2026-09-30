/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {
  type MockResult,
  makeChain,
  makeSignedOutDouble,
  makeSupabaseDouble,
} from '@/lib/api/supabase-route-double';
import { pinClock } from '@/lib/pin-clock';
import {
  makeFurtherReading,
  makeReaderOverview,
  makeReaderPost,
  makeReaderPublication,
} from '@/lib/reader/fixtures';
import { createClient } from '@/lib/supabase/server';
import type { ReaderPostListItem } from '@/lib/types';

import { POST } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

pinClock('2026-09-30T12:00:00.000Z');

const PUBLICATION = makeReaderPublication('Gridwork');
const POST_ID = '22222222-2222-4222-8222-222222222222';
const ITEMS = makeFurtherReading();
const [PAPER, ESSAY, RELEASE, REPLY] = ITEMS.map((item) => item.url) as [
  string,
  string,
  string,
  string,
];

const TO_READER_FOLDER_ID = 5_550_001;
const FOLDERS = [
  { type: 'folder', folder_id: 5_550_000, title: 'To Wiki' },
  { type: 'folder', folder_id: TO_READER_FOLDER_ID, title: 'To Reader' },
];

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

interface Sent {
  reader?: string[];
  instapaper?: string[];
}

/** The post's list row, with its sent marks as given. */
function listRow({ reader = [], instapaper = [] }: Sent = {}): ReaderPostListItem {
  const {
    text: _text,
    html: _html,
    ...row
  } = makeReaderPost(PUBLICATION.id, {
    id: POST_ID,
    summary_state: 'done',
    overview: makeReaderOverview({ further_reading: ITEMS }),
    further_sent_reader: reader,
    further_sent_instapaper: instapaper,
  });
  return row;
}

/** What the route's read hands back: the overview and both sent lists. */
function stored(
  sent: Sent = {},
  overview: unknown = makeReaderOverview({ further_reading: ITEMS }),
) {
  return {
    overview,
    further_sent_reader: sent.reader ?? [],
    further_sent_instapaper: sent.instapaper ?? [],
  };
}

/** A signed-in client: the read answers `row`; the append RPC answers `appended`. */
function signedIn(row: unknown = stored(), appended?: MockResult) {
  const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: row } } });
  supabase.rpc.mockReturnValue(makeChain({ single: appended ?? { data: listRow() } }));
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

/** What Instapaper answers each call with, by path; `add` is a queue, one answer per save. */
interface InstapaperWorld {
  folders?: Response;
  add?: (Response | Error)[];
}

function bookmark(id: number): Response {
  return Response.json([{ type: 'bookmark', bookmark_id: id }]);
}

function instapaperError(code: number, status = 400): Response {
  return Response.json([{ type: 'error', error_code: code, message: 'internal' }], { status });
}

/** Stub Instapaper's two endpoints. Every call is recorded with its path and form body. */
function stubInstapaper(world: InstapaperWorld = {}) {
  const queue = [...(world.add ?? [])];
  return jest.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/api/1.1/folders/list')) {
      return Promise.resolve(world.folders ?? Response.json(FOLDERS));
    }
    if (url.endsWith('/api/1/bookmarks/add')) {
      const next = queue.shift() ?? bookmark(1);
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    }
    void init;
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
}

function calls(
  spy: jest.SpiedFunction<typeof fetch>,
): { path: string; form: Record<string, string> }[] {
  return spy.mock.calls.map(([input, init]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return {
      path: new URL(url).pathname,
      form: Object.fromEntries(
        new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
      ),
    };
  });
}

function send(id: string, body: unknown): Request {
  return new Request(`http://localhost/api/reader/posts/${id}/further-reading`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

async function detail(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error;
}

/** A client whose first read is the send's and whose second is the unchanged list row. */
function readsTwice(first: unknown, second: unknown) {
  const supabase = makeSupabaseDouble({});
  supabase
    .table('reader_posts')
    .maybeSingle.mockResolvedValueOnce({ data: first, error: null })
    .mockResolvedValueOnce({ data: second, error: null });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  configure(true);
});

afterAll(() => {
  process.env = originalEnvironment;
});

describe('POST /api/reader/posts/[id]/further-reading — all saved', () => {
  it('saves each link into the To Reader folder for a send to the Reader, and marks them', async () => {
    const marked = listRow({ reader: [PAPER, RELEASE] });
    const supabase = signedIn(stored(), { data: marked });
    const fetchSpy = stubInstapaper({ add: [bookmark(11), bookmark(12)] });

    const response = await POST(
      send(POST_ID, { destination: 'reader', urls: [PAPER, RELEASE] }),
      context(POST_ID),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ post: marked, unsent: [] });
    // Folders first, then one save per link, in order: by URL, the model's title and note.
    expect(calls(fetchSpy)).toEqual([
      { path: '/api/1.1/folders/list', form: {} },
      {
        path: '/api/1/bookmarks/add',
        form: {
          url: PAPER,
          title: ITEMS[0]?.title,
          description: ITEMS[0]?.note,
          folder_id: String(TO_READER_FOLDER_ID),
        },
      },
      {
        path: '/api/1/bookmarks/add',
        form: {
          url: RELEASE,
          title: ITEMS[2]?.title,
          description: ITEMS[2]?.note,
          folder_id: String(TO_READER_FOLDER_ID),
        },
      },
    ]);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('append_further_reading_sent', {
      p_post: POST_ID,
      p_destination: 'reader',
      p_urls: [PAPER, RELEASE],
    });
  });

  it('saves to Unread for a send to Instapaper — no folder, and no folder listing', async () => {
    const supabase = signedIn(stored(), { data: listRow({ instapaper: [ESSAY] }) });
    const fetchSpy = stubInstapaper();

    const response = await POST(
      send(POST_ID, { destination: 'instapaper', urls: [ESSAY] }),
      context(POST_ID),
    );

    expect(response.status).toBe(200);
    expect(calls(fetchSpy)).toEqual([
      {
        path: '/api/1/bookmarks/add',
        form: { url: ESSAY, title: ITEMS[1]?.title, description: ITEMS[1]?.note },
      },
    ]);
    expect(supabase.rpc).toHaveBeenCalledWith('append_further_reading_sent', {
      p_post: POST_ID,
      p_destination: 'instapaper',
      p_urls: [ESSAY],
    });
  });
});

describe('POST /api/reader/posts/[id]/further-reading — some saved', () => {
  it('marks only the confirmed saves and answers the rest as unsent, with what stopped them', async () => {
    const marked = listRow({ reader: [PAPER] });
    const supabase = signedIn(stored(), { data: marked });
    stubInstapaper({ add: [bookmark(11), new Error('socket hang up')] });

    const response = await POST(
      send(POST_ID, { destination: 'reader', urls: [PAPER, ESSAY] }),
      context(POST_ID),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      post: marked,
      unsent: [ESSAY],
      failure: "Instapaper didn't answer",
    });
    expect(supabase.rpc).toHaveBeenCalledWith('append_further_reading_sent', {
      p_post: POST_ID,
      p_destination: 'reader',
      p_urls: [PAPER],
    });
  });

  it('names the first failure when several links fail', async () => {
    signedIn(stored(), { data: listRow({ instapaper: [PAPER] }) });
    stubInstapaper({ add: [bookmark(11), instapaperError(1040), instapaperError(1240)] });

    const response = await POST(
      send(POST_ID, { destination: 'instapaper', urls: [PAPER, ESSAY, RELEASE] }),
      context(POST_ID),
    );

    expect(await response.json()).toMatchObject({
      unsent: [ESSAY, RELEASE],
      failure: 'Instapaper is rate-limiting',
    });
  });

  it('stops starting saves once 20 seconds have gone by, and answers the rest as unsent', async () => {
    signedIn(stored(), { data: listRow({ instapaper: [PAPER] }) });
    let elapsed = 0;
    jest.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(() => {
      // Each save takes 15 s — the per-call timeout's worth.
      elapsed += 15_000;
      return Promise.resolve(bookmark(11));
    });

    const response = await POST(
      send(POST_ID, { destination: 'instapaper', urls: [PAPER, ESSAY, RELEASE] }),
      context(POST_ID),
    );

    // Two started (at 0 s and 15 s); the third would start at 30 s, past the window.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(await response.json()).toMatchObject({
      unsent: [RELEASE],
      failure: 'Instapaper was too slow',
    });
  });
});

describe('POST /api/reader/posts/[id]/further-reading — none saved', () => {
  it.each([
    ['no answer', new Error('timeout'), 502, "Instapaper didn't answer — try again"],
    [
      'a rate limit',
      instapaperError(1040),
      429,
      'Instapaper is rate-limiting — try again in a minute',
    ],
    [
      'a rejected credential',
      new Response('Unauthorized', { status: 401 }),
      502,
      "Instapaper rejected alfred's credentials",
    ],
  ])(
    'answers %s with its mapped status and sentence, and marks nothing',
    async (_label, answer, status, sentence) => {
      const supabase = signedIn();
      stubInstapaper({ add: [answer, answer] });

      const response = await POST(
        send(POST_ID, { destination: 'instapaper', urls: [PAPER, ESSAY] }),
        context(POST_ID),
      );

      expect(response.status).toBe(status);
      expect(await detail(response)).toBe(sentence);
      expect(supabase.rpc).not.toHaveBeenCalled();
    },
  );

  it('answers a failed folder listing with its mapped status, and saves nothing', async () => {
    const supabase = signedIn();
    const fetchSpy = stubInstapaper({ folders: new Response('Unauthorized', { status: 401 }) });

    const response = await POST(
      send(POST_ID, { destination: 'reader', urls: [PAPER] }),
      context(POST_ID),
    );

    expect(response.status).toBe(502);
    expect(await detail(response)).toBe("Instapaper rejected alfred's credentials");
    expect(calls(fetchSpy).map((call) => call.path)).toEqual(['/api/1.1/folders/list']);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe('POST /api/reader/posts/[id]/further-reading — no To Reader folder', () => {
  it('answers 409 in the owner’s words, and saves and marks nothing', async () => {
    const supabase = signedIn();
    const fetchSpy = stubInstapaper({
      folders: Response.json([{ type: 'folder', folder_id: 1, title: 'To Wiki' }]),
    });

    const response = await POST(
      send(POST_ID, { destination: 'reader', urls: [PAPER] }),
      context(POST_ID),
    );

    expect(response.status).toBe(409);
    expect(await detail(response)).toBe('There is no “To Reader” folder in Instapaper');
    expect(calls(fetchSpy).map((call) => call.path)).toEqual(['/api/1.1/folders/list']);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe('POST /api/reader/posts/[id]/further-reading — nothing left to send', () => {
  it('answers the row unchanged when every link is already sent, to either place', async () => {
    const row = listRow({ reader: [PAPER], instapaper: [ESSAY] });
    const supabase = readsTwice(stored({ reader: [PAPER], instapaper: [ESSAY] }), row);
    const fetchSpy = stubInstapaper();

    const response = await POST(
      send(POST_ID, { destination: 'instapaper', urls: [PAPER, ESSAY] }),
      context(POST_ID),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ post: row, unsent: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('drops a link a re-summarise took out of the list, and never saves it', async () => {
    const row = listRow();
    readsTwice(stored(), row);
    const fetchSpy = stubInstapaper();

    const response = await POST(
      send(POST_ID, { destination: 'reader', urls: ['https://example.com/gone'] }),
      context(POST_ID),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ post: row, unsent: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('saves only the links still offered and not yet sent, each once', async () => {
    const supabase = signedIn(stored({ instapaper: [ESSAY] }), { data: listRow() });
    const fetchSpy = stubInstapaper();

    await POST(
      send(POST_ID, {
        destination: 'instapaper',
        urls: [ESSAY, REPLY, 'https://example.com/gone', REPLY],
      }),
      context(POST_ID),
    );

    expect(calls(fetchSpy).map((call) => call.form['url'])).toEqual([REPLY]);
    expect(supabase.rpc).toHaveBeenCalledWith('append_further_reading_sent', {
      p_post: POST_ID,
      p_destination: 'instapaper',
      p_urls: [REPLY],
    });
  });

  it('offers nothing from a post whose overview has no list (summarised before it existed)', async () => {
    readsTwice(stored({}, makeReaderOverview()), listRow());
    const fetchSpy = stubInstapaper();

    const response = await POST(
      send(POST_ID, { destination: 'reader', urls: [PAPER] }),
      context(POST_ID),
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('POST /api/reader/posts/[id]/further-reading — refusals', () => {
  it('501s on a deployment without Instapaper, before reading anything', async () => {
    configure(false);
    const supabase = signedIn();
    const fetchSpy = stubInstapaper();

    const response = await POST(
      send(POST_ID, { destination: 'reader', urls: [PAPER] }),
      context(POST_ID),
    );

    expect(response.status).toBe(501);
    expect(supabase.from).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown destination', { destination: 'wiki', urls: [PAPER] }],
    ['no links', { destination: 'reader', urls: [] }],
    [
      'more than ten links',
      {
        destination: 'reader',
        urls: Array.from({ length: 11 }, (_, i) => `https://example.com/${String(i)}`),
      },
    ],
    ['a link that is not a web URL', { destination: 'reader', urls: ['javascript:alert(1)'] }],
    ['an extra key', { destination: 'reader', urls: [PAPER], folder: 'To Wiki' }],
  ])('400s on %s', async (_label, body) => {
    signedIn();
    const fetchSpy = stubInstapaper();

    const response = await POST(send(POST_ID, body), context(POST_ID));

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('404s when the post is not there', async () => {
    signedIn(null);
    stubInstapaper();

    const response = await POST(
      send(POST_ID, { destination: 'reader', urls: [PAPER] }),
      context(POST_ID),
    );

    expect(response.status).toBe(404);
  });

  it('400s on a malformed id', async () => {
    signedIn();

    const response = await POST(
      send('not-a-uuid', { destination: 'reader', urls: [PAPER] }),
      context('not-a-uuid'),
    );

    expect(response.status).toBe(400);
  });

  it('401s when signed out', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await POST(
      send(POST_ID, { destination: 'reader', urls: [PAPER] }),
      context(POST_ID),
    );

    expect(response.status).toBe(401);
  });

  it('500s, saying the links went, when the marks cannot be recorded after the saves', async () => {
    signedIn(stored(), { data: null, error: { message: 'boom', code: 'XX000' } });
    stubInstapaper();
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(
      send(POST_ID, { destination: 'instapaper', urls: [PAPER] }),
      context(POST_ID),
    );

    expect(response.status).toBe(500);
    expect(await detail(response)).toBe("Saved to Instapaper, but couldn't mark the links as sent");
  });
});
