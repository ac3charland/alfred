import { spyOnFetch } from '../fetch-stub';
import { hmacSha256Hex } from '../hmac';
import { type IngestEnv, handleIngest } from './ingest';

const SECRET = 'the-daemon-and-the-worker-share-this';

const env: IngestEnv = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  COMMS_INGEST_HMAC_SECRET: SECRET,
};

const NOW = new Date('2026-09-15T00:00:00.000Z');

/** A JSON `null`. The wire speaks it (the daemon sends one for "no cursor"); this package doesn't. */
const WIRE_NULL: unknown = JSON.parse('null');

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/**
 * Answer the endpoint's Supabase traffic: the account upsert returns the stored account, the
 * message insert reports what it accepted, and the drain reports what it cleared.
 */
function mockSupabase(
  options: {
    account?: Record<string, unknown>;
    inserted?: unknown[];
    drained?: number;
    people?: unknown[];
    stored?: { id: string; source_id: string }[];
  } = {},
): Call[] {
  const calls: Call[] = [];
  spyOnFetch().mockImplementation((input, init) => {
    const url = input as string;
    const rawBody = init?.body;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof rawBody === 'string' ? JSON.parse(rawBody) : undefined,
    });

    if (url.includes('/rest/v1/comm_accounts')) {
      return Promise.resolve(Response.json([options.account ?? accountRow()]));
    }
    if (url.includes('/rpc/comm_record_reply')) {
      return Promise.resolve(Response.json(options.drained ?? 0));
    }
    if (url.includes('/rest/v1/comm_people')) {
      return Promise.resolve(Response.json(options.people ?? []));
    }
    if (url.includes('/rest/v1/comm_messages')) {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return Promise.resolve(Response.json(options.stored ?? []));
      if (method === 'PATCH') return Promise.resolve(Response.json([{ id: 'message-1' }]));
      return Promise.resolve(Response.json(options.inserted ?? [{ id: 'message-1' }]));
    }
    return Promise.resolve(Response.json([]));
  });
  return calls;
}

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

/** One wire message, as the daemon normalizes it. */
function wireMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source_id: 'guid-1',
    thread_key: 'chat-7',
    direction: 'inbound',
    sender_handle: '+15125559999',
    participants: ['+15125559999', '+15125550123'],
    body: 'can you send the invoice',
    received_at: '2026-09-14T23:00:00.000Z',
    body_extracted: true,
    has_attachments: false,
    references_ids: [],
    ...overrides,
  };
}

/** A whole payload, with every part the contract requires. */
function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    account: {
      key: 'imessage',
      kind: 'imessage',
      label: 'iMessage',
      owner_handles: ['+15125550123'],
      expected_interval_seconds: 300,
    },
    heartbeat: { ok: true, cursor: { rowid: 812 }, error: WIRE_NULL },
    messages: [wireMessage()],
    ...overrides,
  };
}

/**
 * Build the request the daemon builds: the raw body, the unix-second timestamp, and a signature
 * over `${timestamp}.${body}`. Deliberately signs the way the other end will, so the test fails
 * if either side of the contract moves.
 */
async function signedRequest(
  body: unknown,
  options: { timestamp?: number; secret?: string; signature?: string } = {},
): Promise<Request> {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const timestamp = options.timestamp ?? Math.floor(NOW.getTime() / 1000);
  const secret = options.secret ?? SECRET;
  const signature =
    options.signature ?? `sha256=${await hmacSha256Hex(secret, `${String(timestamp)}.${raw}`)}`;

  return new Request('https://worker.dev/comms/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Alfred-Timestamp': String(timestamp),
      'X-Alfred-Signature': signature,
    },
    body: raw,
  });
}

describe('handleIngest — the signature gate', () => {
  it('rejects an unsigned request without touching the database', async () => {
    // Verification comes first, before the body is even parsed: an endpoint that writes before it
    // checks is an endpoint anyone can write to.
    const calls = mockSupabase();
    const request = new Request('https://worker.dev/comms/ingest', {
      method: 'POST',
      body: JSON.stringify(payload()),
    });

    const response = await handleIngest(request, env, NOW);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'missing signature' });
    expect(calls).toEqual([]);
  });

  it('rejects a signature computed with the wrong secret', async () => {
    const calls = mockSupabase();
    const request = await signedRequest(payload(), { secret: 'not-the-secret' });

    const response = await handleIngest(request, env, NOW);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'invalid signature' });
    expect(calls).toEqual([]);
  });

  it('rejects a body that was altered after it was signed', async () => {
    const calls = mockSupabase();
    const signed = await signedRequest(payload());
    const tampered = new Request(signed, {
      method: 'POST',
      body: JSON.stringify(payload({ version: 1, foo: 1 })),
    });

    const response = await handleIngest(tampered, env, NOW);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'invalid signature' });
    expect(calls).toEqual([]);
  });

  it('rejects a correctly-signed request replayed outside the window', async () => {
    // This is the whole reason the timestamp is inside the signature: a captured request stays
    // perfectly valid bytes, and only the clock can refuse it.
    const calls = mockSupabase();
    const request = await signedRequest(payload(), {
      timestamp: Math.floor(NOW.getTime() / 1000) - 3600,
    });

    const response = await handleIngest(request, env, NOW);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'stale timestamp' });
    expect(calls).toEqual([]);
  });

  it('reports that ingest is unconfigured when the secret binding has never been set', async () => {
    // Until someone runs `wrangler secret put` there is nothing to verify against, and an
    // endpoint that cannot verify must not accept — least of all silently.
    const calls = mockSupabase();
    const { COMMS_INGEST_HMAC_SECRET: _unset, ...withoutSecret } = env;
    const request = await signedRequest(payload());

    const response = await handleIngest(request, withoutSecret, NOW);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'ingest is not configured' });
    expect(calls).toEqual([]);
  });
});

describe('handleIngest — the happy path', () => {
  it('registers the account, stamps the poll, stores the batch and drains the replies', async () => {
    const calls = mockSupabase({ inserted: [{ id: 'a' }, { id: 'b' }], drained: 2 });
    const request = await signedRequest(
      payload({
        messages: [
          wireMessage(),
          wireMessage({
            source_id: 'guid-2',
            sender_handle: '+15125550123',
            received_at: '2026-09-14T23:30:00.000Z',
          }),
        ],
      }),
    );

    const response = await handleIngest(request, env, NOW);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({
      accepted: 2,
      duplicates: 0,
      drained: 2,
      cursor: { rowid: 812 },
      last_seen_at: '2026-09-15T00:00:00.000Z',
    });

    // Storage first, health second: the batch is inserted (and its reply drained) BEFORE the
    // heartbeat is stamped, so a storage failure never gets the chance to stamp a health record
    // for a batch that didn't actually land.
    const [upsert, insert, drain, heartbeat] = calls as [Call, Call, Call, Call];
    expect(upsert.url).toContain('/rest/v1/comm_accounts');
    expect(upsert.body).toEqual([
      {
        key: 'imessage',
        kind: 'imessage',
        label: 'iMessage',
        // The daemon's accounts are polled on the Mac; the Worker only receives them.
        home: 'daemon',
        owner_handles: ['+15125550123'],
        expected_interval_seconds: 300,
      },
    ]);
    expect(insert.url).toContain('/rest/v1/comm_messages');
    expect(drain.url).toContain('/rpc/comm_record_reply');
    expect(drain.body).toEqual(
      expect.objectContaining({ p_thread_key: 'chat-7', p_at: '2026-09-14T23:30:00.000Z' }),
    );
    expect(heartbeat.method).toBe('PATCH');
    expect(heartbeat.url).toContain('/rest/v1/comm_accounts');
    expect(heartbeat.body).toEqual({
      last_seen_at: '2026-09-15T00:00:00.000Z',
      cursor: { rowid: 812 },
    });
  });

  it('accepts a heartbeat carrying no messages at all', async () => {
    // A zero-message heartbeat is a first-class payload, not a degenerate one: the daemon
    // coalesces liveness to about once a minute, and most of those minutes are quiet. Without
    // this the health strip could not tell a quiet Mac from a sleeping one.
    const calls = mockSupabase();
    const request = await signedRequest(payload({ messages: [] }));

    const response = await handleIngest(request, env, NOW);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accepted: 0,
      duplicates: 0,
      drained: 0,
      cursor: { rowid: 812 },
      last_seen_at: '2026-09-15T00:00:00.000Z',
    });
    expect(calls.filter((call) => call.url.includes('/rest/v1/comm_messages'))).toEqual([]);
  });

  it('reports the stored cursor when the daemon has none yet', async () => {
    mockSupabase();
    const request = await signedRequest(
      payload({ heartbeat: { ok: true, cursor: WIRE_NULL, error: WIRE_NULL }, messages: [] }),
    );

    const response = await handleIngest(request, env, NOW);

    expect(await response.json()).toEqual({
      accepted: 0,
      duplicates: 0,
      drained: 0,
      // JSON null, not an absent key: the daemon reads this field to decide whether to seed.
      cursor: WIRE_NULL,
      last_seen_at: '2026-09-15T00:00:00.000Z',
    });
  });

  it('counts a message it has already stored as a duplicate rather than an error', async () => {
    mockSupabase({ inserted: [] });
    const request = await signedRequest(payload());

    const response = await handleIngest(request, env, NOW);

    expect(await response.json()).toEqual(expect.objectContaining({ accepted: 0, duplicates: 1 }));
  });
});

describe('handleIngest — a failed poll', () => {
  it('stamps the error and leaves last_seen_at where it was', async () => {
    const calls = mockSupabase({
      account: accountRow({ last_seen_at: '2026-09-14T22:00:00.000Z' }),
    });
    const request = await signedRequest(
      payload({
        heartbeat: { ok: false, cursor: WIRE_NULL, error: 'Full Disk Access revoked' },
        messages: [],
      }),
    );

    const response = await handleIngest(request, env, NOW);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accepted: 0,
      duplicates: 0,
      drained: 0,
      cursor: WIRE_NULL,
      // The account's own last success, untouched — a broken source must not read as a live one.
      last_seen_at: '2026-09-14T22:00:00.000Z',
    });
    const [, heartbeat] = calls as [Call, Call];
    expect(heartbeat.body).toEqual({
      last_error: 'Full Disk Access revoked',
      last_error_at: '2026-09-15T00:00:00.000Z',
    });
  });

  it('records something legible when the daemon reports a failure with no message', async () => {
    const calls = mockSupabase();
    const request = await signedRequest(
      payload({ heartbeat: { ok: false, cursor: WIRE_NULL, error: WIRE_NULL }, messages: [] }),
    );

    await handleIngest(request, env, NOW);

    const [, heartbeat] = calls as [Call, Call];
    expect(heartbeat.body).toEqual(
      expect.objectContaining({ last_error: 'the daemon reported a failed poll with no message' }),
    );
  });

  it('still stores the messages a failed poll managed to collect, and still reports the failure', async () => {
    // A poll that read some messages and then broke has both a failure to report and rows worth
    // keeping. Dropping either would be a false negative caused by the error handling — the rows
    // by never storing them, the failure by letting a later storage step's exception swallow it.
    const calls = mockSupabase();
    const request = await signedRequest(
      payload({ heartbeat: { ok: false, cursor: WIRE_NULL, error: 'IMAP connection reset' } }),
    );

    const response = await handleIngest(request, env, NOW);

    expect(response.status).toBe(200);
    expect(calls.filter((call) => call.url.includes('/rest/v1/comm_messages'))).toHaveLength(1);
    const heartbeatCall = calls.find(
      (call) => call.method === 'PATCH' && call.url.includes('/rest/v1/comm_accounts'),
    );
    expect(heartbeatCall?.body).toEqual({
      last_error: 'IMAP connection reset',
      last_error_at: NOW.toISOString(),
    });
  });
});

/** Sign and send `body`, and hand back the status and the message it was refused with. */
async function reject(body: unknown): Promise<{ status: number; error: unknown }> {
  mockSupabase();
  const request = await signedRequest(body);
  const response = await handleIngest(request, env, NOW);
  // The generic rather than a cast: `--fix` strips a redundant-looking assertion here.
  const parsed = await response.json<{ error: unknown }>();
  return { status: response.status, error: parsed.error };
}

describe('handleIngest — body validation', () => {
  it('rejects a body that is not JSON', async () => {
    await expect(reject('not json at all')).resolves.toEqual({
      status: 400,
      error: 'body must be valid JSON',
    });
  });

  it('rejects a body that is not an object', async () => {
    await expect(reject([1, 2, 3])).resolves.toEqual({
      status: 400,
      error: 'body must be a JSON object',
    });
  });

  it('rejects a payload from a version this endpoint does not speak', async () => {
    await expect(reject(payload({ version: 2 }))).resolves.toEqual({
      status: 400,
      error: 'version must be 1',
    });
  });

  it('rejects an account of an unknown kind', async () => {
    const bad = payload();
    await expect(
      reject({ ...bad, account: { ...(bad['account'] as object), kind: 'telepathy' } }),
    ).resolves.toEqual({ status: 400, error: 'account.kind must be one of gmail, imap, imessage' });
  });

  it('rejects an account with no key', async () => {
    const bad = payload();
    await expect(
      reject({ ...bad, account: { ...(bad['account'] as object), key: '' } }),
    ).resolves.toEqual({ status: 400, error: 'account.key must be a non-empty string' });
  });

  it('rejects owner handles that are not all strings', async () => {
    const bad = payload();
    await expect(
      reject({ ...bad, account: { ...(bad['account'] as object), owner_handles: ['a', 7] } }),
    ).resolves.toEqual({ status: 400, error: 'account.owner_handles must be an array of strings' });
  });

  it('rejects a heartbeat without a verdict on the poll', async () => {
    await expect(
      reject(payload({ heartbeat: { cursor: WIRE_NULL, error: WIRE_NULL } })),
    ).resolves.toEqual({ status: 400, error: 'heartbeat.ok must be a boolean' });
  });

  it('rejects messages that are not a list', async () => {
    await expect(reject(payload({ messages: 'one message' }))).resolves.toEqual({
      status: 400,
      error: 'messages must be an array',
    });
  });

  it('names the message that failed, so a bad row is findable in a batch', async () => {
    await expect(
      reject(payload({ messages: [wireMessage(), wireMessage({ source_id: 7 })] })),
    ).resolves.toEqual({ status: 400, error: 'messages[1].source_id must be a non-empty string' });
  });

  it('rejects a direction outside the two that exist', async () => {
    await expect(
      reject(payload({ messages: [wireMessage({ direction: 'sideways' })] })),
    ).resolves.toEqual({
      status: 400,
      error: 'messages[0].direction must be one of inbound, outbound',
    });
  });

  it('rejects a received_at that is not a timestamp', async () => {
    await expect(
      reject(payload({ messages: [wireMessage({ received_at: 'last tuesday' })] })),
    ).resolves.toEqual({
      status: 400,
      error: 'messages[0].received_at must be an ISO 8601 timestamp',
    });
  });

  it('rejects a decode flag that is not a boolean', async () => {
    await expect(
      reject(payload({ messages: [wireMessage({ body_extracted: 'yes' })] })),
    ).resolves.toEqual({ status: 400, error: 'messages[0].body_extracted must be a boolean' });
  });

  it('rejects a references list that is not all strings', async () => {
    await expect(
      reject(payload({ messages: [wireMessage({ references_ids: [{}] })] })),
    ).resolves.toEqual({
      status: 400,
      error: 'messages[0].references_ids must be an array of strings',
    });
  });

  it('rejects a body that is not text', async () => {
    await expect(reject(payload({ messages: [wireMessage({ body: 42 })] }))).resolves.toEqual({
      status: 400,
      error: 'messages[0].body must be a string when present',
    });
  });

  it('accepts an empty body, which is what a message that would not decode leaves behind', async () => {
    // A failed decode is stored, never skipped — so an empty body is a legal row, and rejecting
    // it here would turn the daemon's honest report into a dropped message.
    mockSupabase();
    const request = await signedRequest(
      payload({ messages: [wireMessage({ body: '', body_extracted: false })] }),
    );

    const response = await handleIngest(request, env, NOW);

    expect(response.status).toBe(200);
  });

  it('accepts absent optional fields and JSON nulls alike', async () => {
    // The daemon writes what a source gave it, and a source with no subject may send either.
    mockSupabase();
    const request = await signedRequest(
      payload({
        messages: [
          wireMessage({
            subject: WIRE_NULL,
            sender_name: WIRE_NULL,
            rfc822_message_id: WIRE_NULL,
            chat_name: WIRE_NULL,
            in_reply_to: WIRE_NULL,
          }),
        ],
      }),
    );

    const response = await handleIngest(request, env, NOW);

    expect(response.status).toBe(200);
  });
});

/** A wire message the daemon flagged as bulk mail: list headers present, sender off the roster. */
function bulkMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return wireMessage({
    source_id: '<digest-1@lists.example.com>',
    sender_handle: 'news@lists.example.com',
    list_headers: ['list-unsubscribe', 'list-id'],
    ...overrides,
  });
}

/** The PATCH that shelves a filtered message, if the handler made one. */
function filterPatch(calls: Call[]): Call | undefined {
  return calls.find(
    (call) => call.method === 'PATCH' && call.url.includes('/rest/v1/comm_messages'),
  );
}

describe('handleIngest — bulk mail the daemon flagged', () => {
  it('shelves a newsletter from a sender who is not on the roster, with no verdict', async () => {
    const calls = mockSupabase({
      stored: [{ id: 'message-9', source_id: '<digest-1@lists.example.com>' }],
    });

    const response = await handleIngest(
      await signedRequest(
        payload({ messages: [bulkMessage({ subject: 'Your November digest is here' })] }),
      ),
      env,
      NOW,
    );

    expect(response.status).toBe(200);
    const patch = filterPatch(calls);
    expect(patch?.url).toContain('id=eq.message-9');
    expect(patch?.url).toContain('tier=is.null');
    expect(patch?.body).toEqual({
      tier: 'fyi',
      judged_by: 'filter',
      filtered_reason: 'newsletter',
      classified_at: NOW.toISOString(),
    });
    // The insert never carried the header names: they are not a column.
    const insert = calls.find(
      (call) => call.method === 'POST' && call.url.includes('/rest/v1/comm_messages'),
    );
    expect(JSON.stringify(insert?.body)).not.toContain('list_headers');
  });

  it('never shelves a bulk candidate when the daemon reported no subject at all', async () => {
    // The fail-safe in `isNewsletter`: absence of a checkable subject is never treated as evidence
    // the message is safe to shelve. A real obligation with no subject line — or a source that
    // simply cannot decode one — must still reach the classifier, not vanish onto the shelf.
    const calls = mockSupabase({
      stored: [{ id: 'message-9', source_id: '<digest-1@lists.example.com>' }],
    });

    const response = await handleIngest(
      await signedRequest(payload({ messages: [bulkMessage()] })),
      env,
      NOW,
    );

    expect(response.status).toBe(200);
    expect(filterPatch(calls)).toBeUndefined();
  });

  it('never filters a sender on the roster, whatever the headers say', async () => {
    const calls = mockSupabase({
      people: [
        {
          id: 'person-1',
          name: 'Dana',
          priority: 'high',
          notes: WIRE_NULL,
          comm_handles: [{ handle: 'news@lists.example.com', kind: 'email' }],
        },
      ],
      stored: [{ id: 'message-9', source_id: '<digest-1@lists.example.com>' }],
    });

    await handleIngest(await signedRequest(payload({ messages: [bulkMessage()] })), env, NOW);

    expect(filterPatch(calls)).toBeUndefined();
  });

  it('treats a lone precedence header as no signal at all', async () => {
    const calls = mockSupabase();

    await handleIngest(
      await signedRequest(payload({ messages: [bulkMessage({ list_headers: ['precedence'] })] })),
      env,
      NOW,
    );

    expect(filterPatch(calls)).toBeUndefined();
    expect(calls.some((call) => call.url.includes('/rest/v1/comm_people'))).toBe(false);
  });

  it('leaves an outbound message alone even when it carries list headers', async () => {
    const calls = mockSupabase();

    await handleIngest(
      await signedRequest(payload({ messages: [bulkMessage({ direction: 'outbound' })] })),
      env,
      NOW,
    );

    expect(filterPatch(calls)).toBeUndefined();
  });

  it('rejects list headers that are not all strings', async () => {
    mockSupabase();

    const response = await handleIngest(
      await signedRequest(payload({ messages: [bulkMessage({ list_headers: [1] })] })),
      env,
      NOW,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'messages[0].list_headers must be an array of strings when present',
    });
  });
});

describe('handleIngest — a database failure', () => {
  it('answers 503 rather than an opaque crash, so the daemon knows to keep its cursor', async () => {
    spyOnFetch().mockImplementation(() =>
      Promise.resolve(new Response('connection refused', { status: 500 })),
    );
    const logged: string[] = [];
    jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    const request = await signedRequest(payload());

    const response = await handleIngest(request, env, NOW);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'ingest failed' });
    // The detail belongs in the Worker's log, not in the reply — but it has to exist somewhere.
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('comms ingest failed');
  });
});

describe('handleIngest — a storage failure must never stamp health', () => {
  it('leaves comm_accounts unstamped when storing the batch throws', async () => {
    // The exact reviewer repro: the account upsert (and, if it were reached, the heartbeat PATCH)
    // both succeed — only the message insert breaks, the way one bad row in the batch does, since
    // `ingestMessages` is a single atomic upsert for the whole request. A green health dot with a
    // dropped batch is the bug this test exists to catch: `last_seen_at` must not move when the
    // storage it is supposed to vouch for never landed.
    const calls: Call[] = [];
    const logged: string[] = [];
    jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    spyOnFetch().mockImplementation((input, init) => {
      const url = input as string;
      const method = init?.method ?? 'GET';
      const rawBody = init?.body;
      calls.push({
        url,
        method,
        body: typeof rawBody === 'string' ? JSON.parse(rawBody) : undefined,
      });
      if (url.includes('/rest/v1/comm_accounts')) {
        return Promise.resolve(Response.json([accountRow()]));
      }
      if (url.includes('/rest/v1/comm_messages') && method === 'POST') {
        return Promise.resolve(new Response('storage exploded', { status: 500 }));
      }
      return Promise.resolve(Response.json([]));
    });
    const request = await signedRequest(payload());

    const response = await handleIngest(request, env, NOW);

    expect(response.status).toBe(503);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('comms ingest failed');
    const accountWrites = calls.filter((call) => call.url.includes('/rest/v1/comm_accounts'));
    // Only the self-registering upsert — never the heartbeat PATCH that would stamp a fresh
    // `last_seen_at` over a batch that was actually dropped.
    expect(accountWrites).toEqual([expect.objectContaining({ method: 'POST' })]);
  });
});
