/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {
  makeChain,
  makeSignedOutDouble,
  makeSupabaseDouble,
} from '@/lib/api/supabase-route-double';
import { SEND_DEADLINE_MS } from '@/lib/instapaper/bookmark';
import { pinClock, setClockNow } from '@/lib/pin-clock';
import { makeReaderOverview, makeReaderPost, makeReaderPublication } from '@/lib/reader/fixtures';
import { createClient } from '@/lib/supabase/server';
import type { ReaderPostListItem } from '@/lib/types';

import { POST } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

pinClock('2026-10-03T12:00:00.000Z');

const PUBLICATION = makeReaderPublication('Second Thoughts');
const POST_ID = '11111111-1111-4111-8111-111111111111';

const A = { url: 'https://example.com/a', title: 'Piece A', note: 'Why A matters.' };
const B = { url: 'https://example.com/b', title: 'Piece B', note: '' };
const C = { url: 'https://example.com/c', title: 'Piece C', note: 'Why C matters.' };

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

/** The row as the list columns read it: no body, the overview offering A, B and C. */
function listRow(overrides: Parameters<typeof makeReaderPost>[1] = {}): ReaderPostListItem {
  const {
    text: _text,
    html: _html,
    ...row
  } = makeReaderPost(PUBLICATION.id, {
    id: POST_ID,
    gmail_message_id: 'gmail-1',
    created_at: '2026-10-03T11:00:00.000Z',
    received_at: '2026-10-03T11:00:00.000Z',
    overview: { ...makeReaderOverview(), further_reading: [A, B, C] },
    ...overrides,
  });
  return row;
}

/** A signed-in client: the read answers `row`, the mark-sent RPC answers `appended`. */
function signedIn(
  row: ReaderPostListItem | null = listRow(),
  appended?: { data: unknown; error?: { message: string } },
) {
  const supabase = makeSupabaseDouble({ reader_posts: { maybeSingle: { data: row } } });
  supabase.rpc.mockReturnValue(
    makeChain({ single: appended ?? { data: listRow({ further_sent_reader: [A.url] }) } }),
  );
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

const FOLDERS = [
  { type: 'folder', folder_id: 5, title: 'Other' },
  { type: 'folder', folder_id: '9', title: 'To Reader' },
];
const SAVED = [{ type: 'bookmark', bookmark_id: 1 }];

type Responder = (path: string, form: Record<string, string>) => Response;

/** Routes each outbound call by its path; records every `bookmarks/add` form. */
function instapaper(respond: Responder) {
  const adds: Record<string, string>[] = [];
  const paths: string[] = [];
  const spy = jest.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const path = new URL(input instanceof Request ? input.url : input.toString()).pathname;
    const form = Object.fromEntries(
      new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
    );
    paths.push(path);
    if (path.endsWith('/bookmarks/add')) adds.push(form);
    return Promise.resolve(respond(path, form));
  });
  return { spy, adds, paths };
}

const happy: Responder = (path) => Response.json(path.endsWith('/folders/list') ? FOLDERS : SAVED);

/** Saves answer in turn: each entry is a response for the next `bookmarks/add`. */
function addsAnswer(...answers: Response[]): Responder {
  const queue = [...answers];
  return (path) =>
    path.endsWith('/folders/list')
      ? Response.json(FOLDERS)
      : (queue.shift() ?? Response.json(SAVED));
}

const failure = (code: number, status = 400) =>
  Response.json([{ type: 'error', error_code: code }], { status });

function send(body: unknown, id: string = POST_ID): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/reader/posts/${id}/further-reading`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
});

describe('POST /api/reader/posts/[id]/further-reading', () => {
  it('401s without a session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);
    const response = await send({ destination: 'reader', urls: [A.url] });
    expect(response.status).toBe(401);
  });

  it('501s when Instapaper is not configured, before reading anything', async () => {
    configure(false);
    const supabase = signedIn();
    const { spy } = instapaper(happy);

    const response = await send({ destination: 'reader', urls: [A.url] });

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: "Instapaper isn't set up on this deployment" });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ['no urls', { destination: 'reader', urls: [] }],
    ['an unknown destination', { destination: 'kindle', urls: [A.url] }],
    ['a non-http link', { destination: 'reader', urls: ['javascript:alert(1)'] }],
  ])('400s for %s', async (_name, body) => {
    signedIn();
    const { spy } = instapaper(happy);

    const response = await send(body);
    expect(response.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('404s for a post that is not there', async () => {
    signedIn(null);
    const { spy } = instapaper(happy);

    const response = await send({ destination: 'reader', urls: [A.url] });
    expect(response.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });

  it('saves every link into To Reader, marks exactly the landed ones once, in overview order', async () => {
    const supabase = signedIn();
    const { adds } = instapaper(happy);

    const response = await send({ destination: 'reader', urls: [C.url, A.url] });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ post: listRow({ further_sent_reader: [A.url] }), unsent: [] });
    expect(adds).toEqual([
      { url: A.url, title: A.title, description: A.note, folder_id: '9' },
      { url: C.url, title: C.title, description: C.note, folder_id: '9' },
    ]);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('append_further_reading_sent', {
      p_post: POST_ID,
      p_destination: 'reader',
      p_urls: [A.url, C.url],
    });
  });

  it('saves to Unread with no folder lookup and no folder_id for the instapaper destination', async () => {
    const supabase = signedIn();
    const { adds, paths } = instapaper(happy);

    const response = await send({ destination: 'instapaper', urls: [B.url] });

    expect(response.status).toBe(200);
    expect(paths).toEqual(['/api/1/bookmarks/add']);
    expect(adds).toEqual([{ url: B.url, title: B.title }]);
    expect(adds[0]).not.toHaveProperty('content');
    expect(supabase.rpc).toHaveBeenCalledWith('append_further_reading_sent', {
      p_post: POST_ID,
      p_destination: 'instapaper',
      p_urls: [B.url],
    });
  });

  it('reports the failed link unsent, with the first failure, and marks only the landed one', async () => {
    const supabase = signedIn();
    instapaper(addsAnswer(Response.json(SAVED), failure(1221)));

    const response = await send({ destination: 'reader', urls: [A.url, B.url] });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body['unsent']).toEqual([B.url]);
    expect(body['failure']).toBe('This publication has opted out of Instapaper');
    expect(supabase.rpc).toHaveBeenCalledWith('append_further_reading_sent', {
      p_post: POST_ID,
      p_destination: 'reader',
      p_urls: [A.url],
    });
  });

  it('answers the first failure’s status and sentence when nothing landed, marking nothing', async () => {
    const supabase = signedIn();
    instapaper(addsAnswer(failure(1040), failure(1221)));

    const response = await send({ destination: 'reader', urls: [A.url, B.url] });

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: 'Instapaper is rate-limiting — try again in a minute',
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('409s when the owner has no To Reader folder, saving and marking nothing', async () => {
    const supabase = signedIn();
    const { adds } = instapaper((path) =>
      Response.json(path.endsWith('/folders/list') ? [FOLDERS[0]] : SAVED),
    );

    const response = await send({ destination: 'reader', urls: [A.url] });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'There is no “To Reader” folder in Instapaper',
    });
    expect(adds).toEqual([]);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('502s with the sentence when the folder list is unavailable', async () => {
    const supabase = signedIn();
    const { adds } = instapaper(() => new Response('<html>', { status: 503 }));

    const response = await send({ destination: 'reader', urls: [A.url] });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Instapaper didn't answer — try again" });
    expect(adds).toEqual([]);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('drops links already sent to either destination or no longer offered, calling nothing', async () => {
    const row = listRow({ further_sent_reader: [A.url], further_sent_instapaper: [B.url] });
    const supabase = signedIn(row);
    const { spy } = instapaper(happy);

    const response = await send({
      destination: 'reader',
      urls: [A.url, B.url, 'https://example.com/gone'],
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ post: row, unsent: [] });
    expect(spy).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('starts no new save past the deadline and reports those links unsent', async () => {
    const supabase = signedIn();
    // The clock jumps past the deadline as the first save goes out.
    const { adds } = instapaper((path) => {
      if (path.endsWith('/bookmarks/add')) {
        setClockNow(new Date(Date.now() + SEND_DEADLINE_MS + 1000).toISOString());
      }
      return happy(path, {});
    });

    const response = await send({ destination: 'instapaper', urls: [A.url, B.url, C.url] });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(adds).toHaveLength(1);
    expect(body['unsent']).toEqual([B.url, C.url]);
    expect(body['failure']).toBe("Instapaper didn't answer — try again");
    expect(supabase.rpc).toHaveBeenCalledWith('append_further_reading_sent', {
      p_post: POST_ID,
      p_destination: 'instapaper',
      p_urls: [A.url],
    });
  });

  it('500s when the marks cannot be recorded after a link landed', async () => {
    signedIn(listRow(), { data: null, error: { message: 'boom' } });
    instapaper(happy);

    const response = await send({ destination: 'instapaper', urls: [A.url] });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Saved to Instapaper, but couldn't mark the links as sent",
    });
  });

  it('logs a partial send without the credentials or the links', async () => {
    signedIn();
    instapaper(addsAnswer(Response.json(SAVED), failure(1221)));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await send({ destination: 'reader', urls: [A.url, B.url] });

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain(POST_ID);
    expect(logged).toContain('1221');
    expect(logged).not.toContain('secret-looking');
    expect(logged).not.toContain('example.com');
  });
});
