import { spyOnFetch } from '../fetch-stub';
import type { SupabaseEnv } from '../supabase';
import {
  fetchAccountByKey,
  fetchAccounts,
  fetchCurrentRubric,
  fetchExampleSetVersion,
  fetchExamples,
  fetchPeople,
  fetchReclassifyRequests,
  fetchUnjudgedAtCeiling,
  fetchUnjudgedMessages,
  ingestMessages,
  insertVerdict,
  patchMessage,
  recordClassifierRun,
  recordPollError,
  recordPollSuccess,
  sweepExpired,
  upsertAccount,
} from './store';
import type { CommAccount, NormalizedMessage } from './types';

const env: SupabaseEnv = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

const NOW = new Date('2026-09-09T12:00:00.000Z');

/**
 * A JSON `null`, which is how PostgREST spells an absent column. Produced rather than written,
 * because this package bans the `null` literal in source — the wire still speaks it.
 */
const WIRE_NULL: unknown = JSON.parse('null');

interface Call {
  url: string;
  method: string;
  body: unknown;
  prefer: string | undefined;
}

/** The `Prefer` header a call carried, if any — the header PostgREST reads upsert intent from. */
function preferOf(init: RequestInit | undefined): string | undefined {
  const sent = init?.headers as Record<string, string> | undefined;
  return sent?.['Prefer'];
}

/** Record every Supabase request and answer it with `respond` (an empty array by default). */
function mockSupabase(respond: (call: Call) => Response = () => Response.json([])): Call[] {
  const calls: Call[] = [];
  spyOnFetch().mockImplementation((input, init) => {
    const rawBody = init?.body;
    const call: Call = {
      url: input as string,
      method: init?.method ?? 'GET',
      body: typeof rawBody === 'string' ? JSON.parse(rawBody) : undefined,
      prefer: preferOf(init),
    };
    calls.push(call);
    return Promise.resolve(respond(call));
  });
  return calls;
}

/** The query string of a recorded call, so a filter can be asserted decoded rather than escaped. */
const query = (call: Call): URLSearchParams => new URL(call.url).searchParams;

/** One `comm_accounts` row as PostgREST hands it over, with every absent column a JSON null. */
function accountRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'account-1',
    key: 'imessage',
    kind: 'imessage',
    label: 'iMessage',
    home: 'daemon',
    owner_handles: ['+15125550123'],
    enabled: true,
    expected_interval_seconds: 300,
    cursor: WIRE_NULL,
    last_seen_at: WIRE_NULL,
    last_error: WIRE_NULL,
    last_error_at: WIRE_NULL,
    ...overrides,
  };
}

/** The account the store writes against, already mapped. */
function account(overrides: Partial<CommAccount> = {}): CommAccount {
  return {
    id: 'account-1',
    key: 'imessage',
    kind: 'imessage',
    label: 'iMessage',
    home: 'daemon',
    owner_handles: ['+15125550123'],
    enabled: true,
    expected_interval_seconds: 300,
    cursor: undefined,
    ...overrides,
  };
}

/** One normalized message, with every field stated so a fixture can never test an impossible row. */
function message(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    source_id: 'guid-1',
    thread_key: 'chat-7',
    direction: 'inbound',
    sender_handle: '+15125559999',
    participants: ['+15125559999', '+15125550123'],
    body: 'can you send the invoice',
    received_at: '2026-09-09T11:00:00.000Z',
    body_extracted: true,
    has_attachments: false,
    references_ids: [],
    ...overrides,
  };
}

describe('upsertAccount', () => {
  it('upserts on the account key, merging duplicates so a re-registration is idempotent', async () => {
    const calls = mockSupabase(() => Response.json([accountRow()]));

    const stored = await upsertAccount(env, {
      key: 'imessage',
      kind: 'imessage',
      label: 'iMessage',
      home: 'daemon',
      owner_handles: ['+15125550123'],
      expected_interval_seconds: 300,
    });

    expect(calls).toHaveLength(1);
    const [call] = calls as [Call];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/rest/v1/comm_accounts');
    expect(query(call).get('on_conflict')).toBe('key');
    expect(call.prefer).toBe('resolution=merge-duplicates,return=representation');
    expect(stored).toEqual(account());
  });

  it('sends only the columns a poller owns, so cursor and health survive every re-registration', async () => {
    // The daemon re-registers its accounts on every heartbeat. If the upsert carried the cursor
    // or the health columns, each heartbeat would reset the account to "never polled" — the
    // ingestion state would be destroyed by the call that reports ingestion is working.
    const calls = mockSupabase(() => Response.json([accountRow()]));

    await upsertAccount(env, { key: 'workmail', kind: 'imap', label: 'WorkMail', home: 'daemon' });

    const [call] = calls as [Call];
    expect(call.body).toEqual([
      { key: 'workmail', kind: 'imap', label: 'WorkMail', home: 'daemon' },
    ]);
  });

  it('throws when the upsert reports no row, rather than inventing an account', async () => {
    expect.assertions(1);
    mockSupabase(() => Response.json([]));

    await expect(
      upsertAccount(env, { key: 'workmail', kind: 'imap', label: 'WorkMail', home: 'daemon' }),
    ).rejects.toThrow('returned no row');
  });

  it('throws the shared Supabase failure shape on a rejected write', async () => {
    expect.assertions(1);
    mockSupabase(() => new Response('violates check constraint', { status: 400 }));

    await expect(
      upsertAccount(env, { key: 'workmail', kind: 'imap', label: 'WorkMail', home: 'daemon' }),
    ).rejects.toThrow('Supabase POST comm_accounts failed: 400 violates check constraint');
  });
});

describe('fetchAccounts', () => {
  it('reads every account and maps absent columns to undefined', async () => {
    const calls = mockSupabase(() =>
      Response.json([
        accountRow({ cursor: { historyId: '42' }, last_seen_at: '2026-09-09T11:59:00.000Z' }),
      ]),
    );

    const accounts = await fetchAccounts(env);

    const [call] = calls as [Call];
    expect(call.method).toBe('GET');
    expect(call.url).toContain('/rest/v1/comm_accounts');
    expect(accounts).toEqual([
      account({ cursor: { historyId: '42' }, last_seen_at: '2026-09-09T11:59:00.000Z' }),
    ]);
  });
});

describe('fetchAccountByKey', () => {
  it('filters on the key and returns the one account', async () => {
    const calls = mockSupabase(() => Response.json([accountRow()]));

    const found = await fetchAccountByKey(env, 'imessage');

    const [call] = calls as [Call];
    expect(query(call).get('key')).toBe('eq.imessage');
    expect(query(call).get('limit')).toBe('1');
    expect(found).toEqual(account());
  });

  it('returns undefined when no account carries that key', async () => {
    mockSupabase(() => Response.json([]));
    await expect(fetchAccountByKey(env, 'nobody')).resolves.toBeUndefined();
  });
});

describe('recordPollSuccess', () => {
  it('stamps the successful poll and stores the cursor it resumed from', async () => {
    const calls = mockSupabase();

    await recordPollSuccess(env, 'account-1', { at: NOW, cursor: { rowid: 812 } });

    const [call] = calls as [Call];
    expect(call.method).toBe('PATCH');
    expect(query(call).get('id')).toBe('eq.account-1');
    expect(call.body).toEqual({
      last_seen_at: '2026-09-09T12:00:00.000Z',
      cursor: { rowid: 812 },
    });
  });

  it('leaves the stored cursor alone when the poll produced none', async () => {
    const calls = mockSupabase();

    await recordPollSuccess(env, 'account-1', { at: NOW });

    const [call] = calls as [Call];
    expect(call.body).toEqual({ last_seen_at: '2026-09-09T12:00:00.000Z' });
  });
});

describe('recordPollError', () => {
  it('stamps the error without touching last_seen_at, so quiet stays distinct from broken', async () => {
    // last_seen_at is the answer to "is anything still arriving". A failed poll that moved it
    // would paint a dead account green — the exact failure the per-account health exists to stop.
    const calls = mockSupabase();

    await recordPollError(env, 'account-1', { at: NOW, error: 'IMAP auth refused' });

    const [call] = calls as [Call];
    expect(call.method).toBe('PATCH');
    expect(call.body).toEqual({
      last_error: 'IMAP auth refused',
      last_error_at: '2026-09-09T12:00:00.000Z',
    });
  });
});

describe('ingestMessages', () => {
  it('makes no request at all for an empty batch', async () => {
    const calls = mockSupabase();

    const result = await ingestMessages(env, account(), [], NOW);

    expect(calls).toEqual([]);
    expect(result).toEqual({ accepted: 0, duplicates: 0, drained: 0 });
  });

  it('inserts the batch in one request, ignoring rows it has already seen', async () => {
    // Dedupe is the database's job via (account_id, source_id): a re-seed after a lost cursor
    // re-sends messages by design, and `ignore-duplicates` is what makes that a no-op.
    const calls = mockSupabase(() => Response.json([{ id: 'message-1' }]));

    const result = await ingestMessages(
      env,
      account(),
      [message(), message({ source_id: 'guid-2' })],
      NOW,
    );

    expect(calls).toHaveLength(1);
    const [call] = calls as [Call];
    expect(call.method).toBe('POST');
    expect(query(call).get('on_conflict')).toBe('account_id,source_id');
    expect(call.prefer).toBe('resolution=ignore-duplicates,return=representation');
    expect(result).toEqual({ accepted: 1, duplicates: 1, drained: 0 });
  });

  it('maps a normalized message onto the message columns', async () => {
    const calls = mockSupabase(() => Response.json([{ id: 'message-1' }]));

    await ingestMessages(
      env,
      account(),
      [
        message({
          rfc822_message_id: '<abc@mail>',
          sender_name: 'Dana',
          chat_name: 'Invoices',
          subject: 'Q3 invoice',
          in_reply_to: '<prior@mail>',
          references_ids: ['<root@mail>'],
          body_extracted: false,
          has_attachments: true,
        }),
      ],
      NOW,
    );

    const [call] = calls as [Call];
    expect(call.body).toEqual([
      {
        account_id: 'account-1',
        source_id: 'guid-1',
        rfc822_message_id: '<abc@mail>',
        thread_key: 'chat-7',
        direction: 'inbound',
        sender_handle: '+15125559999',
        sender_name: 'Dana',
        chat_name: 'Invoices',
        participants: ['+15125559999', '+15125550123'],
        subject: 'Q3 invoice',
        body: 'can you send the invoice',
        received_at: '2026-09-09T11:00:00.000Z',
        body_extracted: false,
        has_attachments: true,
        in_reply_to: '<prior@mail>',
        references_ids: ['<root@mail>'],
      },
    ]);
  });

  it('treats a message from one of the owner handles as outbound, whatever the source claimed', async () => {
    // A source that reports its own Sent folder as inbound would put the owner's own replies in
    // the queue. The account's handles are the authority, and the comparison is case-insensitive
    // because an address is not case-sensitive and no source normalises consistently.
    const calls = mockSupabase((call) =>
      call.url.includes('/rpc/') ? Response.json(0) : Response.json([{ id: 'message-1' }]),
    );

    await ingestMessages(
      env,
      account({ owner_handles: ['owner@example.com'] }),
      [message({ sender_handle: 'Owner@Example.COM', direction: 'inbound' })],
      NOW,
    );

    const [insert] = calls as [Call];
    expect(insert.body).toEqual([expect.objectContaining({ direction: 'outbound' })]);
  });

  it('drains the thread for every outbound message, and sums what each one cleared', async () => {
    const calls = mockSupabase((call) =>
      call.url.includes('/rpc/comm_record_reply')
        ? Response.json(2)
        : Response.json([{ id: 'a' }, { id: 'b' }]),
    );

    const result = await ingestMessages(
      env,
      account({ owner_handles: ['owner@example.com'] }),
      [
        message({ source_id: 'guid-1', sender_handle: 'someone@example.com' }),
        message({
          source_id: 'guid-2',
          sender_handle: 'owner@example.com',
          thread_key: 'thread-9',
          in_reply_to: '<prior@mail>',
          references_ids: ['<root@mail>'],
          received_at: '2026-09-09T11:30:00.000Z',
        }),
      ],
      NOW,
    );

    const rpcs = calls.filter((call) => call.url.includes('/rpc/comm_record_reply'));
    expect(rpcs).toHaveLength(1);
    const [rpc] = rpcs as [Call];
    expect(rpc.method).toBe('POST');
    expect(rpc.body).toEqual({
      p_account: 'account-1',
      p_thread_key: 'thread-9',
      p_references: ['<root@mail>', '<prior@mail>'],
      p_at: '2026-09-09T11:30:00.000Z',
    });
    expect(result).toEqual({ accepted: 2, duplicates: 0, drained: 2 });
  });

  it('drains even when the outbound message was already stored, so a re-seed still clears', async () => {
    // The insert reports zero accepted rows because the message is a duplicate. Reply detection
    // must not ride on that: a re-seed after a lost cursor re-delivers the owner's own replies,
    // and those are exactly the rows that should clear a queue nobody has drained.
    const calls = mockSupabase((call) =>
      call.url.includes('/rpc/') ? Response.json(3) : Response.json([]),
    );

    const result = await ingestMessages(
      env,
      account({ owner_handles: ['owner@example.com'] }),
      [message({ sender_handle: 'owner@example.com' })],
      NOW,
    );

    expect(calls.filter((call) => call.url.includes('/rpc/'))).toHaveLength(1);
    expect(result).toEqual({ accepted: 0, duplicates: 1, drained: 3 });
  });

  it('never calls the drain for a batch that is entirely inbound', async () => {
    const calls = mockSupabase(() => Response.json([{ id: 'message-1' }]));

    await ingestMessages(env, account(), [message()], NOW);

    expect(calls.filter((call) => call.url.includes('/rpc/'))).toEqual([]);
  });

  it('drains one thread at a time rather than all at once', async () => {
    // Sequential, like every other loop in the Worker: each drain is an UPDATE over the same
    // account's rows, and firing them together makes the database referee an interleaving that
    // nobody needs. There is never enough of a batch for the latency to matter.
    let inFlight = 0;
    let peak = 0;
    spyOnFetch().mockImplementation(async (input) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return (input as string).includes('/rpc/') ? Response.json(1) : Response.json([]);
    });

    const result = await ingestMessages(
      env,
      account({ owner_handles: ['owner@example.com'] }),
      [
        message({ source_id: 'a', sender_handle: 'owner@example.com', thread_key: 't1' }),
        message({ source_id: 'b', sender_handle: 'owner@example.com', thread_key: 't2' }),
        message({ source_id: 'c', sender_handle: 'owner@example.com', thread_key: 't3' }),
      ],
      NOW,
    );

    expect(peak).toBe(1);
    expect(result.drained).toBe(3);
  });

  it('clamps a reply timestamped in the future back to now', async () => {
    // The drain clears every queued row that arrived BEFORE the reply was sent, so a source with
    // a skewed clock (a laptop, or a header the sender wrote) could otherwise clear a whole
    // queue that has not happened yet.
    const calls = mockSupabase((call) =>
      call.url.includes('/rpc/') ? Response.json(1) : Response.json([]),
    );

    await ingestMessages(
      env,
      account({ owner_handles: ['owner@example.com'] }),
      [message({ sender_handle: 'owner@example.com', received_at: '2027-01-01T00:00:00.000Z' })],
      NOW,
    );

    const [, rpc] = calls as [Call, Call];
    expect(rpc.body).toEqual(expect.objectContaining({ p_at: '2026-09-09T12:00:00.000Z' }));
  });
});

describe('fetchUnjudgedMessages', () => {
  it('reads inbound, unjudged rows under the attempt ceiling, oldest first', async () => {
    const calls = mockSupabase(() => Response.json([]));

    await fetchUnjudgedMessages(env, { limit: 10, attemptCeiling: 5 });

    const [call] = calls as [Call];
    expect(call.url).toContain('/rest/v1/comm_messages');
    expect(query(call).get('direction')).toBe('eq.inbound');
    expect(query(call).get('tier')).toBe('is.null');
    expect(query(call).get('classify_attempts')).toBe('lt.5');
    expect(query(call).get('order')).toBe('received_at.asc');
    expect(query(call).get('limit')).toBe('10');
  });

  it('maps a stored row onto the message shape, nulls included', async () => {
    mockSupabase(() =>
      Response.json([
        {
          id: 'message-1',
          account_id: 'account-1',
          source_id: 'guid-1',
          rfc822_message_id: WIRE_NULL,
          thread_key: 'chat-7',
          direction: 'inbound',
          sender_handle: '+15125559999',
          sender_name: WIRE_NULL,
          chat_name: WIRE_NULL,
          participants: [],
          subject: WIRE_NULL,
          body: 'hello',
          received_at: '2026-09-09T11:00:00.000Z',
          body_extracted: true,
          has_attachments: false,
          in_reply_to: WIRE_NULL,
          references_ids: [],
          filtered_reason: WIRE_NULL,
          classify_attempts: 2,
          tier: WIRE_NULL,
          judged_by: WIRE_NULL,
          ask: WIRE_NULL,
          verdict_id: WIRE_NULL,
          classified_at: WIRE_NULL,
          reclassify_requested_at: WIRE_NULL,
          cleared_at: WIRE_NULL,
          cleared_by: WIRE_NULL,
          inbox_item_id: WIRE_NULL,
          created_at: '2026-09-09T11:00:01.000Z',
        },
      ]),
    );

    const [found] = await fetchUnjudgedMessages(env, { limit: 10, attemptCeiling: 5 });

    expect(found).toEqual({
      id: 'message-1',
      account_id: 'account-1',
      source_id: 'guid-1',
      rfc822_message_id: undefined,
      thread_key: 'chat-7',
      direction: 'inbound',
      sender_handle: '+15125559999',
      sender_name: undefined,
      chat_name: undefined,
      participants: [],
      subject: undefined,
      body: 'hello',
      received_at: '2026-09-09T11:00:00.000Z',
      body_extracted: true,
      has_attachments: false,
      in_reply_to: undefined,
      references_ids: [],
      filtered_reason: undefined,
      classify_attempts: 2,
      tier: undefined,
      judged_by: undefined,
      ask: undefined,
      verdict_id: undefined,
      classified_at: undefined,
      reclassify_requested_at: undefined,
      cleared_at: undefined,
      cleared_by: undefined,
      inbox_item_id: undefined,
      created_at: '2026-09-09T11:00:01.000Z',
    });
  });
});

describe('fetchReclassifyRequests', () => {
  it('reads the rows the owner asked to re-run, oldest request first', async () => {
    const calls = mockSupabase(() => Response.json([]));

    await fetchReclassifyRequests(env, { limit: 4 });

    const [call] = calls as [Call];
    expect(query(call).get('reclassify_requested_at')).toBe('not.is.null');
    expect(query(call).get('direction')).toBe('eq.inbound');
    expect(query(call).get('order')).toBe('reclassify_requested_at.asc');
    expect(query(call).get('limit')).toBe('4');
  });
});

describe('fetchUnjudgedAtCeiling', () => {
  it('reads the rows that have exhausted their attempts and still have no tier', async () => {
    const calls = mockSupabase(() => Response.json([]));

    await fetchUnjudgedAtCeiling(env, { attemptCeiling: 5, limit: 10 });

    const [call] = calls as [Call];
    expect(query(call).get('tier')).toBe('is.null');
    expect(query(call).get('direction')).toBe('eq.inbound');
    expect(query(call).get('classify_attempts')).toBe('gte.5');
  });
});

describe('patchMessage', () => {
  it('patches by id and reports how many rows matched', async () => {
    const calls = mockSupabase(() => Response.json([{ id: 'message-1' }]));

    const matched = await patchMessage(env, 'message-1', { classify_attempts: 3 });

    const [call] = calls as [Call];
    expect(call.method).toBe('PATCH');
    expect(query(call).get('id')).toBe('eq.message-1');
    expect(query(call).get('tier')).toBeNull();
    expect(call.body).toEqual({ classify_attempts: 3 });
    expect(matched).toBe(1);
  });

  it('narrows to still-unjudged rows on request, so a late verdict cannot overwrite one', async () => {
    // Scheduled invocations are not serialized, so a slow tick can overlap the next one and both
    // read the same unjudged rows. With the filter the loser matches nothing instead of writing
    // a second verdict over the first.
    const calls = mockSupabase(() => Response.json([]));

    const matched = await patchMessage(
      env,
      'message-1',
      { tier: 'today' },
      { onlyIfUnjudged: true },
    );

    const [call] = calls as [Call];
    expect(query(call).get('tier')).toBe('is.null');
    expect(matched).toBe(0);
  });
});

describe('insertVerdict', () => {
  it('inserts the verdict and returns its new id', async () => {
    const calls = mockSupabase(() => Response.json([{ id: 'verdict-1' }]));

    const id = await insertVerdict(env, {
      message_id: 'message-1',
      tier: 'today',
      owes_reply: true,
      ask: 'approve the invoice',
      reason: 'Dana is waiting on it',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      prompt_version: 1,
      rubric_version: 3,
      example_set_version: 7,
    });

    const [call] = calls as [Call];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/rest/v1/comm_verdicts');
    expect(id).toBe('verdict-1');
  });

  it('throws when the insert reports no row, rather than returning an id nothing has', async () => {
    expect.assertions(1);
    mockSupabase(() => Response.json([]));

    await expect(
      insertVerdict(env, {
        message_id: 'message-1',
        tier: 'fyi',
        owes_reply: false,
        ask: 'nothing',
        reason: 'a newsletter',
        provider: 'anthropic',
        model: 'claude-haiku-4-5',
        prompt_version: 1,
        rubric_version: 3,
        example_set_version: 7,
      }),
    ).rejects.toThrow('returned no row');
  });
});

describe('fetchCurrentRubric', () => {
  it('reads the highest version, since the table is append-only', async () => {
    const calls = mockSupabase(() =>
      Response.json([
        { id: 'rubric-3', version: 3, body: 'answer what it asks', created_at: '2026-09-01' },
      ]),
    );

    const rubric = await fetchCurrentRubric(env);

    const [call] = calls as [Call];
    expect(query(call).get('order')).toBe('version.desc');
    expect(query(call).get('limit')).toBe('1');
    expect(rubric?.version).toBe(3);
  });

  it('returns undefined before any rubric has been written', async () => {
    mockSupabase(() => Response.json([]));
    await expect(fetchCurrentRubric(env)).resolves.toBeUndefined();
  });
});

describe('fetchPeople', () => {
  it('reads each person with the handles that resolve to them', async () => {
    // One human is a phone number in iMessage and an address in two mailboxes, so the roster is
    // read as a person with many handles rather than as a list of addresses.
    const calls = mockSupabase(() =>
      Response.json([
        {
          id: 'person-1',
          name: 'Dana',
          priority: 'high',
          notes: WIRE_NULL,
          comm_handles: [
            { handle: 'dana@example.com', kind: 'email' },
            { handle: '+15125550100', kind: 'phone' },
          ],
        },
      ]),
    );

    const people = await fetchPeople(env);

    const [call] = calls as [Call];
    expect(query(call).get('select')).toBe('*,comm_handles(handle,kind)');
    expect(people).toEqual([
      {
        id: 'person-1',
        name: 'Dana',
        priority: 'high',
        notes: undefined,
        handles: [
          { handle: 'dana@example.com', kind: 'email' },
          { handle: '+15125550100', kind: 'phone' },
        ],
      },
    ]);
  });
});

describe('fetchExamples', () => {
  it('reads unpruned, unpurged corrections that still carry their text, newest first', async () => {
    // A pruned example steers badly and a purged one has lost its text; either would be a
    // few-shot example with nothing to teach.
    const calls = mockSupabase(() => Response.json([]));

    await fetchExamples(env, { limit: 12 });

    const [call] = calls as [Call];
    expect(call.url).toContain('/rest/v1/comm_corrections');
    expect(query(call).get('pruned_at')).toBe('is.null');
    expect(query(call).get('purged_at')).toBe('is.null');
    expect(query(call).get('body_excerpt')).toBe('not.is.null');
    expect(query(call).get('order')).toBe('created_at.desc');
    expect(query(call).get('limit')).toBe('12');
  });

  it('maps a correction row onto the example shape', async () => {
    mockSupabase(() =>
      Response.json([
        {
          id: 'correction-1',
          sender_handle: 'dana@example.com',
          sender_name: WIRE_NULL,
          account_label: 'Gmail — personal',
          subject: 'Q3 invoice',
          body_excerpt: 'can you approve',
          model_tier: WIRE_NULL,
          chosen_tier: 'today',
          kind: 'tier_change',
          created_at: '2026-09-02T00:00:00.000Z',
        },
      ]),
    );

    const examples = await fetchExamples(env, { limit: 12 });

    expect(examples).toEqual([
      {
        id: 'correction-1',
        sender_handle: 'dana@example.com',
        sender_name: undefined,
        account_label: 'Gmail — personal',
        subject: 'Q3 invoice',
        body_excerpt: 'can you approve',
        model_tier: undefined,
        chosen_tier: 'today',
        kind: 'tier_change',
        created_at: '2026-09-02T00:00:00.000Z',
      },
    ]);
  });
});

describe('fetchExampleSetVersion', () => {
  it('asks the database for the version, so no writer can disagree about the count', async () => {
    const calls = mockSupabase(() => Response.json(7));

    const version = await fetchExampleSetVersion(env);

    const [call] = calls as [Call];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/rest/v1/rpc/comm_example_set_version');
    expect(call.body).toEqual({});
    expect(version).toBe(7);
  });
});

describe('recordClassifierRun', () => {
  it('records a successful run against the single health row', async () => {
    const calls = mockSupabase(() => Response.json([{ id: 1 }]));

    await recordClassifierRun(env, { at: NOW, ok: true });

    const [call] = calls as [Call];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/rest/v1/comm_classifier_health');
    expect(query(call).get('on_conflict')).toBe('id');
    expect(call.prefer).toBe('resolution=merge-duplicates,return=representation');
    expect(call.body).toEqual([
      {
        id: 1,
        last_run_at: '2026-09-09T12:00:00.000Z',
        last_success_at: '2026-09-09T12:00:00.000Z',
      },
    ]);
  });

  it('records a failed run without clearing the last success it had', async () => {
    // "Stalled since" is the reading that matters: an error newer than the last success is what
    // says ingestion is healthy and judgment has stopped.
    const calls = mockSupabase(() => Response.json([{ id: 1 }]));

    await recordClassifierRun(env, { at: NOW, ok: false, error: 'ANTHROPIC_API_KEY is not set' });

    const [call] = calls as [Call];
    expect(call.body).toEqual([
      {
        id: 1,
        last_run_at: '2026-09-09T12:00:00.000Z',
        last_error: 'ANTHROPIC_API_KEY is not set',
        last_error_at: '2026-09-09T12:00:00.000Z',
      },
    ]);
  });
});

describe('sweepExpired', () => {
  it('asks the database to delete everything past the retention window', async () => {
    const calls = mockSupabase(() => Response.json(41));

    const deleted = await sweepExpired(env, 60);

    const [call] = calls as [Call];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/rest/v1/rpc/comm_sweep_expired');
    expect(call.body).toEqual({ p_days: 60 });
    expect(deleted).toBe(41);
  });

  it('throws the shared failure shape when the sweep is rejected', async () => {
    expect.assertions(1);
    mockSupabase(() => new Response('permission denied', { status: 403 }));

    await expect(sweepExpired(env, 60)).rejects.toThrow(
      'Supabase POST rpc/comm_sweep_expired failed: 403 permission denied',
    );
  });
});
