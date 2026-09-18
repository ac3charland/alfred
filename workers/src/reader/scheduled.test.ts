import type { GmailMessage } from '../comms/gmail-api';
import { type FetchInit, type FetchInput, spyOnFetch } from '../fetch-stub';
import { READER_DEFAULT_DAILY_CAP } from './config';
import {
  ESSAY_MESSAGE,
  PLAIN_TEXT_ONLY_MESSAGE,
  ROUNDUP_VIEW_IN_BROWSER_MESSAGE,
} from './fixtures';
import { READER_TICK_BUDGET_MS, runReaderTick } from './scheduled';
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
function without(key: 'READER_MODEL' | 'READER_DAILY_CAP' | 'ANTHROPIC_API_KEY'): ReaderEnv {
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
}

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
        const matched = url.includes('summary_state=eq.pending') ? (scenario.leased ?? 1) : 1;
        return Promise.resolve(
          Response.json(Array.from({ length: matched }, () => ({ id: 'row' }))),
        );
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
    expect(payload(restCalls(calls, 'reader_health')[0])).toMatchObject({
      last_error: expect.stringContaining('READER_DAILY_CAP') as unknown,
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
    expect(payload(health[0])).toEqual({ last_run_at: NOW_ISO });
    expect(payload(health[1])).toEqual({ last_success_at: NOW_ISO });
    expect(summary.failures).toEqual([]);
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

    expect(summarizedTitles(summarized)).toEqual(['An earlier post', 'The Grain Ledger']);
  });

  it('inserts the post and stamps the comms row BEFORE the model is called', async () => {
    // D9: title and link are the floor. A tick that dies leaves a pending row the next tick picks
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
    expect(payload(health[0])).toEqual({ last_run_at: NOW_ISO });
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
      // away into their reading list is the one outcome D5 says must not happen.
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

  it('files a refusal as terminal, uncounted', async () => {
    const calls = harness(freshOnly);
    mockSummarize({ kind: 'refused' });

    const summary = await runReaderTick(env, NOW);

    expect(payload(restCalls(calls, 'reader_posts', 'PATCH')[0])).toEqual({
      summary_state: 'refused',
      last_error: 'refused',
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
          gmail_message_id: ROUNDUP_VIEW_IN_BROWSER_MESSAGE.id,
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
      messages: [ESSAY_MESSAGE, ROUNDUP_VIEW_IN_BROWSER_MESSAGE, PLAIN_TEXT_ONLY_MESSAGE],
    });
    const summarized = mockSummarize(DONE, DONE, DONE);

    const summary = await runReaderTick(env, NOW);

    const upsert = restCalls(calls, 'reader_publications', 'POST')[0];
    expect(JSON.parse(upsert?.body ?? '[]')).toEqual([
      expect.objectContaining({ handle: 'harborline@substack.com', source: 'auto' }),
    ]);

    const inserts = restCalls(calls, 'reader_posts', 'POST').map((call) => payload(call));
    expect(inserts).toHaveLength(3);
    expect(inserts[2]).toMatchObject({ html_extracted: false, title: 'Notes from the third week' });
    expect(inserts[0]).toMatchObject({
      html_extracted: true,
      canonical_url: 'https://harborline.substack.com/p/the-grain-ledger',
    });

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
    });
  });
});
