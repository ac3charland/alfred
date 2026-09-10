import { spyOnFetch } from '../fetch-stub';
import {
  FIRST_RUN_QUERY,
  type GmailEnv,
  LISTING_STALLED,
  NOT_CONFIGURED,
  REJECTED_TOKEN,
  pollGmail,
} from './gmail';
import { MAX_MESSAGE_IDS } from './gmail-api';
import type { GmailHeader, GmailMessage } from './gmail-api';

const SUPABASE_URL = 'https://proj.supabase.co';
const OAUTH_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GMAIL_PREFIX = 'https://gmail.googleapis.com/gmail/v1/users/me/';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The outage in the re-seed rule, pinned as dates: broken on day 7, noticed on day 17. */
const DAY_7 = new Date('2026-09-07T00:00:00.000Z');
const DAY_17 = new Date('2026-09-17T00:00:00.000Z');

/** A JSON `null` — how PostgREST spells an absent column. This package bans the literal. */
const WIRE_NULL: unknown = JSON.parse('null');

const BASE = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  GMAIL_OAUTH_CLIENT_ID: 'client-id',
  GMAIL_OAUTH_CLIENT_SECRET: 'client-secret',
};

const personalOnly: GmailEnv = { ...BASE, GMAIL_PERSONAL_REFRESH_TOKEN: 'personal-refresh' };
const bothAccounts: GmailEnv = {
  ...personalOnly,
  GMAIL_REALPLAY_REFRESH_TOKEN: 'realplay-refresh',
};

interface Call {
  url: string;
  method: string;
  body: string | undefined;
}

/** What the fake Gmail account holds this test. */
interface Mailbox {
  profile?: { emailAddress: string; historyId: string };
  /** Ids `messages.list` returns — the first-run and re-seed path. */
  listIds?: string[];
  /** Ids the history walk reports as added, and where the mailbox then stands. */
  history?: {
    ids: string[];
    historyId?: string;
    /** Explicit per-record control, for exercising truncation. Overrides `ids` when set — each
     *  entry becomes one history record, carrying its own resumable `id`. */
    records?: { id?: string; ids: string[] }[];
  };
  /** Answer the history walk with a 404, the way an aged-out cursor is reported. */
  historyExpired?: boolean;
  /** Answer the profile read with this status, the way a wrong scope is reported. */
  profileStatus?: number;
  messages?: GmailMessage[];
  /** Statuses to answer a specific message read with, instead of the message. */
  messageStatus?: Record<string, number>;
}

/** What the fake database holds this test. */
interface Database {
  account?: Record<string, unknown>;
  people?: unknown[];
  /** Rows the insert reports as newly stored. */
  stored?: { id: string }[];
  /** Rows the source-id lookup finds, so the newsletter patch has something to patch. */
  lookup?: { id: string; source_id: string }[];
}

interface Scenario extends Database {
  mailbox?: Mailbox;
  /** Answer the token exchange with this instead of a fresh access token. */
  oauth?: () => Response;
}

function accountRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'account-1',
    key: 'gmail-personal',
    kind: 'gmail',
    label: 'personal',
    home: 'worker',
    owner_handles: ['owner@example.com'],
    enabled: true,
    expected_interval_seconds: 600,
    cursor: WIRE_NULL,
    last_seen_at: WIRE_NULL,
    last_error: WIRE_NULL,
    last_error_at: WIRE_NULL,
    ...overrides,
  };
}

/** Gmail's answer for one path, built from what the mailbox is supposed to hold. */
function gmailResponse(mailbox: Mailbox, path: string): Response {
  if (path === 'profile') {
    if (mailbox.profileStatus !== undefined) {
      return new Response('insufficient scope', { status: mailbox.profileStatus });
    }
    return Response.json(
      mailbox.profile ?? { emailAddress: 'Owner@Example.com', historyId: '5000' },
    );
  }
  if (path === 'messages') {
    return Response.json({ messages: (mailbox.listIds ?? []).map((id) => ({ id })) });
  }
  if (path === 'history') {
    if (mailbox.historyExpired === true) return new Response('history id expired', { status: 404 });
    const walk = mailbox.history ?? { ids: [] };
    const history = walk.records
      ? walk.records.map((record) => ({
          id: record.id,
          messagesAdded: record.ids.map((id) => ({ message: { id } })),
        }))
      : walk.ids.map((id) => ({ messagesAdded: [{ message: { id } }] }));
    return Response.json({ history, historyId: walk.historyId });
  }

  const id = path.slice('messages/'.length);
  const status = mailbox.messageStatus?.[id];
  if (status !== undefined) return new Response('gmail said no', { status });
  const found = (mailbox.messages ?? []).find((message) => message.id === id);
  return found === undefined
    ? new Response('no such message', { status: 404 })
    : Response.json(found);
}

/** PostgREST's answer for one call, built from what the database is supposed to hold. */
function supabaseResponse(call: Call, database: Database): Response {
  if (call.url.includes('/rpc/')) return Response.json(0);
  if (call.url.includes('/comm_accounts')) {
    return Response.json(call.method === 'POST' ? [accountRow(database.account)] : []);
  }
  if (call.url.includes('/comm_people')) return Response.json(database.people ?? []);
  if (call.url.includes('/comm_messages')) {
    if (call.method === 'POST') return Response.json(database.stored ?? []);
    if (call.method === 'GET') return Response.json(database.lookup ?? []);
    return Response.json([{ id: 'row-1' }]);
  }
  return Response.json([]);
}

/** Route every request by host and record it. No test in this file reaches the network. */
function harness(scenario: Scenario = {}): Call[] {
  const calls: Call[] = [];
  spyOnFetch().mockImplementation((input, init) => {
    const url = input as string;
    const raw = init?.body;
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: typeof raw === 'string' ? raw : undefined,
    };
    calls.push(call);

    if (url.startsWith(OAUTH_ENDPOINT)) {
      const respond = scenario.oauth ?? (() => Response.json({ access_token: 'ya29.access' }));
      return Promise.resolve(respond());
    }
    if (url.startsWith(GMAIL_PREFIX)) {
      const path = new URL(url).pathname.slice('/gmail/v1/users/me/'.length);
      return Promise.resolve(gmailResponse(scenario.mailbox ?? {}, path));
    }
    return Promise.resolve(supabaseResponse(call, scenario));
  });
  return calls;
}

/** Every recorded call to one Gmail endpoint. */
function gmailCalls(calls: Call[], path: string): URLSearchParams[] {
  return calls
    .filter((call) => call.url.startsWith(`${GMAIL_PREFIX}${path}`))
    .map((call) => new URL(call.url).searchParams);
}

/** Every recorded call to one PostgREST table with one method. */
function restCalls(calls: Call[], table: string, method: string): Call[] {
  return calls.filter(
    (call) => call.url.startsWith(`${SUPABASE_URL}/rest/v1/${table}`) && call.method === method,
  );
}

/** A recorded call's JSON body. */
function payload(call: Call | undefined): Record<string, unknown> {
  return JSON.parse(call?.body ?? '{}') as Record<string, unknown>;
}

/** The rows one `comm_messages` insert carried. */
function insertedRows(calls: Call[]): Record<string, unknown>[] {
  const [insert] = restCalls(calls, 'comm_messages', 'POST');
  return JSON.parse(insert?.body ?? '[]') as Record<string, unknown>[];
}

/** Encode text the way Gmail encodes a part body. */
function b64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** One Gmail message, with a plain-text body unless the caller supplies its own payload. */
function gmailMessage(
  id: string,
  options: {
    headers?: GmailHeader[];
    labelIds?: string[];
    text?: string;
    threadId?: string;
    internalDate?: string;
    payload?: GmailMessage['payload'];
  } = {},
): GmailMessage {
  return {
    id,
    threadId: options.threadId ?? `thread-${id}`,
    labelIds: options.labelIds ?? ['INBOX'],
    internalDate: options.internalDate ?? '1789000000000',
    payload: options.payload ?? {
      mimeType: 'text/plain',
      headers: options.headers ?? [{ name: 'From', value: 'Dana <dana@example.com>' }],
      body: { data: b64url(options.text ?? 'hello') },
    },
  };
}

describe('pollGmail', () => {
  it('skips an account whose refresh token was never set, without calling it broken', async () => {
    const calls = harness();

    const summary = await pollGmail(personalOnly, DAY_17);

    expect(summary.accounts).toContainEqual({
      key: 'gmail-realplay',
      polled: false,
      accepted: 0,
      error: NOT_CONFIGURED,
    });
    // Nothing was stamped on it, and nothing registered it: unconfigured is not erroring.
    expect(restCalls(calls, 'comm_accounts', 'PATCH')).toHaveLength(1);
  });

  it('asks the database nothing when neither account is configured', async () => {
    const fetchStub = spyOnFetch();

    await expect(pollGmail({ ...BASE }, DAY_17)).resolves.toEqual({
      accounts: [
        { key: 'gmail-personal', polled: false, accepted: 0, error: NOT_CONFIGURED },
        { key: 'gmail-realplay', polled: false, accepted: 0, error: NOT_CONFIGURED },
      ],
    });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('names the missing OAuth binding on the account rather than aborting the tick', async () => {
    const calls = harness();
    const noSecret: GmailEnv = {
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      GMAIL_OAUTH_CLIENT_ID: 'client-id',
      GMAIL_PERSONAL_REFRESH_TOKEN: 'personal-refresh',
    };

    const summary = await pollGmail(noSecret, DAY_17);

    expect(summary.accounts[0]).toEqual({
      key: 'gmail-personal',
      polled: false,
      accepted: 0,
      error: 'GMAIL_OAUTH_CLIENT_SECRET is not set',
    });
    // Registered first, so a Gmail account nobody can poll still shows up in the health strip.
    expect(restCalls(calls, 'comm_accounts', 'POST')).toHaveLength(1);
    const [stamped] = restCalls(calls, 'comm_accounts', 'PATCH');
    expect(payload(stamped)).toEqual({
      last_error: 'GMAIL_OAUTH_CLIENT_SECRET is not set',
      last_error_at: DAY_17.toISOString(),
    });
  });

  it('searches the seven-day window on a first run and seeds the cursor from the profile', async () => {
    const calls = harness({
      mailbox: {
        profile: { emailAddress: 'owner@example.com', historyId: '5000' },
        listIds: ['m1'],
        messages: [gmailMessage('m1')],
      },
      stored: [{ id: 'row-1' }],
    });

    const summary = await pollGmail(personalOnly, DAY_17);

    expect(summary.accounts[0]).toEqual({ key: 'gmail-personal', polled: true, accepted: 1 });
    expect(gmailCalls(calls, 'messages')[0]?.get('q')).toBe(FIRST_RUN_QUERY);
    expect(payload(restCalls(calls, 'comm_accounts', 'PATCH')[0])).toEqual({
      last_seen_at: DAY_17.toISOString(),
      cursor: { historyId: '5000' },
    });
  });

  it('registers the account with the address its own token opens', async () => {
    const calls = harness({
      mailbox: { profile: { emailAddress: 'Owner@Example.com', historyId: '1' } },
    });

    await pollGmail(personalOnly, DAY_17);

    const registrations = restCalls(calls, 'comm_accounts', 'POST');
    expect(JSON.parse(registrations[1]?.body ?? '[]')).toEqual([
      {
        key: 'gmail-personal',
        kind: 'gmail',
        label: 'personal',
        home: 'worker',
        owner_handles: ['owner@example.com'],
        expected_interval_seconds: 600,
      },
    ]);
  });

  it('walks history from the stored cursor and advances it to where the mailbox now stands', async () => {
    const calls = harness({
      account: { cursor: { historyId: '4000' } },
      mailbox: {
        history: { ids: ['m1'], historyId: '4200' },
        messages: [gmailMessage('m1')],
      },
    });

    await pollGmail(personalOnly, DAY_17);

    expect(gmailCalls(calls, 'history')[0]?.get('startHistoryId')).toBe('4000');
    expect(gmailCalls(calls, 'messages')).toHaveLength(1); // the message read, not a search
    expect(payload(restCalls(calls, 'comm_accounts', 'PATCH')[0])['cursor']).toEqual({
      historyId: '4200',
    });
  });

  it('falls back to the profile when a history walk reports nothing new', async () => {
    const calls = harness({
      account: { cursor: { historyId: '4000' } },
      mailbox: {
        profile: { emailAddress: 'owner@example.com', historyId: '4900' },
        history: { ids: [] },
      },
    });

    await pollGmail(personalOnly, DAY_17);

    expect(payload(restCalls(calls, 'comm_accounts', 'PATCH')[0])['cursor']).toEqual({
      historyId: '4900',
    });
  });

  it('holds the cursor short of the mailbox head when a first-run listing is truncated, so the overflow is not skipped forever', async () => {
    // The bug this guards: a naive fix advances the cursor to the mailbox's head the moment a
    // listing is truncated. That head is "now" — everything past the first 500 ids that a busy
    // week produced would never be looked at again, because a history walk only ever sees
    // changes AFTER the historyId it starts from.
    const overflow = MAX_MESSAGE_IDS + 5;
    const baseMs = 1_700_000_000_000;
    const ids = Array.from({ length: overflow }, (_value, index) => `m${String(index)}`);
    // Newest first, one second apart — the shape Gmail's own search results take.
    const messages = ids.map((id, index) =>
      gmailMessage(id, { internalDate: String(baseMs - index * 1000) }),
    );
    const calls = harness({
      mailbox: {
        profile: { emailAddress: 'owner@example.com', historyId: 'head-at-tick-1' },
        listIds: ids,
        messages,
      },
    });

    const summary = await pollGmail(personalOnly, DAY_17);

    expect(summary.accounts[0]?.polled).toBe(true);
    const cursor = payload(restCalls(calls, 'comm_accounts', 'PATCH')[0])['cursor'];
    expect(cursor).not.toEqual({ historyId: 'head-at-tick-1' });
    expect(cursor).toEqual({
      // The window's lower bound, frozen rather than left to drift with `now` on a later tick.
      listAfter: new Date(DAY_17.getTime() - 7 * DAY_MS).toISOString(),
      // The oldest message actually ingested this tick — where the next tick resumes.
      listBefore: new Date(baseMs - (MAX_MESSAGE_IDS - 1) * 1000).toISOString(),
      // The mailbox's historyId as of THIS tick — not "now", so the eventual history walk still
      // covers everything that arrives while the catch-up is still draining the backlog.
      resumeHistoryId: 'head-at-tick-1',
    });
  });

  it('resumes a truncated listing catch-up from its frozen window, and hands off to the historyId frozen when the catch-up began — not this tick’s own', async () => {
    const frozenAfter = '2026-08-20T00:00:00.000Z';
    const frozenBefore = '2026-08-25T00:00:00.000Z';
    const calls = harness({
      account: {
        cursor: {
          listAfter: frozenAfter,
          listBefore: frozenBefore,
          resumeHistoryId: 'frozen-at-catchup-start',
        },
      },
      mailbox: {
        // If the poller used THIS tick's own head instead of the frozen one, the cursor would
        // wrongly land here — the gap the frozen `resumeHistoryId` exists to close.
        profile: { emailAddress: 'owner@example.com', historyId: 'head-at-this-later-tick' },
        listIds: ['m1'],
        messages: [gmailMessage('m1')],
      },
    });

    await pollGmail(personalOnly, DAY_17);

    // The frozen window is reused verbatim — not recomputed from `lastSeenAt`/`now` — so a
    // multi-tick catch-up keeps making progress on the same range instead of restarting it.
    expect(gmailCalls(calls, 'messages')[0]?.get('q')).toBe(
      `after:${String(Math.floor(new Date(frozenAfter).getTime() / 1000))} before:${String(
        Math.floor(new Date(frozenBefore).getTime() / 1000),
      )}`,
    );
    // `resumeAnchor` (the catch-up's own window start) rides along with the promoted historyId
    // until that id has proven itself — see the "reseeds an expired resume id from its own
    // catch-up window" test below for why that matters.
    expect(payload(restCalls(calls, 'comm_accounts', 'PATCH')[0])['cursor']).toEqual({
      historyId: 'frozen-at-catchup-start',
      resumeAnchor: frozenAfter,
    });
  });

  it('advances a truncated history walk to the last record it consumed, never to the mailbox’s current head', async () => {
    const safeIds = Array.from(
      { length: MAX_MESSAGE_IDS - 2 },
      (_value, index) => `m${String(index)}`,
    );
    const calls = harness({
      account: { cursor: { historyId: '4000' } },
      mailbox: {
        profile: { emailAddress: 'owner@example.com', historyId: 'current-mailbox-head' },
        history: {
          ids: [],
          records: [
            { id: 'rec-safe', ids: safeIds },
            { id: 'rec-overflow', ids: ['x1', 'x2', 'x3'] },
          ],
        },
        messages: safeIds.map((id) => gmailMessage(id)),
      },
    });

    await pollGmail(personalOnly, DAY_17);

    expect(payload(restCalls(calls, 'comm_accounts', 'PATCH')[0])['cursor']).toEqual({
      historyId: 'rec-safe',
    });
  });

  it('re-seeds an expired cursor from the account’s own last poll, not from the window', async () => {
    // The worked example: the token died on day 7 and was noticed on day 17. Anchoring on the
    // later of the two would skip days 7 to 10 entirely — the gap this rule exists to close.
    const calls = harness({
      account: { cursor: { historyId: '10' }, last_seen_at: DAY_7.toISOString() },
      mailbox: { historyExpired: true, listIds: [] },
    });

    await pollGmail(personalOnly, DAY_17);

    expect(gmailCalls(calls, 'messages')[0]?.get('q')).toBe(
      `after:${String(Math.floor(DAY_7.getTime() / 1000))}`,
    );
  });

  it('re-seeds an expired catch-up resumeHistoryId from its own window start, not from last_seen_at (BUG 2)', async () => {
    // The regression: `last_seen_at` is bumped on every successful tick, including every
    // still-truncated one, so by the time a long catch-up's frozen historyId finally expires and
    // gets tried, `last_seen_at` means "last tick" (here: yesterday) rather than "when the
    // catch-up began" (here: three weeks ago). Reseeding from `last_seen_at` would silently
    // discard everything in between — exactly what `resumeAnchor` exists to prevent.
    const catchupStart = new Date(DAY_17.getTime() - 21 * DAY_MS);
    const yesterday = new Date(DAY_17.getTime() - DAY_MS);
    const calls = harness({
      account: {
        cursor: { historyId: 'expired-resume-id', resumeAnchor: catchupStart.toISOString() },
        last_seen_at: yesterday.toISOString(),
      },
      mailbox: { historyExpired: true, listIds: [] },
    });

    await pollGmail(personalOnly, DAY_17);

    expect(gmailCalls(calls, 'messages')[0]?.get('q')).toBe(
      `after:${String(Math.floor(catchupStart.getTime() / 1000))}`,
    );
  });

  it('drops resumeAnchor once its historyId has been used successfully, so it stops overriding last_seen_at', async () => {
    const calls = harness({
      account: {
        cursor: { historyId: 'good-id', resumeAnchor: '2026-08-01T00:00:00.000Z' },
      },
      mailbox: {
        profile: { emailAddress: 'owner@example.com', historyId: 'new-head' },
        history: { ids: [] },
      },
    });

    await pollGmail(personalOnly, DAY_17);

    expect(payload(restCalls(calls, 'comm_accounts', 'PATCH')[0])['cursor']).toEqual({
      historyId: 'new-head',
    });
  });

  it('re-seeds from the seven-day window when the account has never polled successfully', async () => {
    const calls = harness({
      account: { cursor: { historyId: '10' } },
      mailbox: { historyExpired: true, listIds: [] },
    });

    await pollGmail(personalOnly, DAY_17);

    expect(gmailCalls(calls, 'messages')[0]?.get('q')).toBe(
      `after:${String(Math.floor((DAY_17.getTime() - 7 * DAY_MS) / 1000))}`,
    );
  });

  it.each(['SPAM', 'TRASH', 'DRAFT'])(
    'never ingests a %s message — it did not arrive',
    async (label) => {
      const calls = harness({
        mailbox: {
          listIds: ['m1', 'm2'],
          messages: [
            gmailMessage('m1', { labelIds: [label] }),
            gmailMessage('m2', { labelIds: ['INBOX'] }),
          ],
        },
      });

      await pollGmail(personalOnly, DAY_17);

      expect(insertedRows(calls).map((row) => row['source_id'])).toEqual(['m2']);
    },
  );

  it('marks a SENT message outbound so it drains the thread it answers', async () => {
    const calls = harness({
      mailbox: {
        listIds: ['m1'],
        messages: [
          gmailMessage('m1', {
            labelIds: ['SENT'],
            threadId: 'thread-9',
            headers: [
              { name: 'From', value: 'owner@example.com' },
              { name: 'References', value: '<earlier@example.com>' },
            ],
          }),
        ],
      },
    });

    await pollGmail(personalOnly, DAY_17);

    expect(insertedRows(calls)[0]?.['direction']).toBe('outbound');
    const drain = calls.find((call) => call.url.includes('/rpc/comm_record_reply'));
    expect(payload(drain)).toMatchObject({
      p_account: 'account-1',
      p_thread_key: 'thread-9',
      p_references: ['<earlier@example.com>'],
    });
  });

  it('normalises the fields the rest of the module reads', async () => {
    const calls = harness({
      mailbox: {
        listIds: ['m1'],
        messages: [
          gmailMessage('m1', {
            threadId: 'thread-9',
            internalDate: '1789000000000',
            text: 'can you look at this',
            headers: [
              { name: 'From', value: 'Dana Whitfield <Dana@Example.com>' },
              { name: 'To', value: 'Owner@Example.com, "Lee, Sam" <sam@example.com>' },
              { name: 'Cc', value: 'cc@example.com' },
              { name: 'Subject', value: 'the invoice' },
              { name: 'Message-ID', value: '<m1@mail.example>' },
              { name: 'In-Reply-To', value: '<earlier@mail.example>' },
              { name: 'References', value: '<first@mail.example> <earlier@mail.example>' },
            ],
          }),
        ],
      },
    });

    await pollGmail(personalOnly, DAY_17);

    expect(insertedRows(calls)[0]).toEqual({
      account_id: 'account-1',
      source_id: 'm1',
      rfc822_message_id: '<m1@mail.example>',
      thread_key: 'thread-9',
      direction: 'inbound',
      sender_handle: 'dana@example.com',
      sender_name: 'Dana Whitfield',
      participants: ['owner@example.com', 'sam@example.com', 'cc@example.com'],
      subject: 'the invoice',
      body: 'can you look at this',
      received_at: new Date(1_789_000_000_000).toISOString(),
      body_extracted: true,
      has_attachments: false,
      in_reply_to: '<earlier@mail.example>',
      references_ids: ['<first@mail.example>', '<earlier@mail.example>'],
    });
  });

  it('stores a newsletter and then shelves it, flagged as the filter’s doing', async () => {
    const calls = harness({
      mailbox: {
        listIds: ['m1'],
        messages: [
          gmailMessage('m1', {
            headers: [
              { name: 'From', value: 'news@sender.example' },
              { name: 'List-Unsubscribe', value: '<https://sender.example/u>' },
            ],
          }),
        ],
      },
      stored: [{ id: 'row-1' }],
      lookup: [{ id: 'row-1', source_id: 'm1' }],
    });

    await pollGmail(personalOnly, DAY_17);

    // Stored like anything else — the filter shelves, it never drops.
    expect(insertedRows(calls)[0]?.['source_id']).toBe('m1');
    const [patch] = restCalls(calls, 'comm_messages', 'PATCH');
    expect(payload(patch)).toEqual({
      tier: 'fyi',
      judged_by: 'filter',
      filtered_reason: 'newsletter',
      classified_at: DAY_17.toISOString(),
    });
    // Compare-and-set: a re-seed must not overwrite a tier the owner has since chosen.
    expect(new URL(patch?.url ?? '').searchParams.get('tier')).toBe('is.null');
  });

  it('never filters a roster sender, whatever the list headers say', async () => {
    const calls = harness({
      people: [
        {
          id: 'person-1',
          name: 'Dana',
          priority: 'high',
          notes: WIRE_NULL,
          comm_handles: [{ handle: 'Dana@Example.com', kind: 'email' }],
        },
      ],
      mailbox: {
        listIds: ['m1'],
        messages: [
          gmailMessage('m1', {
            headers: [
              { name: 'From', value: 'Dana <dana@example.com>' },
              { name: 'List-Unsubscribe', value: '<https://list.example/u>' },
            ],
          }),
        ],
      },
      stored: [{ id: 'row-1' }],
      lookup: [{ id: 'row-1', source_id: 'm1' }],
    });

    await pollGmail(personalOnly, DAY_17);

    expect(restCalls(calls, 'comm_messages', 'PATCH')).toHaveLength(0);
  });

  it('leaves the cursor alone when a message read fails on transport', async () => {
    const calls = harness({
      account: { cursor: { historyId: '4000' } },
      mailbox: {
        history: { ids: ['m1', 'm2'], historyId: '4200' },
        messages: [gmailMessage('m1')],
        messageStatus: { m2: 503 },
      },
      stored: [{ id: 'row-1' }],
    });

    const summary = await pollGmail(personalOnly, DAY_17);

    // What it did read is kept — the insert dedupes when the next tick re-reads the same stretch.
    expect(insertedRows(calls).map((row) => row['source_id'])).toEqual(['m1']);
    expect(summary.accounts[0]?.polled).toBe(false);
    const [stamped] = restCalls(calls, 'comm_accounts', 'PATCH');
    expect(payload(stamped)).toEqual({
      last_error: 'gmail request failed: 503 gmail said no',
      last_error_at: DAY_17.toISOString(),
    });
  });

  it('skips a message that vanished between the listing and the read', async () => {
    const calls = harness({
      mailbox: {
        listIds: ['gone', 'm1'],
        messages: [gmailMessage('m1')],
      },
    });

    const summary = await pollGmail(personalOnly, DAY_17);

    expect(insertedRows(calls).map((row) => row['source_id'])).toEqual(['m1']);
    expect(summary.accounts[0]?.polled).toBe(true);
  });

  it('stamps a rejected refresh token and still polls the other account', async () => {
    let exchanges = 0;
    const calls = harness({
      oauth: () => {
        exchanges += 1;
        return exchanges === 1
          ? new Response('{"error":"invalid_grant"}', { status: 400 })
          : Response.json({ access_token: 'ya29.access' });
      },
    });

    const summary = await pollGmail(bothAccounts, DAY_17);

    expect(summary.accounts).toEqual([
      { key: 'gmail-personal', polled: false, accepted: 0, error: REJECTED_TOKEN },
      { key: 'gmail-realplay', polled: true, accepted: 0 },
    ]);
    expect(payload(restCalls(calls, 'comm_accounts', 'PATCH')[0])['last_error']).toBe(
      REJECTED_TOKEN,
    );
  });

  it('reads a rejected Gmail call as needing re-authorization, not as a retry', async () => {
    const calls = harness({ mailbox: { profileStatus: 403 } });

    const summary = await pollGmail(personalOnly, DAY_17);

    expect(summary.accounts[0]?.error).toContain('re-authorize (token or scope)');
    expect(payload(restCalls(calls, 'comm_accounts', 'PATCH')[0])['last_error']).toContain(
      'insufficient scope',
    );
  });

  it('stores a message whose payload it could not read, flagged rather than skipped', async () => {
    const calls = harness({
      mailbox: {
        listIds: ['m1'],
        messages: [
          {
            id: 'm1',
            threadId: 'thread-1',
            labelIds: ['INBOX'],
            internalDate: '1789000000000',
            payload: {
              mimeType: 'application/octet-stream',
              headers: [{ name: 'From', value: 'dana@example.com' }],
              body: { size: 400 },
            },
          },
        ],
      },
    });

    await pollGmail(personalOnly, DAY_17);

    expect(insertedRows(calls)[0]).toMatchObject({
      source_id: 'm1',
      body: '',
      body_extracted: false,
    });
  });

  it('reports a database failure against the account it happened on', async () => {
    spyOnFetch().mockImplementation(() => Promise.reject(new Error('supabase unreachable')));

    const summary = await pollGmail(personalOnly, DAY_17);

    expect(summary.accounts[0]).toEqual({
      key: 'gmail-personal',
      polled: false,
      accepted: 0,
      error: 'supabase unreachable',
    });
  });
});

/**
 * BUG 1: a truncated listing catch-up livelocks when `MAX_MESSAGE_IDS` or more not-yet-read
 * messages share Gmail's whole-SECOND, INCLUSIVE `before:` boundary — narrowing `listBefore` to
 * the oldest message read can never exclude any of them, so the next tick's query, cursor, and
 * returned ids become identical forever with no error and no log.
 *
 * The shared `harness()` above answers `messages.list` with one canned, unpaginated response and
 * never inspects `q` — every existing truncated-listing test therefore already avoids the one
 * thing a tie depends on: what the SAME query returns on a LATER tick. Reproducing this bug needs
 * a mock that actually behaves like Gmail — `after:`/`before:` filtering at whole-second,
 * inclusive granularity, and real `maxResults`/`pageToken` pagination — carried across multiple
 * chained `pollGmail` calls the way multiple cron ticks would be. `describe`d separately from
 * `pollGmail` above because it needs that different, purpose-built harness.
 */

/** One synthetic Gmail message pinned to an exact millisecond, for `normalize()` to accept. */
function tieMessage(id: string, internalDateMs: number): GmailMessage {
  return gmailMessage(id, { internalDate: String(internalDateMs) });
}

/** `q`'s `newer_than:Nd` / `after:S` / `before:S` forms, as the bounds they express in seconds. */
function parseQuery(q: string | null, now: Date): { afterSecs?: number; beforeSecs?: number } {
  if (q === null) return {};
  const bounds: { afterSecs?: number; beforeSecs?: number } = {};
  const newerThan = /newer_than:(\d+)d/.exec(q);
  const after = /(?:^|\s)after:(\d+)/.exec(q);
  const before = /(?:^|\s)before:(\d+)/.exec(q);
  if (newerThan) {
    bounds.afterSecs = Math.floor((now.getTime() - Number(newerThan[1]) * DAY_MS) / 1000);
  }
  if (after) bounds.afterSecs = Number(after[1]);
  if (before) bounds.beforeSecs = Number(before[1]);
  return bounds;
}

/**
 * A Gmail-semantics-faithful `messages.list` (inclusive, whole-second filtering; real
 * `maxResults`/`pageToken` pagination) plus `messages.get` and `profile`, backed by a mutable fake
 * `comm_accounts` row and a dedupe-aware fake `comm_messages` insert — so consecutive `pollGmail`
 * calls see exactly what the previous call actually wrote, the way consecutive cron ticks would.
 */
function faithfulHarness(
  pool: { id: string; internalDateMs: number }[],
  now: Date,
): { calls: Call[]; storedCount: () => number } {
  // Newest first, exactly like Gmail's own listing order. `unicorn/no-array-sort` forbids
  // `.sort()` and this package's ES2022 lib target has no `.toSorted()` — see the eslint skill's
  // "circular constraint" note — so this builds a new array via insertion instead of mutating one.
  const sorted: { id: string; internalDateMs: number }[] = [];
  for (const entry of pool) {
    const insertAt = sorted.findIndex((existing) => existing.internalDateMs < entry.internalDateMs);
    if (insertAt === -1) sorted.push(entry);
    else sorted.splice(insertAt, 0, entry);
  }
  const byId = new Map(
    sorted.map((entry) => [entry.id, tieMessage(entry.id, entry.internalDateMs)]),
  );
  const stored = new Set<string>();
  let account = accountRow();

  const calls: Call[] = [];
  spyOnFetch().mockImplementation((input, init) => {
    const url = input as string;
    const raw = init?.body;
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: typeof raw === 'string' ? raw : undefined,
    };
    calls.push(call);

    if (url.startsWith(OAUTH_ENDPOINT)) {
      return Promise.resolve(Response.json({ access_token: 'ya29.access' }));
    }

    if (url.startsWith(GMAIL_PREFIX)) {
      const parsed = new URL(url);
      const path = parsed.pathname.slice('/gmail/v1/users/me/'.length);
      const params = parsed.searchParams;

      if (path === 'profile') {
        return Promise.resolve(
          Response.json({ emailAddress: 'owner@example.com', historyId: 'catchup-head' }),
        );
      }

      if (path === 'messages') {
        const { afterSecs, beforeSecs } = parseQuery(params.get('q'), now);
        const matching = sorted.filter((entry) => {
          const secs = Math.floor(entry.internalDateMs / 1000);
          if (afterSecs !== undefined && secs < afterSecs) return false;
          if (beforeSecs !== undefined && secs > beforeSecs) return false;
          return true;
        });
        const offset = params.get('pageToken') === null ? 0 : Number(params.get('pageToken'));
        const maxResults = Number(params.get('maxResults') ?? String(MAX_MESSAGE_IDS));
        const page = matching.slice(offset, offset + maxResults);
        const nextOffset = offset + page.length;
        const body: { messages: { id: string }[]; nextPageToken?: string } = {
          messages: page.map((entry) => ({ id: entry.id })),
        };
        if (nextOffset < matching.length) body.nextPageToken = String(nextOffset);
        return Promise.resolve(Response.json(body));
      }

      const id = path.slice('messages/'.length);
      const message = byId.get(id);
      return Promise.resolve(
        message === undefined ? new Response('gone', { status: 404 }) : Response.json(message),
      );
    }

    if (url.includes('/rpc/')) return Promise.resolve(Response.json(0));
    if (url.includes('/comm_accounts')) {
      if (call.method === 'PATCH') {
        account = { ...account, ...(JSON.parse(call.body ?? '{}') as Record<string, unknown>) };
      }
      return Promise.resolve(Response.json([account]));
    }
    if (url.includes('/comm_people')) return Promise.resolve(Response.json([]));
    if (url.includes('/comm_messages') && call.method === 'POST') {
      const rows = JSON.parse(call.body ?? '[]') as { source_id: string }[];
      const fresh = rows.filter((row) => !stored.has(row.source_id));
      for (const row of rows) stored.add(row.source_id);
      return Promise.resolve(Response.json(fresh.map((row) => ({ id: `row-${row.source_id}` }))));
    }
    return Promise.resolve(Response.json([]));
  });

  return { calls, storedCount: () => stored.size };
}

describe('pollGmail — truncated listing catch-up on a boundary-second tie', () => {
  it('drains all 700 messages across ticks even though 600 of them share one exact search-second', async () => {
    // The reproduction: a first-run catch-up over a busy week, where most of the backlog shares
    // one whole second (all-hours digests firing at once is a realistic version of this). Before
    // the fix, tick 2 onward re-lists the SAME 500-and-under ids forever and the 100 beyond the
    // cap are never read — see the module doc on `finalizeListingCursor` for why.
    const SPREAD = 100;
    const TIED = 600;
    const base = DAY_17.getTime() - 2 * DAY_MS;
    // Its own whole second, comfortably older than the spread batch and still inside 7 days.
    const tiedMs = base - 200_000;
    const pool = [
      ...Array.from({ length: SPREAD }, (_value, index) => ({
        id: `s${String(index)}`,
        internalDateMs: base - index * 1000,
      })),
      ...Array.from({ length: TIED }, (_value, index) => ({
        id: `t${String(index)}`,
        internalDateMs: tiedMs,
      })),
    ];
    const { calls, storedCount } = faithfulHarness(pool, DAY_17);

    const tick1 = await pollGmail(personalOnly, DAY_17);
    const tick2 = await pollGmail(personalOnly, DAY_17);

    expect(tick1.accounts[0]).toEqual({ key: 'gmail-personal', polled: true, accepted: 500 });
    // The tie: every one of tick 1's 100 remaining candidates for `before:` narrowing shares the
    // identical trailing second — date narrowing alone would read the same 500 again. The fix
    // (Gmail's own page token) instead picks up exactly where tick 1 left off.
    expect(tick2.accounts[0]).toEqual({ key: 'gmail-personal', polled: true, accepted: 200 });
    expect(storedCount()).toBe(SPREAD + TIED);
    // No third tick, and no retry, was needed — a livelocked account would still be sitting here
    // ingesting nothing, tick after tick, with `polled: true` and no error to notice.
    const messageGets = calls.filter(
      (call) => call.method === 'GET' && /\/messages\/[^/?]+\?/.exec(call.url) !== null,
    );
    expect(messageGets).toHaveLength(700); // every message read exactly once — no re-fetch churn
  });

  it('surfaces a visible error rather than repeating forever when a tie leaves no native page token to resume from', async () => {
    // The defensive fallback: even without Gmail's own page token (the shared, unpaginated
    // `harness()` below never provides one — realistic only for the case where a single response
    // page already exceeded the cap, see `MAX_MESSAGE_IDS`), the fix must not loop on an
    // unchanged cursor silently. It must stamp the account visibly erroring instead.
    const overflow = MAX_MESSAGE_IDS + 5;
    const tiedMs = 1_700_000_000_000;
    const tiedIso = new Date(tiedMs).toISOString();
    const ids = Array.from({ length: overflow }, (_value, index) => `m${String(index)}`);
    const messages = ids.map((id) => gmailMessage(id, { internalDate: String(tiedMs) }));
    const calls = harness({
      account: {
        cursor: {
          listAfter: '2026-08-01T00:00:00.000Z',
          // Already narrowed to the tied second by an earlier tick — the next narrowing attempt
          // cannot move past it, which is exactly what a real repeat of this scenario looks like.
          listBefore: tiedIso,
          resumeHistoryId: 'frozen-at-catchup-start',
        },
      },
      mailbox: {
        profile: { emailAddress: 'owner@example.com', historyId: 'head-at-tick' },
        listIds: ids,
        messages,
      },
      stored: ids.slice(0, MAX_MESSAGE_IDS).map((id) => ({ id: `row-${id}` })),
    });

    const summary = await pollGmail(personalOnly, DAY_17);

    expect(summary.accounts[0]).toEqual({
      key: 'gmail-personal',
      polled: false,
      accepted: MAX_MESSAGE_IDS,
      error: LISTING_STALLED,
    });
    const [stamped] = restCalls(calls, 'comm_accounts', 'PATCH');
    expect(payload(stamped)).toEqual({
      last_error: LISTING_STALLED,
      last_error_at: DAY_17.toISOString(),
    });
    // Never touched — the same window is there for the very next retry to try again.
    expect(payload(stamped)['cursor']).toBeUndefined();
  });
});
