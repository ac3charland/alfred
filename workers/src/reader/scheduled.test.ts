import type { GmailMessage } from '../comms/gmail-api';
import { type FetchInit, type FetchInput, spyOnFetch } from '../fetch-stub';
import { READER_DEFAULT_DAILY_CAP } from './config';
import { ESSAY_MESSAGE, PLAIN_TEXT_ONLY_MESSAGE, READ_IN_APP_MESSAGE } from './fixtures';
import * as retention from './retention';
import { READER_TICK_BUDGET_MS, runReaderRetention, runReaderTick } from './scheduled';
import * as summarize from './summarize';
import type { ReaderEnv, ReaderSummary, SummaryInput, SummaryOutcome } from './types';

const SUPABASE_URL = 'https://proj.supabase.co';
const OAUTH_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GMAIL_PREFIX = 'https://gmail.googleapis.com/gmail/v1/users/me/';

const NOW = new Date('2026-09-18T11:45:00.000Z');
const NOW_ISO = NOW.toISOString();

/** A JSON `null` — how PostgREST spells an absent column. This package bans the literal. */
const WIRE_NULL: unknown = JSON.parse('null');

const env: ReaderEnv = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  GMAIL_OAUTH_CLIENT_ID: 'client-id',
  GMAIL_OAUTH_CLIENT_SECRET: 'client-secret',
  GMAIL_PERSONAL_REFRESH_TOKEN: 'personal-refresh',
  ANTHROPIC_API_KEY: 'sk-test',
  READER_MODEL: 'claude-sonnet-5',
  READER_DAILY_CAP: '30',
};

/**
 * `env` with one binding ABSENT, which is what an unset var actually looks like on a deploy.
 *
 * Spelled as a deletion rather than `{ ...env, KEY: undefined }` because `ReaderEnv` declares its
 * optionals as `key?: string` without `| undefined`, and under `exactOptionalPropertyTypes` the
 * two are different things: the key may be missing, but it may not be present and empty.
 */
function without(
  key: 'READER_MODEL' | 'READER_DAILY_CAP' | 'ANTHROPIC_API_KEY' | 'GMAIL_OAUTH_CLIENT_ID',
): ReaderEnv {
  const entries = Object.entries(env).filter(([name]) => name !== key);
  return Object.fromEntries(entries) as unknown as ReaderEnv;
}

const SUMMARY: ReaderSummary = {
  headline: 'Open port telemetry narrowed the routing spread',
  gist: 'Three ports published berth telemetry and the spread fell from $4.10 to $1.30 a tonne.',
  overview: {
    novel_ideas: ['The second ledger was valuable because it was unwritable'],
    evidence: ['$4.10 → $1.30 a tonne over eighteen months'],
    argument: 'Publishing the feed destroyed an information rent and raised throughput.',
    who_should_read: 'Anyone running a queue with private state.',
  },
};

const DONE: SummaryOutcome = { kind: 'done', summary: SUMMARY };

interface Call {
  url: string;
  method: string;
  body: string | undefined;
}

/** What the fake world holds for one test. */
interface Scenario {
  /** Rows `v_reader_discovery` answers with. */
  discovery?: unknown[];
  /** Rows `reader_publications?select=id,name` answers with. */
  roster?: { id: string; name: string }[];
  /** The `Content-Range` total the ceiling count reads. */
  callsToday?: number;
  /** Rows the pending-retry read answers with. */
  retries?: Record<string, unknown>[];
  /** Rows `v_reader_worklist` answers with. */
  fresh?: Record<string, unknown>[];
  /** Messages `messages.get` can serve, by id. */
  messages?: GmailMessage[];
  /** A status to answer one message read with, instead of the message. */
  messageStatus?: Record<string, number>;
  /** Answer the token exchange with this instead of a fresh access token. */
  oauth?: () => Response;
  /** Rows the post insert reports as stored. An empty array is answered as a 409. */
  inserted?: { id: string }[];
  /** Rows the lease CAS reports as matched. Defaults to one. */
  leased?: number;
  /** A status to answer every `reader_posts` PATCH with, instead of the matched rows. */
  postPatchStatus?: number;
  /** What Instapaper holds, for a tick whose env carries the four Instapaper secrets. */
  instapaper?: InstapaperWorld;
  /** Rows the "already a post?" read answers with, by bookmark id. */
  bookmarked?: Record<string, unknown>[];
}

/** Instapaper, as the To Reader leg sees it. */
interface InstapaperWorld {
  /** The owner's folders. Defaults to one To Reader folder, id 77. */
  folders?: { folder_id: number; title: string }[];
  /** The bookmarks in To Reader, in Instapaper's wire shape. */
  bookmarks?: Record<string, unknown>[];
  /** Each bookmark's text view, by id. A bookmark with none answers error 1550. */
  texts?: Record<number, string>;
  /** A status and body to answer one call with, by path (`folders/list`, `bookmarks/archive`, …). */
  fail?: Record<string, { status: number; body: string }>;
}

const INSTAPAPER_PREFIX = 'https://www.instapaper.com/api/';

/** One worklist row, in the view's shape. */
function worklistRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    comm_message_id: 'comm-essay',
    gmail_message_id: ESSAY_MESSAGE.id,
    account_key: 'gmail-personal',
    publication_id: 'pub-harborline',
    sender_handle: 'harborline@substack.com',
    sender_name: 'Harborline',
    subject: 'The Grain Ledger',
    rfc822_message_id: '<essay-1@mail.harborline.substack.com>',
    received_at: '2026-09-16T11:06:40.000Z',
    ...overrides,
  };
}

/** One pending post, in the retry read's shape. */
function retryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'post-retry',
    publication_id: 'pub-harborline',
    title: 'An earlier post',
    author: 'Mira Vantz',
    canonical_url: 'https://harborline.substack.com/p/earlier',
    received_at: '2026-09-15T11:06:40.000Z',
    text: 'the stored body',
    word_count: 3,
    summarize_attempts: 1,
    ...overrides,
  };
}

/** Route every request by URL and record it. No test in this file reaches the network. */
function harness(scenario: Scenario = {}): Call[] {
  const calls: Call[] = [];

  spyOnFetch().mockImplementation((input: FetchInput, init?: FetchInit) => {
    const url = input as string;
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });

    if (url.startsWith(OAUTH_ENDPOINT)) {
      const respond = scenario.oauth ?? (() => Response.json({ access_token: 'ya29.access' }));
      return Promise.resolve(respond());
    }

    if (url.startsWith(INSTAPAPER_PREFIX)) {
      const world = scenario.instapaper ?? {};
      const path = url.slice(INSTAPAPER_PREFIX.length).replace(/^1(\.1)?\//, '');
      const failure = world.fail?.[path];
      if (failure !== undefined) {
        return Promise.resolve(new Response(failure.body, { status: failure.status }));
      }
      const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
      const bookmarkId = Number(form.get('bookmark_id'));
      switch (path) {
        case 'folders/list': {
          return Promise.resolve(
            Response.json(world.folders ?? [{ type: 'folder', folder_id: 77, title: 'To Reader' }]),
          );
        }
        case 'bookmarks/list': {
          return Promise.resolve(
            Response.json({ bookmarks: world.bookmarks ?? [], highlights: [] }),
          );
        }
        case 'bookmarks/get_text': {
          const html = world.texts?.[bookmarkId];
          return Promise.resolve(
            html === undefined
              ? Response.json([{ type: 'error', error_code: 1550 }], { status: 400 })
              : new Response(html, { headers: { 'Content-Type': 'text/html' } }),
          );
        }
        default: {
          return Promise.resolve(Response.json([{ type: 'bookmark', bookmark_id: bookmarkId }]));
        }
      }
    }

    if (url.startsWith(GMAIL_PREFIX)) {
      const id = new URL(url).pathname.slice('/gmail/v1/users/me/messages/'.length);
      const status = scenario.messageStatus?.[id];
      if (status !== undefined) return Promise.resolve(new Response('gmail said no', { status }));
      const found = (scenario.messages ?? []).find((message) => message.id === id);
      return Promise.resolve(
        found === undefined ? new Response('not found', { status: 404 }) : Response.json(found),
      );
    }

    if (url.includes('v_reader_discovery'))
      return Promise.resolve(Response.json(scenario.discovery ?? []));
    if (url.includes('reader_publications')) {
      return Promise.resolve(
        Response.json(method === 'GET' ? (scenario.roster ?? []) : [{ id: 'pub-new' }]),
      );
    }
    if (url.includes('v_reader_worklist'))
      return Promise.resolve(Response.json(scenario.fresh ?? []));
    if (url.includes('reader_health')) return Promise.resolve(Response.json([{ id: 1 }]));
    if (url.includes('comm_messages'))
      return Promise.resolve(Response.json([{ id: 'comm-essay' }]));

    if (url.includes('reader_posts')) {
      if (method === 'POST') {
        const rows = scenario.inserted ?? [{ id: 'post-new' }];
        return Promise.resolve(
          rows.length === 0 ? new Response('duplicate key', { status: 409 }) : Response.json(rows),
        );
      }
      if (method === 'PATCH') {
        if (scenario.postPatchStatus !== undefined)
          return Promise.resolve(
            new Response('postgrest said no', { status: scenario.postPatchStatus }),
          );
        const matched = url.includes('summary_state=eq.pending') ? (scenario.leased ?? 1) : 1;
        return Promise.resolve(
          Response.json(Array.from({ length: matched }, () => ({ id: 'row' }))),
        );
      }
      if (url.includes('instapaper_bookmark_id=in.')) {
        return Promise.resolve(Response.json(scenario.bookmarked ?? []));
      }
      // The retry read and the ceiling count are both GETs on the same table; the filter is what
      // tells them apart, exactly as it does on the wire.
      if (url.includes('summary_state=eq.pending')) {
        return Promise.resolve(Response.json(scenario.retries ?? []));
      }
      // The ceiling count: a body nobody reads and a header that carries the total.
      return Promise.resolve(
        new Response('[]', {
          headers: { 'Content-Range': `0-0/${String(scenario.callsToday ?? 0)}` },
        }),
      );
    }

    return Promise.resolve(Response.json([]));
  });

  return calls;
}

/** Every recorded call to one PostgREST table, optionally narrowed to one method. */
function restCalls(calls: Call[], table: string, method?: string): Call[] {
  return calls.filter(
    (call) =>
      call.url.startsWith(`${SUPABASE_URL}/rest/v1/${table}`) &&
      (method === undefined || call.method === method),
  );
}

/** A recorded call's JSON body. */
function payload(call: Call | undefined): Record<string, unknown> {
  return JSON.parse(call?.body ?? '{}') as Record<string, unknown>;
}

/** Where in the recorded call list a predicate first matched, or -1. */
function indexOfCall(calls: Call[], matches: (call: Call) => boolean): number {
  return calls.findIndex((call) => matches(call));
}

/** The `SummaryInput` each recorded model call was handed, typed rather than `any`. */
function summarizedInputs(spy: jest.SpyInstance): SummaryInput[] {
  return (spy.mock.calls as [SummaryInput, unknown][]).map(([input]) => input);
}

/** Just the titles, in call order — what "retries first" actually looks like. */
function summarizedTitles(spy: jest.SpyInstance): string[] {
  return summarizedInputs(spy).map((input) => input.title);
}

/** Mock the summariser seam. The tick meets it at one signature and nothing else. */
function mockSummarize(...outcomes: SummaryOutcome[]): jest.SpyInstance {
  const spy = jest.spyOn(summarize, 'summarizePost');
  for (const outcome of outcomes) spy.mockResolvedValueOnce(outcome);
  if (outcomes.length === 0) spy.mockResolvedValue(DONE);
  else spy.mockResolvedValue(outcomes.at(-1) ?? DONE);
  return spy;
}

describe('runReaderTick — failing closed', () => {
  it('records a health error and touches nothing when a var is unusable', async () => {
    // The ceiling is the money guard, and the one failure it must not have is an unparsable value
    // silently becoming "unlimited".
    const calls = harness();
    const summarized = mockSummarize();

    const summary = await runReaderTick({ ...env, READER_DAILY_CAP: 'lots' }, NOW);

    expect(summary.failures).toEqual([expect.stringContaining('READER_DAILY_CAP')]);
    expect(summarized).not.toHaveBeenCalled();
    expect(calls.filter((call) => !call.url.includes('reader_health'))).toEqual([]);
    // No ceiling columns: the cap is exactly what could not be read, so the tick has nothing
    // true to say about it.
    expect(payload(restCalls(calls, 'reader_health')[0])).toEqual({
      last_error: expect.stringContaining('READER_DAILY_CAP') as unknown,
      last_error_at: NOW_ISO,
    });
  });

  it('refuses to run without a model, before anything reaches Gmail', async () => {
    const calls = harness();
    const summary = await runReaderTick(without('READER_MODEL'), NOW);

    expect(summary.failures).toEqual(['READER_MODEL is not set']);
    expect(calls.filter((call) => call.url.startsWith(GMAIL_PREFIX))).toEqual([]);
  });

  it('treats a missing model key as systemic, like the classifier does', async () => {
    harness();
    const summarized = mockSummarize();

    const summary = await runReaderTick(without('ANTHROPIC_API_KEY'), NOW);

    expect(summary.failures).toEqual(['ANTHROPIC_API_KEY is not set']);
    expect(summarized).not.toHaveBeenCalled();
  });

  it('names a missing Gmail binding before spending a read on it', async () => {
    // The check is fail-closed, and `env` already says the answer — so it runs ahead of
    // discovery, the roster, the ceiling and the worklist rather than after four wasted fetches.
    const calls = harness();

    const summary = await runReaderTick(without('GMAIL_OAUTH_CLIENT_ID'), NOW);

    expect(summary.failures).toEqual(['GMAIL_OAUTH_CLIENT_ID is not set']);
    expect(calls.filter((call) => !call.url.includes('reader_health'))).toEqual([]);
    expect(payload(restCalls(calls, 'reader_health').at(-1))).toMatchObject({
      last_error: 'GMAIL_OAUTH_CLIENT_ID is not set',
    });
  });

  it('defaults the ceiling when the var is absent rather than running uncapped', async () => {
    harness({
      callsToday: READER_DEFAULT_DAILY_CAP,
      fresh: [worklistRow()],
      messages: [ESSAY_MESSAGE],
    });
    const summarized = mockSummarize();

    const summary = await runReaderTick(without('READER_DAILY_CAP'), NOW);

    expect(summarized).not.toHaveBeenCalled();
    expect(summary.skippedForCap).toBe(1);
  });
});

describe('runReaderTick — ordering', () => {
  it('stamps the run, discovers, and stamps success on a clean empty pass', async () => {
    const calls = harness();
    const summary = await runReaderTick(env, NOW);

    const health = restCalls(calls, 'reader_health');
    // The run-start write carries the whole ceiling: the count is read BEFORE the stamp, so
    // `last_run_at` never moves to today while the row still holds yesterday's count.
    expect(payload(health[0])).toEqual({
      last_run_at: NOW_ISO,
      daily_cap: 30,
      calls_today: 0,
      calls_day: '2026-09-18',
    });
    expect(payload(health[1])).toEqual({
      last_success_at: NOW_ISO,
      daily_cap: 30,
      calls_today: 0,
      calls_day: '2026-09-18',
    });
    expect(summary.failures).toEqual([]);
  });

  it('counts the day before it stamps the run, so the two never disagree', async () => {
    const calls = harness({ callsToday: 7 });

    await runReaderTick(env, NOW);

    const count = indexOfCall(
      calls,
      (call) => call.method === 'GET' && call.url.includes('model_called_at=gte'),
    );
    const start = indexOfCall(calls, (call) => 'last_run_at' in payload(call));
    expect(count).toBeGreaterThanOrEqual(0);
    expect(count).toBeLessThan(start);
  });

  it('puts retries ahead of fresh posts, so a post is never starved by a busy morning', async () => {
    harness({
      retries: [retryRow()],
      fresh: [worklistRow()],
      messages: [ESSAY_MESSAGE],
      roster: [{ id: 'pub-harborline', name: 'Harborline' }],
    });
    const summarized = mockSummarize(DONE, DONE);

    await runReaderTick(env, NOW);

    expect(summarizedTitles(summarized)).toEqual([
      'An earlier post',
      'Harborline\u2019s Grain Ledger \u{1F91D} the berth telemetry',
    ]);
  });

  it('falls back to a retry’s author, never to the post’s own title, for the publication', async () => {
    // A publication whose roster row has gone (renamed handle, deleted publication) must not be
    // announced to the model as the post's own title — the eval script calls that case 'unknown'.
    harness({
      retries: [
        retryRow(),
        retryRow({ id: 'post-retry-2', title: 'A later post', author: WIRE_NULL }),
      ],
      roster: [],
    });
    const summarized = mockSummarize(DONE, DONE);

    await runReaderTick(env, NOW);

    expect(summarizedInputs(summarized).map((input) => input.publication)).toEqual([
      'Mira Vantz',
      'unknown',
    ]);
  });

  it('inserts the post and stamps the comms row BEFORE the model is called', async () => {
    // Title and link are the floor. A tick that dies leaves a pending row the next tick picks
    // up, never a half-written summary — and an unclaimed message is another Gmail read forever.
    const calls = harness({ fresh: [worklistRow()], messages: [ESSAY_MESSAGE] });
    const summarized = mockSummarize(DONE);

    await runReaderTick(env, NOW);

    const insert = indexOfCall(
      calls,
      (call) => call.url.includes('reader_posts') && call.method === 'POST',
    );
    const stamp = indexOfCall(calls, (call) => call.url.includes('comm_messages'));
    const patch = indexOfCall(
      calls,
      (call) => call.url.includes('reader_posts') && call.method === 'PATCH',
    );

    expect(insert).toBeGreaterThanOrEqual(0);
    expect(stamp).toBeGreaterThan(insert);
    expect(patch).toBeGreaterThan(stamp);
    expect(summarized).toHaveBeenCalledTimes(1);
  });

  it('leases a fresh row with the insert itself', async () => {
    const calls = harness({ fresh: [worklistRow()], messages: [ESSAY_MESSAGE] });
    mockSummarize(DONE);

    await runReaderTick(env, NOW);

    expect(payload(restCalls(calls, 'reader_posts', 'POST')[0])).toMatchObject({
      summary_state: 'pending',
      summarizing_since: NOW_ISO,
    });
  });
});

describe('runReaderTick — the mailbox', () => {
  it('ends the tick with nothing advanced on a Gmail transport failure', async () => {
    // No row written, no health error, no success stamp: an outage is not a broken module, and a
    // module that keeps stamping success through one would read as healthy forever.
    const calls = harness({
      fresh: [
        worklistRow(),
        worklistRow({ comm_message_id: 'comm-2', gmail_message_id: 'gmail-2' }),
      ],
      messageStatus: { [ESSAY_MESSAGE.id]: 503 },
    });
    const summarized = mockSummarize();

    const summary = await runReaderTick(env, NOW);

    expect(summary.failures).toHaveLength(1);
    expect(summary.intake).toBe(0);
    expect(summarized).not.toHaveBeenCalled();
    expect(restCalls(calls, 'reader_posts', 'POST')).toEqual([]);
    const health = restCalls(calls, 'reader_health');
    expect(health).toHaveLength(1);
    expect(payload(health[0])).toEqual({
      last_run_at: NOW_ISO,
      daily_cap: 30,
      calls_today: 0,
      calls_day: '2026-09-18',
    });
  });

  it('claims and inserts nothing for a message Gmail has lost', async () => {
    // A 404 is detected on the STATUS, before the rejected/transport split — gmail-api files it
    // under transport, and transport would end the whole tick for a message never coming back.
    const calls = harness({
      fresh: [worklistRow()],
      messageStatus: { [ESSAY_MESSAGE.id]: 404 },
    });

    const summary = await runReaderTick(env, NOW);

    expect(restCalls(calls, 'reader_posts', 'POST')).toEqual([]);
    expect(payload(restCalls(calls, 'comm_messages')[0])).toEqual({ reader_claimed_at: NOW_ISO });
    expect(summary.failures).toEqual([]);
    expect(summary.intake).toBe(0);
  });

  it.each(['TRASH', 'SPAM'])(
    'claims and inserts nothing for a %s-labelled message',
    async (label) => {
      // Gmail keeps serving a binned message; only a hard delete 404s. Putting mail the owner threw
      // away into their reading list is the one outcome that must not happen.
      const calls = harness({
        fresh: [worklistRow()],
        messages: [{ ...ESSAY_MESSAGE, labelIds: ['INBOX', label] }],
      });

      const summary = await runReaderTick(env, NOW);

      expect(restCalls(calls, 'reader_posts', 'POST')).toEqual([]);
      expect(restCalls(calls, 'comm_messages')).toHaveLength(1);
      expect(summary.intake).toBe(0);
    },
  );

  it('treats a rejected Gmail credential as systemic', async () => {
    const calls = harness({
      fresh: [worklistRow()],
      messageStatus: { [ESSAY_MESSAGE.id]: 403 },
    });

    const summary = await runReaderTick(env, NOW);

    expect(summary.failures).toEqual([expect.stringContaining('gmail')]);
    expect(payload(restCalls(calls, 'reader_health').at(-1))).toMatchObject({
      last_error: expect.stringContaining('gmail') as unknown,
    });
  });

  it('ends the tick with no health error when the token exchange has a bad minute', async () => {
    const calls = harness({
      fresh: [worklistRow()],
      oauth: () => new Response('backend error', { status: 503 }),
    });

    const summary = await runReaderTick(env, NOW);

    expect(summary.failures).toHaveLength(1);
    expect(restCalls(calls, 'reader_health')).toHaveLength(1);
  });

  it('stamps a health error when the refresh token is finished', async () => {
    const calls = harness({
      fresh: [worklistRow()],
      oauth: () => new Response('{"error":"invalid_grant"}', { status: 400 }),
    });

    await runReaderTick(env, NOW);

    expect(restCalls(calls, 'reader_health')).toHaveLength(2);
    expect(payload(restCalls(calls, 'reader_health')[1])).toHaveProperty('last_error');
  });
});

describe('runReaderTick — the insert', () => {
  it('still stamps the comms row and then skips when another tick owns the post', async () => {
    const calls = harness({ fresh: [worklistRow()], messages: [ESSAY_MESSAGE], inserted: [] });
    const summarized = mockSummarize();

    const summary = await runReaderTick(env, NOW);

    expect(restCalls(calls, 'comm_messages')).toHaveLength(1);
    expect(summarized).not.toHaveBeenCalled();
    expect(summary.intake).toBe(0);
  });

  it('files a post with no readable body as failed, without a model call', async () => {
    const emptyBody: GmailMessage = {
      ...ESSAY_MESSAGE,
      payload: { mimeType: 'multipart/mixed', headers: ESSAY_MESSAGE.payload?.headers, parts: [] },
    };
    const calls = harness({ fresh: [worklistRow()], messages: [emptyBody] });
    const summarized = mockSummarize();

    const summary = await runReaderTick(env, NOW);

    expect(summarized).not.toHaveBeenCalled();
    expect(payload(restCalls(calls, 'reader_posts', 'PATCH')[0])).toEqual({
      summary_state: 'failed',
      last_error: 'no readable body',
      summarizing_since: WIRE_NULL,
    });
    expect(summary.intake).toBe(1);
  });
});

describe('runReaderTick — the ceiling', () => {
  it('summarises exactly one more post at 29 calls of 30, and leaves the next unleased', async () => {
    const calls = harness({
      callsToday: 29,
      fresh: [
        worklistRow(),
        worklistRow({ comm_message_id: 'comm-2', gmail_message_id: PLAIN_TEXT_ONLY_MESSAGE.id }),
      ],
      messages: [ESSAY_MESSAGE, PLAIN_TEXT_ONLY_MESSAGE],
    });
    const summarized = mockSummarize(DONE, DONE);

    const summary = await runReaderTick(env, NOW);

    expect(summarized).toHaveBeenCalledTimes(1);
    expect(summary.summarized).toBe(1);
    expect(summary.skippedForCap).toBe(1);

    const inserts = restCalls(calls, 'reader_posts', 'POST');
    expect(payload(inserts[0])).toMatchObject({ summarizing_since: NOW_ISO });
    // The second row waits, unleased, for tomorrow — claiming a row this tick will not summarise
    // would strand it until the staleness bound released it.
    expect(payload(inserts[1])).toMatchObject({
      summary_state: 'pending',
      summarizing_since: WIRE_NULL,
    });
  });

  it('leaves the second retry unleased when the ceiling falls between the two', async () => {
    // Claiming a row this tick will not summarise strands it until the staleness bound releases
    // it — so the cap is checked BEFORE the lease, not after.
    const calls = harness({
      callsToday: 29,
      retries: [retryRow(), retryRow({ id: 'post-retry-2', title: 'A later post' })],
    });
    const summarized = mockSummarize(DONE, DONE);

    const summary = await runReaderTick(env, NOW);

    expect(summarizedTitles(summarized)).toEqual(['An earlier post']);
    // Exactly the first row's two writes: its lease CAS and its terminal patch.
    const patches = restCalls(calls, 'reader_posts', 'PATCH');
    expect(patches).toHaveLength(2);
    expect(patches.some((call) => call.url.includes('post-retry-2'))).toBe(false);
    expect(summary.skippedForCap).toBe(1);
  });

  it('does not even send the retry read on a capped day', async () => {
    const calls = harness({ callsToday: 30, fresh: [worklistRow()], messages: [ESSAY_MESSAGE] });
    const summarized = mockSummarize();

    const summary = await runReaderTick(env, NOW);

    // The retry list exists only to feed model calls, and on a capped day there are none to feed.
    expect(
      restCalls(calls, 'reader_posts', 'GET').filter((call) =>
        call.url.includes('summary_state=eq.pending'),
      ),
    ).toEqual([]);
    expect(summarized).not.toHaveBeenCalled();
    expect(summary.skippedForCap).toBe(1);
  });

  it('still inserts fresh rows on a capped day, unleased', async () => {
    // Intake still runs: the row is the floor whether or not it is read today.
    const calls = harness({ callsToday: 30, fresh: [worklistRow()], messages: [ESSAY_MESSAGE] });
    mockSummarize();

    await runReaderTick(env, NOW);

    expect(payload(restCalls(calls, 'reader_posts', 'POST')[0])).toMatchObject({
      summarizing_since: WIRE_NULL,
    });
  });

  it('counts the ceiling over model_called_at from UTC midnight', async () => {
    const calls = harness({ callsToday: 3 });

    await runReaderTick(env, NOW);

    const count = restCalls(calls, 'reader_posts', 'GET')[0];
    expect(decodeURIComponent(count?.url ?? '')).toContain(
      'model_called_at=gte.2026-09-18T00:00:00.000Z',
    );
  });
});

describe('runReaderTick — the budget', () => {
  it('stops starting posts once eight minutes have gone by', async () => {
    const calls = harness({
      fresh: [
        worklistRow(),
        worklistRow({ comm_message_id: 'comm-2', gmail_message_id: PLAIN_TEXT_ONLY_MESSAGE.id }),
      ],
      messages: [ESSAY_MESSAGE, PLAIN_TEXT_ONLY_MESSAGE],
    });
    const summarized = mockSummarize(DONE, DONE);

    // Time only moves between items: the first is inside the budget, the second is not.
    let reading = 0;
    const ticks = [0, 0, READER_TICK_BUDGET_MS + 1];
    const summary = await runReaderTick(
      env,
      NOW,
      () => ticks[reading++] ?? READER_TICK_BUDGET_MS + 1,
    );

    expect(summarized).toHaveBeenCalledTimes(1);
    expect(summary.skippedForBudget).toBe(1);
    // Rows the budget stops are simply still pending next tick — the second was never inserted.
    expect(restCalls(calls, 'reader_posts', 'POST')).toHaveLength(1);
  });
});

describe('runReaderTick — the terminal patch', () => {
  const freshOnly: Scenario = { fresh: [worklistRow()], messages: [ESSAY_MESSAGE] };

  it('writes the whole summary, the provenance and the released lease on done', async () => {
    const calls = harness(freshOnly);
    mockSummarize(DONE);

    const summary = await runReaderTick(env, NOW);

    expect(payload(restCalls(calls, 'reader_posts', 'PATCH')[0])).toEqual({
      headline: SUMMARY.headline,
      gist: SUMMARY.gist,
      overview: SUMMARY.overview,
      model: 'claude-sonnet-5',
      prompt_version: 1,
      summary_state: 'done',
      summarized_at: NOW_ISO,
      model_called_at: NOW_ISO,
      last_error: WIRE_NULL,
      summarizing_since: WIRE_NULL,
    });
    expect(summary.summarized).toBe(1);
  });

  it('files a refusal as terminal, uncounted, carrying the explanation into last_error', async () => {
    const calls = harness(freshOnly);
    mockSummarize({
      kind: 'refused',
      explanation: 'This post walks through exploit chains in operational detail.',
    });

    const summary = await runReaderTick(env, NOW);

    expect(payload(restCalls(calls, 'reader_posts', 'PATCH')[0])).toEqual({
      summary_state: 'refused',
      last_error: 'This post walks through exploit chains in operational detail.',
      model_called_at: NOW_ISO,
      summarizing_since: WIRE_NULL,
    });
    expect(summary.refused).toBe(1);
    expect(summary.countedFailures).toBe(0);
  });

  it('nulls out last_error on a refusal with no explanation, rather than leaving a stale one', async () => {
    const calls = harness(freshOnly);
    mockSummarize({ kind: 'refused' });

    const summary = await runReaderTick(env, NOW);

    expect(payload(restCalls(calls, 'reader_posts', 'PATCH')[0])).toEqual({
      summary_state: 'refused',
      last_error: WIRE_NULL,
      model_called_at: NOW_ISO,
      summarizing_since: WIRE_NULL,
    });
    expect(summary.refused).toBe(1);
    expect(summary.countedFailures).toBe(0);
  });

  it('compare-and-sets the attempt count on a content-shaped failure', async () => {
    const calls = harness({ retries: [retryRow({ summarize_attempts: 1 })] });
    mockSummarize({ kind: 'counted', error: 'max_tokens' });

    const summary = await runReaderTick(env, NOW);

    const patch = restCalls(calls, 'reader_posts', 'PATCH').at(-1);
    expect(decodeURIComponent(patch?.url ?? '')).toContain('summarize_attempts=eq.1');
    expect(payload(patch)).toEqual({
      summarize_attempts: 2,
      last_error: 'max_tokens',
      model_called_at: NOW_ISO,
      summarizing_since: WIRE_NULL,
    });
    expect(summary.countedFailures).toBe(1);
  });

  it('files a post as failed when the third counted failure lands', async () => {
    const calls = harness({ retries: [retryRow({ summarize_attempts: 2 })] });
    mockSummarize({ kind: 'counted', error: 'schema' });

    await runReaderTick(env, NOW);

    expect(payload(restCalls(calls, 'reader_posts', 'PATCH').at(-1))).toMatchObject({
      summarize_attempts: 3,
      summary_state: 'failed',
    });
  });

  it('leaves an uncounted failure pending, with its attempt count untouched', async () => {
    // A 429 or a 5xx is the moment being wrong, not the post. `model_called_at` is stamped anyway:
    // a timeout may well have been billed, and the ceiling exists to bound money.
    const calls = harness(freshOnly);
    mockSummarize({ kind: 'uncounted', error: '429 rate limited' });

    const summary = await runReaderTick(env, NOW);

    expect(payload(restCalls(calls, 'reader_posts', 'PATCH')[0])).toEqual({
      last_error: '429 rate limited',
      model_called_at: NOW_ISO,
      summarizing_since: WIRE_NULL,
    });
    expect(summary.uncountedFailures).toBe(1);
    expect(summary.failures).toEqual([]);
  });

  it('releases the lease, records the health error and stops on a systemic outcome', async () => {
    const calls = harness({
      fresh: [
        worklistRow(),
        worklistRow({ comm_message_id: 'comm-2', gmail_message_id: PLAIN_TEXT_ONLY_MESSAGE.id }),
      ],
      messages: [ESSAY_MESSAGE, PLAIN_TEXT_ONLY_MESSAGE],
    });
    const summarized = mockSummarize({
      kind: 'systemic',
      reason: 'credentials',
      error: '401 invalid x-api-key',
    });

    const summary = await runReaderTick(env, NOW);

    expect(summarized).toHaveBeenCalledTimes(1);
    expect(payload(restCalls(calls, 'reader_posts', 'PATCH')[0])).toEqual({
      summarizing_since: WIRE_NULL,
    });

    const health = restCalls(calls, 'reader_health');
    expect(payload(health.at(-1))).toMatchObject({
      last_error: expect.stringContaining('401') as unknown,
    });
    // No success stamp: an outage that kept stamping one would read as healthy forever.
    expect(health.some((call) => 'last_success_at' in payload(call))).toBe(false);
    expect(summary.failures).toHaveLength(1);
  });

  it('skips a retry whose lease another tick already holds', async () => {
    const calls = harness({ retries: [retryRow()], leased: 0 });
    const summarized = mockSummarize();

    const summary = await runReaderTick(env, NOW);

    expect(summarized).not.toHaveBeenCalled();
    expect(restCalls(calls, 'reader_posts', 'PATCH')).toHaveLength(1);
    expect(summary.summarized).toBe(0);
  });
});

describe('runReaderTick — a write that fails outright', () => {
  it('records the throw on the health row instead of escaping the scheduled handler', async () => {
    // Every store helper throws on a non-2xx. Nothing below this catch would log the throw or
    // stamp the health row, and the runtime would simply record a failed invocation.
    const calls = harness({
      fresh: [worklistRow()],
      messages: [ESSAY_MESSAGE],
      postPatchStatus: 500,
    });
    mockSummarize(DONE);

    const summary = await runReaderTick(env, NOW);

    expect(summary.failures).toEqual([expect.stringContaining('PATCH reader_posts')]);
    const health = restCalls(calls, 'reader_health');
    expect(payload(health.at(-1))).toMatchObject({
      last_error: expect.stringContaining('PATCH reader_posts') as unknown,
    });
    // The tick did not get through, so it does not read as healthy.
    expect(health.some((call) => 'last_success_at' in payload(call))).toBe(false);
  });

  it('keeps the counts the tick had already earned', async () => {
    const calls = harness({
      fresh: [worklistRow()],
      messages: [ESSAY_MESSAGE],
      postPatchStatus: 500,
    });
    mockSummarize(DONE);

    const summary = await runReaderTick(env, NOW);

    expect(summary.intake).toBe(1);
    expect(restCalls(calls, 'reader_posts', 'POST')).toHaveLength(1);
  });

  it('stamps the spend the throw happened after, not the one the day started with', async () => {
    // The money already spent is what a failed run most needs to report: a count dropped here
    // reads, until the next clean tick, as a day that spent nothing.
    const calls = harness({
      callsToday: 4,
      fresh: [worklistRow()],
      messages: [ESSAY_MESSAGE],
      postPatchStatus: 500,
    });
    mockSummarize(DONE);

    await runReaderTick(env, NOW);

    expect(payload(restCalls(calls, 'reader_health').at(-1))).toMatchObject({
      daily_cap: 30,
      calls_today: 5,
      calls_day: '2026-09-18',
    });
  });

  it('stamps the cap alone when the throw beat the count', async () => {
    // The ceiling count is the tick's first fetch; a throw on it leaves nothing to report but
    // the cap, and a guessed count would be worse than none.
    const calls: Call[] = [];
    spyOnFetch().mockImplementation((input: FetchInput, init?: FetchInit) => {
      const url = input as string;
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return Promise.resolve(
        url.includes('reader_health')
          ? Response.json([{ id: 1 }])
          : new Response('postgrest said no', { status: 500 }),
      );
    });

    const summary = await runReaderTick(env, NOW);

    expect(summary.failures).toEqual([expect.stringContaining('COUNT reader_posts')]);
    const health = restCalls(calls, 'reader_health');
    expect(health).toHaveLength(1);
    expect(payload(health[0])).toEqual({
      last_error: expect.stringContaining('COUNT reader_posts') as unknown,
      last_error_at: NOW_ISO,
      daily_cap: 30,
    });
  });
});

describe('runReaderTick — one whole tick over the fixtures', () => {
  it('upserts the essay’s sender, stores three posts, claims three rows and summarises all three', async () => {
    const calls = harness({
      discovery: [
        {
          handle: 'harborline@substack.com',
          name: 'Harborline',
          first_seen_at: '2026-09-12T00:00:00.000Z',
          message_count: 3,
        },
        // Platform mail satisfies every signal discovery leans on and is still not a publication.
        {
          handle: 'no-reply@substack.com',
          name: 'Substack',
          first_seen_at: '2026-09-12T00:00:00.000Z',
          message_count: 9,
        },
      ],
      roster: [
        { id: 'pub-harborline', name: 'Harborline' },
        { id: 'pub-cadence', name: 'The Cadence Weekly' },
        { id: 'pub-tallowfield', name: 'Tallowfield' },
      ],
      fresh: [
        worklistRow(),
        worklistRow({
          comm_message_id: 'comm-roundup',
          gmail_message_id: READ_IN_APP_MESSAGE.id,
          publication_id: 'pub-cadence',
          sender_handle: 'cadence@substack.com',
        }),
        worklistRow({
          comm_message_id: 'comm-plain',
          gmail_message_id: PLAIN_TEXT_ONLY_MESSAGE.id,
          publication_id: 'pub-tallowfield',
          sender_handle: 'tallowfield@substack.com',
        }),
      ],
      messages: [ESSAY_MESSAGE, READ_IN_APP_MESSAGE, PLAIN_TEXT_ONLY_MESSAGE],
    });
    const summarized = mockSummarize(DONE, DONE, DONE);

    const summary = await runReaderTick(env, NOW);

    const upsert = restCalls(calls, 'reader_publications', 'POST')[0];
    expect(JSON.parse(upsert?.body ?? '[]')).toEqual([
      expect.objectContaining({ handle: 'harborline@substack.com', source: 'auto' }),
    ]);

    const inserts = restCalls(calls, 'reader_posts', 'POST').map((call) => payload(call));
    expect(inserts).toHaveLength(3);
    expect(inserts[2]).toMatchObject({
      html_extracted: false,
      title: 'Notes from the third week',
    });
    // No HTML produced the plain post's body, so the insert carries none and the column stays null.
    expect(inserts[2]).not.toHaveProperty('html');
    expect(inserts[0]).toMatchObject({
      html_extracted: true,
      canonical_url: 'https://open.substack.com/pub/harborline/p/the-grain-ledger',
    });
    // The email HTML rides on the insert the tick already makes — same fetch, larger body.
    expect(inserts[0]?.['html']).toEqual(expect.stringContaining('Every port keeps two sets'));

    // The subrequest arithmetic in `READER_TICK_LIMIT`'s doc comment, minus the model calls
    // (`summarizePost` is mocked above): nine per tick, plus the Gmail read, the insert, the
    // comms stamp and the terminal patch per fresh post. Keeping the HTML adds none.
    expect(calls).toHaveLength(9 + 3 * 4);

    expect(restCalls(calls, 'comm_messages')).toHaveLength(3);
    expect(summarized).toHaveBeenCalledTimes(3);
    // The model sees the roster's name for the publication, not the view's sender handle.
    expect(summarizedInputs(summarized)[0]).toMatchObject({ publication: 'Harborline' });

    expect(summary).toEqual({
      discovered: 1,
      intake: 3,
      summarized: 3,
      refused: 0,
      countedFailures: 0,
      uncountedFailures: 0,
      skippedForCap: 0,
      skippedForBudget: 0,
      failures: [],
      // No Instapaper secrets in this env, so the leg says it is off rather than going quiet.
      instapaper: { skipped: 'unconfigured' },
    });
  });
});

describe('runReaderTick — the ceiling stamp', () => {
  it("reports the day's spend as the count it started from plus the calls it made", async () => {
    const calls = harness({
      callsToday: 7,
      fresh: [
        worklistRow(),
        worklistRow({ comm_message_id: 'comm-2', gmail_message_id: PLAIN_TEXT_ONLY_MESSAGE.id }),
      ],
      messages: [ESSAY_MESSAGE, PLAIN_TEXT_ONLY_MESSAGE],
    });
    mockSummarize(DONE, DONE);

    await runReaderTick(env, NOW);

    expect(payload(restCalls(calls, 'reader_health').at(-1))).toEqual({
      last_success_at: NOW_ISO,
      daily_cap: 30,
      calls_today: 9,
      calls_day: '2026-09-18',
    });
  });

  it('stamps the ceiling on the error write too, once the count has been read', async () => {
    const calls = harness({
      callsToday: 4,
      fresh: [worklistRow()],
      messages: [ESSAY_MESSAGE],
    });
    mockSummarize({ kind: 'systemic', reason: 'credentials', error: '401 invalid x-api-key' });

    await runReaderTick(env, NOW);

    expect(payload(restCalls(calls, 'reader_health').at(-1))).toMatchObject({
      last_error: expect.stringContaining('401') as unknown,
      daily_cap: 30,
      calls_today: 5,
      calls_day: '2026-09-18',
    });
  });

  it('stamps the cap alone when a credential fails before the count is read', async () => {
    const calls = harness();

    await runReaderTick(without('ANTHROPIC_API_KEY'), NOW);

    expect(payload(restCalls(calls, 'reader_health')[0])).toEqual({
      last_error: 'ANTHROPIC_API_KEY is not set',
      last_error_at: NOW_ISO,
      daily_cap: 30,
    });
  });

  it('stamps the cap the tick actually enforced, not the default', async () => {
    const calls = harness({ callsToday: 2 });

    await runReaderTick({ ...env, READER_DAILY_CAP: '5' }, NOW);

    expect(payload(restCalls(calls, 'reader_health')[0])).toMatchObject({ daily_cap: 5 });
    expect(payload(restCalls(calls, 'reader_health').at(-1))).toMatchObject({
      daily_cap: 5,
      calls_today: 2,
    });
  });
});

describe('runReaderRetention', () => {
  it('passes the swept count through', async () => {
    jest.spyOn(retention, 'runReaderRetention').mockResolvedValue({ swept: 91 });

    await expect(runReaderRetention(env, NOW)).resolves.toEqual({ swept: 91, failures: [] });
  });

  it('reports a failed sweep rather than taking the invocation down with it', async () => {
    jest.spyOn(retention, 'runReaderRetention').mockRejectedValue(new Error('permission denied'));

    await expect(runReaderRetention(env, NOW)).resolves.toEqual({
      swept: undefined,
      failures: ['reader retention: permission denied'],
    });
  });

  it('keeps the rows committed before the failure, beside the failure', async () => {
    // Each batch is its own transaction: those two posts are swept whatever happened next, and a
    // run that reported "did not run" would be lying about durable work.
    jest
      .spyOn(retention, 'runReaderRetention')
      .mockRejectedValue(new retention.ReaderSweepError('permission denied', 2));

    await expect(runReaderRetention(env, NOW)).resolves.toEqual({
      swept: 2,
      failures: ['reader retention: permission denied'],
    });
  });

  it('still reads as "did not run" when the failure beat the first batch', async () => {
    jest
      .spyOn(retention, 'runReaderRetention')
      .mockRejectedValue(new retention.ReaderSweepError('permission denied', 0));

    await expect(runReaderRetention(env, NOW)).resolves.toEqual({
      swept: undefined,
      failures: ['reader retention: permission denied'],
    });
  });
});

// ── The To Reader leg ────────────────────────────────────────────────────────

/** `env` with the four Instapaper secrets set, which is what turns the leg on. */
const instapaperEnv: ReaderEnv = {
  ...env,
  INSTAPAPER_CONSUMER_KEY: 'ck',
  INSTAPAPER_CONSUMER_SECRET: 'cs',
  INSTAPAPER_ACCESS_TOKEN: 'tk',
  INSTAPAPER_ACCESS_TOKEN_SECRET: 'ts',
};

/** One bookmark in To Reader, in Instapaper's wire shape. */
function bookmarkRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'bookmark',
    bookmark_id: 11,
    url: 'https://www.worksinprogress.co/issue/quiet-cities',
    title: 'Cities Are Getting Quieter',
    time: 1_788_000_000,
    ...overrides,
  };
}

const ARTICLE_HTML =
  '<h1>Cities Are Getting Quieter</h1><p>Street noise fell in six downtowns.</p>';

/** Every recorded call to one Instapaper endpoint, by its path after the API version. */
function instapaperCalls(calls: Call[], path: string): Call[] {
  return calls.filter(
    (call) =>
      call.url.startsWith(INSTAPAPER_PREFIX) &&
      call.url.slice(INSTAPAPER_PREFIX.length).replace(/^1(\.1)?\//, '') === path,
  );
}

/** The bookmark id a recorded Instapaper call carried in its form body. */
function bookmarkIdOf(call: Call): number {
  return Number(new URLSearchParams(call.body ?? '').get('bookmark_id'));
}

/** Every `reader_health` write's body, in order. */
function healthWrites(calls: Call[]): Record<string, unknown>[] {
  return restCalls(calls, 'reader_health', 'PATCH').map((call) => payload(call));
}

/** The one `reader_health` write that carries the To Reader leg's columns, if any does. */
function legColumns(calls: Call[]): Record<string, unknown>[] {
  return healthWrites(calls)
    .map((body) =>
      Object.fromEntries(Object.entries(body).filter(([key]) => key.startsWith('instapaper_'))),
    )
    .filter((columns) => Object.keys(columns).length > 0);
}

describe('runReaderTick — the To Reader leg, off', () => {
  it('makes no Instapaper call, stamps nothing and says it is off without the secrets', async () => {
    const calls = harness({ instapaper: { bookmarks: [bookmarkRow()] } });
    mockSummarize();

    const summary = await runReaderTick(env, NOW);

    expect(calls.filter((call) => call.url.startsWith(INSTAPAPER_PREFIX))).toEqual([]);
    expect(legColumns(calls)).toEqual([]);
    expect(summary.instapaper).toEqual({ skipped: 'unconfigured' });
  });

  it('is off when any one of the four secrets is blank', async () => {
    const calls = harness({ instapaper: { bookmarks: [bookmarkRow()] } });
    mockSummarize();

    const summary = await runReaderTick({ ...instapaperEnv, INSTAPAPER_ACCESS_TOKEN: ' ' }, NOW);

    expect(calls.filter((call) => call.url.startsWith(INSTAPAPER_PREFIX))).toEqual([]);
    expect(summary.instapaper).toEqual({ skipped: 'unconfigured' });
  });
});

describe('runReaderTick — the To Reader leg, listing', () => {
  it('lists an empty folder, reads no posts for it, and stamps the leg’s success', async () => {
    const calls = harness({ instapaper: { bookmarks: [] } });
    mockSummarize();

    const summary = await runReaderTick(instapaperEnv, NOW);

    expect(instapaperCalls(calls, 'folders/list')).toHaveLength(1);
    expect(
      new URLSearchParams(instapaperCalls(calls, 'bookmarks/list')[0]?.body ?? '').get('folder_id'),
    ).toBe('77');
    expect(calls.filter((call) => call.url.includes('instapaper_bookmark_id=in.'))).toEqual([]);
    expect(summary.instapaper).toEqual({
      listed: 0,
      taken: 0,
      archived: 0,
      restored: 0,
      failures: [],
    });
    // The leg's success rides the tick's own closing write — no extra fetch.
    const closing = healthWrites(calls).at(-1);
    expect(closing).toMatchObject({
      last_success_at: NOW_ISO,
      instapaper_last_success_at: NOW_ISO,
    });
    expect(restCalls(calls, 'reader_health', 'PATCH')).toHaveLength(2);
  });

  it('never lists on a capped day, so nothing leaves To Reader', async () => {
    const calls = harness({ callsToday: 30, instapaper: { bookmarks: [bookmarkRow()] } });
    const summarized = mockSummarize();

    const summary = await runReaderTick(instapaperEnv, NOW);

    expect(calls.filter((call) => call.url.startsWith(INSTAPAPER_PREFIX))).toEqual([]);
    expect(summarized).not.toHaveBeenCalled();
    expect(summary.instapaper).toEqual({ skipped: 'capped' });
    expect(legColumns(calls)).toEqual([]);
  });

  it('never lists when newsletters and retries fill every slot', async () => {
    const fresh = Array.from({ length: 6 }, (_, index) =>
      worklistRow({
        comm_message_id: `comm-${String(index)}`,
        gmail_message_id: `gone-${String(index)}`,
      }),
    );
    const calls = harness({ fresh, instapaper: { bookmarks: [bookmarkRow()] } });
    mockSummarize();

    const summary = await runReaderTick(instapaperEnv, NOW);

    expect(calls.filter((call) => call.url.startsWith(INSTAPAPER_PREFIX))).toEqual([]);
    expect(summary.instapaper).toEqual({ skipped: 'no free slot' });
  });

  it('takes only the slots the newsletters left, oldest bookmark first', async () => {
    const fresh = Array.from({ length: 4 }, (_, index) =>
      worklistRow({
        comm_message_id: `comm-${String(index)}`,
        gmail_message_id: `gone-${String(index)}`,
      }),
    );
    const calls = harness({
      fresh,
      instapaper: {
        bookmarks: [
          bookmarkRow({ bookmark_id: 13, time: 300 }),
          bookmarkRow({ bookmark_id: 11, time: 100 }),
          bookmarkRow({ bookmark_id: 12, time: 200 }),
        ],
        texts: { 11: ARTICLE_HTML, 12: ARTICLE_HTML, 13: ARTICLE_HTML },
      },
    });
    mockSummarize();

    const summary = await runReaderTick(instapaperEnv, NOW);

    // Six slots, four newsletters: two bookmarks, and the two oldest.
    expect(instapaperCalls(calls, 'bookmarks/get_text').map((call) => bookmarkIdOf(call))).toEqual([
      11, 12,
    ]);
    const read = calls.find((call) => call.url.includes('instapaper_bookmark_id=in.'));
    expect(decodeURIComponent(read?.url ?? '')).toContain('instapaper_bookmark_id=in.(11,12)');
    expect(summary.instapaper).toMatchObject({ listed: 3, taken: 2, archived: 2 });
  });

  it('stamps a missing folder in the owner’s words and never creates one', async () => {
    const calls = harness({ instapaper: { folders: [{ folder_id: 5, title: 'To Wiki' }] } });
    mockSummarize();

    const summary = await runReaderTick(instapaperEnv, NOW);

    expect(instapaperCalls(calls, 'bookmarks/list')).toEqual([]);
    expect(calls.filter((call) => call.url.startsWith(INSTAPAPER_PREFIX))).toHaveLength(1);
    expect(legColumns(calls)).toEqual([
      {
        instapaper_last_error: 'there is no “To Reader” folder in Instapaper',
        instapaper_last_error_at: NOW_ISO,
      },
    ]);
    expect(summary.failures).toEqual([]);
    expect(summary.instapaper).toMatchObject({
      failures: ['there is no “To Reader” folder in Instapaper'],
    });
  });

  it('stops only the leg on a refused credential: the newsletter is still summarised', async () => {
    const calls = harness({
      fresh: [worklistRow()],
      messages: [ESSAY_MESSAGE],
      instapaper: { fail: { 'folders/list': { status: 401, body: 'Unauthorized' } } },
    });
    const summarized = mockSummarize(DONE);

    const summary = await runReaderTick(instapaperEnv, NOW);

    expect(summarized).toHaveBeenCalledTimes(1);
    expect(summary.summarized).toBe(1);
    // Instapaper's failure is never the summariser's: last_success_at is still stamped, and
    // last_error is not touched.
    expect(summary.failures).toEqual([]);
    const closing = healthWrites(calls).at(-1);
    expect(closing).toEqual({
      last_success_at: NOW_ISO,
      daily_cap: 30,
      calls_today: 1,
      calls_day: '2026-09-18',
      instapaper_last_error: "Instapaper rejected alfred's credentials",
      instapaper_last_error_at: NOW_ISO,
    });
    expect(summary.instapaper).toEqual({
      listed: 0,
      taken: 0,
      archived: 0,
      restored: 0,
      failures: ['folders/list: credentials'],
    });
  });
});

describe('runReaderTick — the To Reader leg, one bookmark', () => {
  it('inserts the article, archives the bookmark, then summarises it with its site as publication', async () => {
    const calls = harness({
      instapaper: { bookmarks: [bookmarkRow()], texts: { 11: ARTICLE_HTML } },
    });
    const summarized = mockSummarize(DONE);

    const summary = await runReaderTick(instapaperEnv, NOW);

    const inserts = restCalls(calls, 'reader_posts', 'POST');
    expect(inserts).toHaveLength(1);
    expect(payload(inserts[0])).toEqual({
      source: 'instapaper',
      instapaper_bookmark_id: 11,
      title: 'Cities Are Getting Quieter',
      canonical_url: 'https://www.worksinprogress.co/issue/quiet-cities',
      site: 'worksinprogress.co',
      // Dated when alfred took it, not when it was saved: the list sorts on this.
      received_at: NOW_ISO,
      text: 'Cities Are Getting Quieter\nStreet noise fell in six downtowns.',
      word_count: 10,
      html_extracted: true,
      summary_state: 'pending',
      summarizing_since: NOW_ISO,
    });

    // The order is the design: the post is the floor, the archive follows it, the model is last.
    const insertAt = indexOfCall(
      calls,
      (call) => call.method === 'POST' && call.url.includes('reader_posts'),
    );
    const archiveAt = indexOfCall(calls, (call) => call.url.endsWith('/bookmarks/archive'));
    const patchAt = indexOfCall(
      calls,
      (call) => call.method === 'PATCH' && call.url.includes('reader_posts'),
    );
    expect(insertAt).toBeGreaterThan(-1);
    expect(archiveAt).toBeGreaterThan(insertAt);
    expect(patchAt).toBeGreaterThan(archiveAt);
    expect(bookmarkIdOf(instapaperCalls(calls, 'bookmarks/archive')[0] ?? ({} as Call))).toBe(11);

    expect(summarizedInputs(summarized)).toEqual([
      {
        publication: 'worksinprogress.co',
        title: 'Cities Are Getting Quieter',
        receivedAt: NOW_ISO,
        wordCount: 10,
        text: 'Cities Are Getting Quieter\nStreet noise fell in six downtowns.',
      },
    ]);
    // The same terminal patch a newsletter gets, `model_called_at` included — which is what makes
    // an article count against the daily ceiling.
    expect(payload(restCalls(calls, 'reader_posts', 'PATCH')[0])).toMatchObject({
      summary_state: 'done',
      prompt_version: 1,
      model_called_at: NOW_ISO,
    });
    expect(summary).toMatchObject({ intake: 0, summarized: 1 });
    expect(summary.instapaper).toEqual({
      listed: 1,
      taken: 1,
      archived: 1,
      restored: 0,
      failures: [],
    });
    expect(healthWrites(calls).at(-1)).toMatchObject({ instapaper_last_success_at: NOW_ISO });
  });

  it('files a bookmark Instapaper has no text for (1550) as failed, with no model call, and archives it', async () => {
    const calls = harness({ instapaper: { bookmarks: [bookmarkRow({ url: '', title: '' })] } });
    const summarized = mockSummarize();

    const summary = await runReaderTick(instapaperEnv, NOW);

    expect(payload(restCalls(calls, 'reader_posts', 'POST')[0])).toEqual({
      source: 'instapaper',
      instapaper_bookmark_id: 11,
      title: 'Untitled',
      received_at: NOW_ISO,
      text: '',
      word_count: 0,
      html_extracted: false,
      summary_state: 'failed',
      last_error: 'no readable body',
    });
    expect(instapaperCalls(calls, 'bookmarks/archive')).toHaveLength(1);
    expect(summarized).not.toHaveBeenCalled();
    expect(summary.instapaper).toMatchObject({ taken: 1, archived: 1, failures: [] });
  });

  it('moves on when another tick inserted the article first, leaving the archive to the winner', async () => {
    const calls = harness({
      inserted: [],
      instapaper: { bookmarks: [bookmarkRow()], texts: { 11: ARTICLE_HTML } },
    });
    const summarized = mockSummarize();

    const summary = await runReaderTick(instapaperEnv, NOW);

    expect(instapaperCalls(calls, 'bookmarks/archive')).toEqual([]);
    expect(summarized).not.toHaveBeenCalled();
    expect(summary.instapaper).toMatchObject({ taken: 0, archived: 0 });
  });

  it('writes nothing and stops the leg when get_text fails, stamping the error', async () => {
    const calls = harness({
      instapaper: {
        bookmarks: [bookmarkRow(), bookmarkRow({ bookmark_id: 12, time: 1_789_000_000 })],
        texts: { 12: ARTICLE_HTML },
        fail: { 'bookmarks/get_text': { status: 503, body: 'down' } },
      },
    });
    const summarized = mockSummarize();

    const summary = await runReaderTick(instapaperEnv, NOW);

    expect(instapaperCalls(calls, 'bookmarks/get_text')).toHaveLength(1);
    expect(restCalls(calls, 'reader_posts', 'POST')).toEqual([]);
    expect(instapaperCalls(calls, 'bookmarks/archive')).toEqual([]);
    expect(summarized).not.toHaveBeenCalled();
    expect(legColumns(calls)).toEqual([
      { instapaper_last_error: "Instapaper didn't answer", instapaper_last_error_at: NOW_ISO },
    ]);
    expect(summary.instapaper).toMatchObject({
      failures: ['bookmark 11: bookmarks/get_text: unavailable (HTTP 503)'],
    });
  });
});

describe('runReaderTick — the To Reader leg, a failed archive', () => {
  it('keeps and summarises the post, stamps the error, and carries on with the next bookmark', async () => {
    const calls = harness({
      instapaper: {
        bookmarks: [bookmarkRow(), bookmarkRow({ bookmark_id: 12, time: 1_789_000_000 })],
        texts: { 11: ARTICLE_HTML, 12: ARTICLE_HTML },
        fail: { 'bookmarks/archive': { status: 500, body: 'oops' } },
      },
    });
    const summarized = mockSummarize(DONE, DONE);

    const summary = await runReaderTick(instapaperEnv, NOW);

    expect(restCalls(calls, 'reader_posts', 'POST')).toHaveLength(2);
    expect(summarized).toHaveBeenCalledTimes(2);
    expect(legColumns(calls)).toEqual([
      { instapaper_last_error: "Instapaper didn't answer", instapaper_last_error_at: NOW_ISO },
    ]);
    expect(summary.instapaper).toMatchObject({ taken: 2, archived: 0 });
  });

  it('stops the later bookmarks when the archive’s refusal is Instapaper’s standing answer', async () => {
    const calls = harness({
      instapaper: {
        bookmarks: [bookmarkRow(), bookmarkRow({ bookmark_id: 12, time: 1_789_000_000 })],
        texts: { 11: ARTICLE_HTML, 12: ARTICLE_HTML },
        fail: {
          'bookmarks/archive': { status: 400, body: '[{"type":"error","error_code":1040}]' },
        },
      },
    });
    const summarized = mockSummarize(DONE);

    const summary = await runReaderTick(instapaperEnv, NOW);

    // The first post is stored and still summarised; the second bookmark is never touched.
    expect(summarized).toHaveBeenCalledTimes(1);
    expect(instapaperCalls(calls, 'bookmarks/get_text').map((call) => bookmarkIdOf(call))).toEqual([
      11,
    ]);
    expect(legColumns(calls)).toEqual([
      {
        instapaper_last_error: 'Instapaper is rate-limiting alfred',
        instapaper_last_error_at: NOW_ISO,
      },
    ]);
    expect(summary.instapaper).toMatchObject({
      taken: 1,
      failures: ['bookmark 11: bookmarks/archive: rate-limited (error 1040)'],
    });
  });

  it('archives it next tick with no second post and no second model call', async () => {
    const calls = harness({
      bookmarked: [{ id: 'post-article', archived_at: WIRE_NULL, instapaper_bookmark_id: 11 }],
      instapaper: { bookmarks: [bookmarkRow()], texts: { 11: ARTICLE_HTML } },
    });
    const summarized = mockSummarize();

    const summary = await runReaderTick(instapaperEnv, NOW);

    expect(instapaperCalls(calls, 'bookmarks/get_text')).toEqual([]);
    expect(restCalls(calls, 'reader_posts', 'POST')).toEqual([]);
    expect(restCalls(calls, 'reader_posts', 'PATCH')).toEqual([]);
    expect(instapaperCalls(calls, 'bookmarks/archive')).toHaveLength(1);
    expect(summarized).not.toHaveBeenCalled();
    expect(summary.instapaper).toEqual({
      listed: 1,
      taken: 0,
      archived: 1,
      restored: 0,
      failures: [],
    });
  });

  it('reads a bookmark deleted since the listing as archived, not as a failure', async () => {
    const calls = harness({
      bookmarked: [{ id: 'post-article', archived_at: WIRE_NULL, instapaper_bookmark_id: 11 }],
      instapaper: {
        bookmarks: [bookmarkRow()],
        fail: {
          'bookmarks/archive': { status: 400, body: '[{"type":"error","error_code":1241}]' },
        },
      },
    });
    mockSummarize();

    const summary = await runReaderTick(instapaperEnv, NOW);

    expect(summary.instapaper).toMatchObject({ archived: 1, failures: [] });
    expect(legColumns(calls)).toEqual([{ instapaper_last_success_at: NOW_ISO }]);
  });
});

describe('runReaderTick — the To Reader leg, a bookmark already a post', () => {
  it('brings back a newsletter the owner sent to Instapaper and archived, with the summary it has', async () => {
    const calls = harness({
      bookmarked: [
        {
          id: 'post-newsletter',
          archived_at: '2026-09-17T08:00:00.000Z',
          instapaper_bookmark_id: 11,
        },
      ],
      instapaper: { bookmarks: [bookmarkRow()], texts: { 11: ARTICLE_HTML } },
    });
    const summarized = mockSummarize();

    const summary = await runReaderTick(instapaperEnv, NOW);

    const patches = restCalls(calls, 'reader_posts', 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]?.url).toContain('id=eq.post-newsletter');
    expect(payload(patches[0])).toEqual({ archived_at: WIRE_NULL });
    expect(instapaperCalls(calls, 'bookmarks/archive')).toHaveLength(1);
    expect(instapaperCalls(calls, 'bookmarks/get_text')).toEqual([]);
    expect(restCalls(calls, 'reader_posts', 'POST')).toEqual([]);
    expect(summarized).not.toHaveBeenCalled();
    expect(summary.instapaper).toEqual({
      listed: 1,
      taken: 0,
      archived: 1,
      restored: 1,
      failures: [],
    });
  });
});

describe('runReaderTick — the To Reader leg and the ceiling', () => {
  it('leaves a bookmark whose turn comes after the cap is reached mid-tick', async () => {
    const calls = harness({
      callsToday: 29,
      fresh: [worklistRow()],
      messages: [ESSAY_MESSAGE],
      instapaper: { bookmarks: [bookmarkRow()], texts: { 11: ARTICLE_HTML } },
    });
    const summarized = mockSummarize(DONE);

    const summary = await runReaderTick(instapaperEnv, NOW);

    // The newsletter spent the last call; the bookmark was listed but never prepared.
    expect(summarized).toHaveBeenCalledTimes(1);
    expect(instapaperCalls(calls, 'bookmarks/list')).toHaveLength(1);
    expect(instapaperCalls(calls, 'bookmarks/get_text')).toEqual([]);
    expect(instapaperCalls(calls, 'bookmarks/archive')).toEqual([]);
    expect(summary.skippedForCap).toBe(1);
    expect(summary.instapaper).toMatchObject({ listed: 1, taken: 0 });
  });
});

describe('runReaderTick — the To Reader leg when Gmail stops the tick', () => {
  it('leaves listed bookmarks for the next tick and writes none of the leg’s columns', async () => {
    const calls = harness({
      oauth: () => new Response('try later', { status: 503 }),
      instapaper: { bookmarks: [bookmarkRow()], texts: { 11: ARTICLE_HTML } },
    });
    mockSummarize();

    await runReaderTick(instapaperEnv, NOW);

    expect(instapaperCalls(calls, 'bookmarks/get_text')).toEqual([]);
    expect(legColumns(calls)).toEqual([]);
  });

  it('records the leg’s outcome in one PATCH of its own when there is no closing write', async () => {
    const calls = harness({
      oauth: () => new Response('try later', { status: 503 }),
      instapaper: { fail: { 'folders/list': { status: 403, body: 'Forbidden' } } },
    });
    mockSummarize();

    await runReaderTick(instapaperEnv, NOW);

    const writes = healthWrites(calls);
    // The run start, then the leg's own write — and no summariser column in it.
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual({
      instapaper_last_error: "Instapaper rejected alfred's credentials",
      instapaper_last_error_at: NOW_ISO,
    });
  });

  it('carries the leg’s outcome on the error write when the refresh token is finished', async () => {
    const calls = harness({
      oauth: () => Response.json({ error: 'invalid_grant' }, { status: 400 }),
      instapaper: { bookmarks: [] },
    });
    mockSummarize();

    await runReaderTick(instapaperEnv, NOW);

    expect(healthWrites(calls).at(-1)).toMatchObject({
      last_error: expect.any(String) as unknown,
      instapaper_last_success_at: NOW_ISO,
    });
  });
});

/** A pending Instapaper article, in the retry read's shape. */
function articleRetry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return retryRow({
    id: 'post-article',
    publication_id: WIRE_NULL,
    author: WIRE_NULL,
    source: 'instapaper',
    site: 'worksinprogress.co',
    title: 'Cities Are Getting Quieter',
    ...overrides,
  });
}

describe('runReaderTick — an Instapaper post retried', () => {
  it('tells the model the site when no publication is linked', async () => {
    harness({ retries: [articleRetry()] });
    const summarized = mockSummarize(DONE);

    await runReaderTick(env, NOW);

    expect(summarizedInputs(summarized)[0]).toMatchObject({ publication: 'worksinprogress.co' });
    expect(summarizedInputs(summarized)[0]).not.toHaveProperty('author');
  });

  it('tells the model the linked publication’s name once something links one', async () => {
    harness({
      roster: [{ id: 'pub-wip', name: 'Works in Progress' }],
      retries: [articleRetry({ publication_id: 'pub-wip' })],
    });
    const summarized = mockSummarize(DONE);

    await runReaderTick(env, NOW);

    expect(summarizedInputs(summarized)[0]).toMatchObject({ publication: 'Works in Progress' });
  });

  it('falls back to Instapaper for an article with neither', async () => {
    harness({ retries: [articleRetry({ site: WIRE_NULL })] });
    const summarized = mockSummarize(DONE);

    await runReaderTick(env, NOW);

    expect(summarizedInputs(summarized)[0]).toMatchObject({ publication: 'Instapaper' });
  });
});

describe('runReaderTick — the To Reader leg’s subrequests', () => {
  it('spends at most 48 of the 50 fetches on its worst tick: six new bookmarks', async () => {
    const ids = [100, 101, 102, 103, 104, 105];
    const bookmarks = ids.map((id) => bookmarkRow({ bookmark_id: id, time: 1_788_000_000 + id }));
    const texts: Record<number, string> = Object.fromEntries(ids.map((id) => [id, ARTICLE_HTML]));
    const calls = harness({
      // A discovery upsert, so every one of the nine per-tick fetches is spent.
      discovery: [
        {
          handle: 'harborline@substack.com',
          name: 'Harborline',
          first_seen_at: '2026-09-12T00:00:00.000Z',
          message_count: 1,
        },
      ],
      instapaper: { bookmarks, texts },
    });
    const summarized = mockSummarize();

    const summary = await runReaderTick(instapaperEnv, NOW);

    expect(summary.instapaper).toMatchObject({ taken: 6, archived: 6 });
    // `summarizePost` is mocked, so each model call's two possible Anthropic requests (the SDK
    // retries once) are added back by hand: 9 per tick + 3 for the leg + 6 × 6 per bookmark.
    const fetches = calls.length + 2 * summarized.mock.calls.length;
    expect(fetches).toBe(48);
    expect(fetches).toBeLessThanOrEqual(50);
  });
});

describe('runReaderTick — the To Reader leg only succeeds when it finished', () => {
  it('stamps no Instapaper success when the tick throws on the last bookmark', async () => {
    const calls = harness({
      instapaper: { bookmarks: [bookmarkRow()], texts: { 11: ARTICLE_HTML } },
    });
    // The article's insert is rejected outright: nothing was taken in, so nothing succeeded.
    spyOnFetch().mockImplementation((input: FetchInput, init?: FetchInit) => {
      const url = input as string;
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      if (url.includes('reader_posts') && init?.method === 'POST') {
        return Promise.resolve(new Response('boom', { status: 500 }));
      }
      if (url.startsWith(INSTAPAPER_PREFIX) && url.endsWith('/folders/list')) {
        return Promise.resolve(
          Response.json([{ type: 'folder', folder_id: 77, title: 'To Reader' }]),
        );
      }
      if (url.startsWith(INSTAPAPER_PREFIX) && url.endsWith('/bookmarks/list')) {
        return Promise.resolve(Response.json({ bookmarks: [bookmarkRow()] }));
      }
      if (url.startsWith(INSTAPAPER_PREFIX) && url.endsWith('/get_text')) {
        return Promise.resolve(new Response(ARTICLE_HTML));
      }
      if (url.startsWith(OAUTH_ENDPOINT)) {
        return Promise.resolve(Response.json({ access_token: 'ya29.access' }));
      }
      if (url.includes('reader_posts') && url.includes('select=id&')) {
        return Promise.resolve(new Response('[]', { headers: { 'Content-Range': '0-0/0' } }));
      }
      return Promise.resolve(Response.json(url.includes('reader_health') ? [{ id: 1 }] : []));
    });
    mockSummarize();

    const summary = await runReaderTick(instapaperEnv, NOW);

    expect(summary.failures).toEqual([expect.stringContaining('POST reader_posts')]);
    expect(legColumns(calls)).toEqual([]);
  });

  it('stamps no Instapaper success when the time budget left a bookmark in To Reader', async () => {
    const calls = harness({
      instapaper: {
        bookmarks: [bookmarkRow(), bookmarkRow({ bookmark_id: 12, time: 1_789_000_000 })],
        texts: { 11: ARTICLE_HTML, 12: ARTICLE_HTML },
      },
    });
    mockSummarize();
    // The first bookmark takes the whole eight minutes; the second is never started.
    let elapsed = 0;
    const clock = () => {
      const now = elapsed;
      elapsed += READER_TICK_BUDGET_MS / 2;
      return now;
    };

    const summary = await runReaderTick(instapaperEnv, NOW, clock);

    expect(summary.skippedForBudget).toBe(1);
    expect(instapaperCalls(calls, 'bookmarks/get_text').map((call) => bookmarkIdOf(call))).toEqual([
      11,
    ]);
    expect(legColumns(calls)).toEqual([]);
  });

  it('names the bookmark in the log line when a call about one bookmark fails', async () => {
    harness({
      instapaper: {
        bookmarks: [bookmarkRow()],
        texts: { 11: ARTICLE_HTML },
        fail: { 'bookmarks/archive': { status: 500, body: 'oops' } },
      },
    });
    mockSummarize(DONE);

    const summary = await runReaderTick(instapaperEnv, NOW);

    expect(summary.instapaper).toMatchObject({
      failures: ['bookmark 11: bookmarks/archive: unavailable (HTTP 500)'],
    });
  });

  it('restores the post and stamps the error when the archive after a restore fails', async () => {
    const calls = harness({
      bookmarked: [
        {
          id: 'post-newsletter',
          archived_at: '2026-09-17T08:00:00.000Z',
          instapaper_bookmark_id: 11,
        },
      ],
      instapaper: {
        bookmarks: [bookmarkRow()],
        fail: { 'bookmarks/archive': { status: 503, body: 'down' } },
      },
    });
    mockSummarize();

    const summary = await runReaderTick(instapaperEnv, NOW);

    expect(payload(restCalls(calls, 'reader_posts', 'PATCH')[0])).toEqual({
      archived_at: WIRE_NULL,
    });
    expect(summary.instapaper).toMatchObject({ restored: 1, archived: 0 });
    expect(legColumns(calls)).toEqual([
      { instapaper_last_error: "Instapaper didn't answer", instapaper_last_error_at: NOW_ISO },
    ]);
  });

  it('sends the leg’s outcome on its own when a Gmail read stops the tick', async () => {
    const calls = harness({
      fresh: [worklistRow()],
      messageStatus: { [ESSAY_MESSAGE.id]: 503 },
      instapaper: { fail: { 'folders/list': { status: 401, body: 'Unauthorized' } } },
    });
    mockSummarize();

    const summary = await runReaderTick(instapaperEnv, NOW);

    expect(summary.failures).toEqual([expect.stringContaining('gmail')]);
    const writes = healthWrites(calls);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual({
      instapaper_last_error: "Instapaper rejected alfred's credentials",
      instapaper_last_error_at: NOW_ISO,
    });
  });
});
