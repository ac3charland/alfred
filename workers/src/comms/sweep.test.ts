import * as classifier from '../classifier';
import { MAX_RETRIES, REQUEST_TIMEOUT_MS } from '../classifier';
import { spyOnFetch } from '../fetch-stub';
import { SWEEP_LIMIT } from '../sweep';
import { IMAGE_PLACEHOLDER } from './prompt';
import {
  COMMS_ATTEMPT_CEILING,
  COMMS_SWEEP_LIMIT,
  CONFIG_FAILURE,
  CREDENTIAL_FAILURE,
  type CommsSweepEnv,
  REQUEST_FAILURE,
  runCommsSweep,
} from './sweep';
import {
  type CommVerdict,
  REFUSAL_ASK,
  UNJUDGED_CEILING_ASK,
  UNJUDGED_DECODE_ASK,
} from './verdict';

const env: CommsSweepEnv = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  CLASSIFIER_MODEL: 'claude-haiku-4-5',
  CLASSIFIER_TIMEZONE: 'America/Chicago',
};

/** A fixed clock, so the provenance a sweep writes is assertable rather than merely present. */
const NOW = new Date('2026-09-09T15:00:00.000Z');

/**
 * A JSON `null`, which is how PostgREST spells an absent column. Produced rather than written,
 * because this package bans the `null` literal in source — the wire still speaks it.
 */
const WIRE_NULL: unknown = JSON.parse('null');

const ACCOUNT_ID = 'account-1';

/** One inbound message, as PostgREST hands it over: every nullable column explicitly null. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'message-1',
    account_id: ACCOUNT_ID,
    source_id: 'gmail-1',
    rfc822_message_id: WIRE_NULL,
    thread_key: 'thread-1',
    direction: 'inbound',
    sender_handle: 'dana@realplay.co',
    sender_name: 'Dana Whitfield',
    chat_name: WIRE_NULL,
    participants: [],
    subject: 'Q3 invoice',
    body: 'Can you approve the Q3 invoice before the 5pm billing run?',
    // An hour before NOW, so nothing is capped as backlog unless a test says so.
    received_at: '2026-09-09T14:00:00.000Z',
    body_extracted: true,
    has_attachments: false,
    has_list_header: false,
    in_reply_to: WIRE_NULL,
    references_ids: [],
    filtered_reason: WIRE_NULL,
    classify_attempts: 0,
    tier: WIRE_NULL,
    judged_by: WIRE_NULL,
    ask: WIRE_NULL,
    verdict_id: WIRE_NULL,
    classified_at: WIRE_NULL,
    reclassify_requested_at: WIRE_NULL,
    cleared_at: WIRE_NULL,
    cleared_by: WIRE_NULL,
    inbox_item_id: WIRE_NULL,
    created_at: '2026-09-09T14:00:05.000Z',
    ...overrides,
  };
}

function accountRow(): Record<string, unknown> {
  return {
    id: ACCOUNT_ID,
    key: 'gmail-realplay',
    kind: 'gmail',
    label: 'RealPlay',
    home: 'worker',
    owner_handles: ['owner@realplay.co'],
    enabled: true,
    expected_interval_seconds: 600,
    cursor: WIRE_NULL,
    last_seen_at: WIRE_NULL,
    last_error: WIRE_NULL,
    last_error_at: WIRE_NULL,
  };
}

function personRow(): Record<string, unknown> {
  return {
    id: 'person-1',
    name: 'Dana Whitfield',
    priority: 'high',
    notes: WIRE_NULL,
    comm_handles: [{ handle: 'dana@realplay.co', kind: 'email' }],
  };
}

function verdict(overrides: Partial<CommVerdict> = {}): CommVerdict {
  return {
    tier: 'today',
    owes_reply: true,
    ask: 'Approve the Q3 invoice before the 5pm billing run.',
    reason: 'A named deadline today from a colleague who is blocked.',
    ...overrides,
  };
}

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
}

interface MockOptions {
  unjudged?: Record<string, unknown>[];
  reruns?: Record<string, unknown>[];
  ceiling?: Record<string, unknown>[];
  people?: Record<string, unknown>[];
  rubric?: Record<string, unknown>[];
  patchRows?: () => unknown[];
  verdictFails?: boolean;
}

/**
 * Route the Worker's Supabase traffic. The three worklist queries differ only by their filters,
 * so they are told apart the same way PostgREST does — by the query string.
 */
function mockSupabase(options: MockOptions = {}): { calls: Call[] } {
  const calls: Call[] = [];
  spyOnFetch().mockImplementation((input, init) => {
    const url = input as string;
    const method = init?.method ?? 'GET';
    const rawBody = init?.body;
    calls.push({
      url,
      method,
      body:
        typeof rawBody === 'string' ? (JSON.parse(rawBody) as Record<string, unknown>) : undefined,
    });

    if (url.includes('/rest/v1/comm_messages?')) {
      if (method === 'PATCH') {
        return Promise.resolve(Response.json(options.patchRows?.() ?? [{ id: 'message-1' }]));
      }
      if (url.includes('reclassify_requested_at=not.is.null')) {
        return Promise.resolve(Response.json(options.reruns ?? []));
      }
      if (url.includes('classify_attempts=gte.')) {
        return Promise.resolve(Response.json(options.ceiling ?? []));
      }
      return Promise.resolve(Response.json(options.unjudged ?? []));
    }
    if (url.includes('/rest/v1/comm_accounts')) {
      return Promise.resolve(Response.json([accountRow()]));
    }
    if (url.includes('/rest/v1/comm_people')) {
      return Promise.resolve(Response.json(options.people ?? []));
    }
    if (url.includes('/rest/v1/comm_rubrics')) {
      return Promise.resolve(Response.json(options.rubric ?? []));
    }
    if (url.includes('/rest/v1/rpc/comm_example_set_version')) {
      return Promise.resolve(Response.json(7));
    }
    if (url.includes('/rest/v1/comm_verdicts')) {
      return options.verdictFails === true
        ? Promise.resolve(new Response('violates check constraint', { status: 400 }))
        : Promise.resolve(Response.json([{ id: 'verdict-1' }]));
    }
    return Promise.resolve(Response.json([]));
  });
  return { calls };
}

/** The spy over the one narrow function that talks to the model, typed so its recorded calls are
 *  readable — an untyped `jest.SpyInstance` makes every `mock.calls` read an `any`. */
type ClassifySpy = jest.SpyInstance<
  Promise<classifier.JsonOutcome>,
  Parameters<typeof classifier.classifyJson>
>;

/** Stub the one narrow function that talks to the model, so no test ever makes a live call. */
function mockClassify(...outcomes: classifier.JsonOutcome[]): ClassifySpy {
  const spy = jest.spyOn(classifier, 'classifyJson');
  for (const outcome of outcomes) spy.mockResolvedValueOnce(outcome);
  spy.mockResolvedValue(outcomes.at(-1) ?? { ok: verdict() });
  return spy;
}

const patches = (calls: Call[]): Call[] => calls.filter((call) => call.method === 'PATCH');

/**
 * The patch that determined message `id`'s final row state — the LAST one it was sent, not the
 * first. A judged-by-model write is now two patches (a freshness check, then the write itself),
 * so the last match is what every caller actually means by "the patch"; for every other path
 * there is only ever one match, so this is unchanged for them.
 *
 * Written as filter-then-index rather than `.findLast(...)`: this package's `lib` target is
 * ES2022 (`Array.prototype.findLast` is ES2023), so that reads as `any` and fails type-checking.
 */
const patchOf = (calls: Call[], id: string): Call | undefined => {
  const matching = patches(calls).filter((call) => call.url.includes(`id=eq.${id}`));
  return matching.at(-1);
};

const verdicts = (calls: Call[]): Call[] =>
  calls.filter((call) => call.url.includes('/rest/v1/comm_verdicts'));

const health = (calls: Call[]): Call[] =>
  calls.filter((call) => call.url.includes('/rest/v1/comm_classifier_health'));

/** Silence the sweep's own logging and hand back what it wrote. */
function captureErrors(): string[] {
  const lines: string[] = [];
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  return lines;
}

beforeEach(() => {
  captureErrors();
});

describe('the pre-flight checks', () => {
  it('spends nothing and stamps the classifier health when the key is missing', async () => {
    const { calls } = mockSupabase({ unjudged: [row()] });
    const classify = mockClassify();
    const logged = captureErrors();
    const { ANTHROPIC_API_KEY: _key, ...withoutKey } = env;

    const summary = await runCommsSweep(withoutKey, NOW);

    expect(classify).not.toHaveBeenCalled();
    expect(summary).toEqual({
      eligible: 0,
      classified: 0,
      failed: 0,
      parked: 0,
      aborted: true,
    });
    expect(logged.join(' ')).toContain(CREDENTIAL_FAILURE);
    // Ingestion is healthy and judgment has stalled: the health row is what says so in those
    // words, and it is the only write this tick makes.
    expect(health(calls)).toHaveLength(1);
    expect(health(calls)[0]?.body).toMatchObject([
      { id: 1, last_error: 'ANTHROPIC_API_KEY is not set' },
    ]);
    expect(calls.filter((call) => call.url.includes('comm_messages'))).toHaveLength(0);
  });

  it.each(['CLASSIFIER_MODEL', 'CLASSIFIER_TIMEZONE'] as const)(
    'makes no request when %s did not arrive on the deploy',
    async (name) => {
      const { calls } = mockSupabase({ unjudged: [row()] });
      const classify = mockClassify();
      const logged = captureErrors();
      const { [name]: _missing, ...withoutVar } = env;

      const summary = await runCommsSweep(withoutVar as CommsSweepEnv, NOW);

      expect(classify).not.toHaveBeenCalled();
      expect(summary.aborted).toBe(true);
      expect(logged.join(' ')).toContain(CONFIG_FAILURE);
      expect(logged.join(' ')).toContain(name);
      expect(health(calls)).toHaveLength(1);
    },
  );
});

describe('the worklist', () => {
  it('asks for inbound, unjudged messages under the attempt ceiling', async () => {
    const { calls } = mockSupabase({});

    await runCommsSweep(env, NOW);

    const query = calls.find((call) => call.url.includes('classify_attempts=lt.'));
    expect(query?.url).toContain('tier=is.null');
    expect(query?.url).toContain('direction=eq.inbound');
    expect(query?.url).toContain(`classify_attempts=lt.${String(COMMS_ATTEMPT_CEILING)}`);
    expect(query?.url).toContain(`limit=${String(COMMS_SWEEP_LIMIT)}`);
  });

  it('judges an explicit re-run before it judges new mail, and never twice', async () => {
    // Re-runs are rare and someone is waiting on one; new mail is not. A row can also be in both
    // lists at once — unjudged AND requested — and must be judged once.
    const requested = row({ id: 'requested', reclassify_requested_at: '2026-09-09T14:50:00.000Z' });
    const { calls } = mockSupabase({
      reruns: [requested],
      unjudged: [requested, row({ id: 'fresh' })],
    });
    const classify = mockClassify({ ok: verdict() });

    const summary = await runCommsSweep(env, NOW);

    expect(classify).toHaveBeenCalledTimes(2);
    expect(summary.classified).toBe(2);
    expect(verdicts(calls).map((call) => call.body)).toMatchObject([
      { message_id: 'requested' },
      { message_id: 'fresh' },
    ]);
  });

  it('never judges more messages in one tick than the cap', async () => {
    const many = Array.from({ length: 8 }, (_unused, index) =>
      row({ id: `unjudged-${String(index)}` }),
    );
    const requested = Array.from({ length: 8 }, (_unused, index) =>
      row({ id: `rerun-${String(index)}`, reclassify_requested_at: '2026-09-09T14:50:00.000Z' }),
    );
    mockSupabase({ unjudged: many, reruns: requested });
    const classify = mockClassify({ ok: verdict() });

    const summary = await runCommsSweep(env, NOW);

    expect(classify).toHaveBeenCalledTimes(COMMS_SWEEP_LIMIT);
    expect(summary.eligible).toBe(COMMS_SWEEP_LIMIT);
  });

  it('reads the rubric, roster and examples once for the whole tick', async () => {
    const { calls } = mockSupabase({ unjudged: [row({ id: 'a' }), row({ id: 'b' })] });
    mockClassify({ ok: verdict() });

    await runCommsSweep(env, NOW);

    expect(calls.filter((call) => call.url.includes('comm_people'))).toHaveLength(1);
    expect(calls.filter((call) => call.url.includes('comm_rubrics'))).toHaveLength(1);
    expect(calls.filter((call) => call.url.includes('comm_corrections'))).toHaveLength(1);
  });

  it('costs nothing but its queries when there is nothing to judge', async () => {
    const { calls } = mockSupabase({});
    const classify = mockClassify();

    const summary = await runCommsSweep(env, NOW);

    expect(classify).not.toHaveBeenCalled();
    expect(calls.filter((call) => call.url.includes('comm_people'))).toHaveLength(0);
    expect(summary).toEqual({ eligible: 0, classified: 0, failed: 0, parked: 0, aborted: false });
    // A quiet tick is still a healthy one: the classifier ran, and "stalled since" must not fire
    // on a night when nothing arrived.
    expect(health(calls)).toHaveLength(1);
    expect(health(calls)[0]?.body).toMatchObject([{ last_success_at: NOW.toISOString() }]);
  });
});

describe("the two can't-judge paths", () => {
  it('parks a message that spent every attempt, with no model call', async () => {
    const { calls } = mockSupabase({ ceiling: [row({ id: 'stuck', classify_attempts: 5 })] });
    const classify = mockClassify();

    const summary = await runCommsSweep(env, NOW);

    expect(classify).not.toHaveBeenCalled();
    expect(patchOf(calls, 'stuck')?.body).toEqual({
      tier: 'today',
      judged_by: 'unjudged',
      ask: UNJUDGED_CEILING_ASK,
      classified_at: NOW.toISOString(),
    });
    expect(summary.parked).toBe(1);
    expect(summary.classified).toBe(0);
  });

  it('parks a body that never decoded, with no model call and no prompt to build', async () => {
    const { calls } = mockSupabase({ unjudged: [row({ id: 'garbled', body_extracted: false })] });
    const classify = mockClassify();

    const summary = await runCommsSweep(env, NOW);

    expect(classify).not.toHaveBeenCalled();
    // Nothing was judged, so nothing was read to judge it with.
    expect(calls.filter((call) => call.url.includes('comm_people'))).toHaveLength(0);
    expect(patchOf(calls, 'garbled')?.body).toMatchObject({
      tier: 'today',
      judged_by: 'unjudged',
      ask: UNJUDGED_DECODE_ASK,
    });
    expect(summary).toMatchObject({ eligible: 1, classified: 0, failed: 0, parked: 1 });
  });

  it('writes both parks conditionally, so an overlapping tick cannot stamp twice', async () => {
    const { calls } = mockSupabase({
      ceiling: [row({ id: 'stuck', classify_attempts: 5 })],
      unjudged: [row({ id: 'garbled', body_extracted: false })],
    });
    mockClassify();

    await runCommsSweep(env, NOW);

    expect(patchOf(calls, 'stuck')?.url).toContain('tier=is.null');
    expect(patchOf(calls, 'garbled')?.url).toContain('tier=is.null');
  });
});

describe('a judged message', () => {
  it('writes the verdict with its full provenance and points the message at it', async () => {
    const { calls } = mockSupabase({
      unjudged: [row()],
      people: [personRow()],
      rubric: [{ id: 'rubric-1', version: 4, body: 'Vendors are never urgent.', created_at: '' }],
    });
    mockClassify({ ok: verdict() });

    const summary = await runCommsSweep(env, NOW);

    expect(verdicts(calls)[0]?.body).toEqual({
      message_id: 'message-1',
      tier: 'today',
      owes_reply: true,
      ask: 'Approve the Q3 invoice before the 5pm billing run.',
      reason: 'A named deadline today from a colleague who is blocked.',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      prompt_version: 3,
      rubric_version: 4,
      example_set_version: 7,
      // Stamped because the sender resolved to someone on the roster — "flagged because it's
      // from Dana" has to stay answerable.
      person_id: 'person-1',
    });
    expect(patchOf(calls, 'message-1')?.body).toEqual({
      tier: 'today',
      judged_by: 'model',
      ask: 'Approve the Q3 invoice before the 5pm billing run.',
      verdict_id: 'verdict-1',
      classified_at: NOW.toISOString(),
    });
    expect(patchOf(calls, 'message-1')?.url).toContain('tier=is.null');
    expect(summary).toEqual({ eligible: 1, classified: 1, failed: 0, parked: 0, aborted: false });
  });

  it('leaves person_id off a verdict on a sender nobody has listed', async () => {
    const { calls } = mockSupabase({
      unjudged: [row({ sender_handle: 'stranger@example.com' })],
      people: [personRow()],
    });
    mockClassify({ ok: verdict() });

    await runCommsSweep(env, NOW);

    expect(verdicts(calls)[0]?.body).not.toHaveProperty('person_id');
  });

  it('lifts an owed reply off the shelf before it writes anything', async () => {
    const { calls } = mockSupabase({ unjudged: [row()] });
    mockClassify({ ok: verdict({ tier: 'fyi', owes_reply: true }) });

    await runCommsSweep(env, NOW);

    expect(verdicts(calls)[0]?.body).toMatchObject({ tier: 'whenever', owes_reply: true });
    expect(patchOf(calls, 'message-1')?.body).toMatchObject({ tier: 'whenever' });
  });

  it('caps a seven-hour-old asap to today', async () => {
    const { calls } = mockSupabase({
      unjudged: [row({ received_at: '2026-09-09T08:00:00.000Z' })],
    });
    mockClassify({ ok: verdict({ tier: 'asap' }) });

    await runCommsSweep(env, NOW);

    expect(verdicts(calls)[0]?.body).toMatchObject({ tier: 'today' });
  });

  it('leaves a one-hour-old asap alone', async () => {
    const { calls } = mockSupabase({ unjudged: [row()] });
    mockClassify({ ok: verdict({ tier: 'asap' }) });

    await runCommsSweep(env, NOW);

    expect(verdicts(calls)[0]?.body).toMatchObject({ tier: 'asap' });
  });

  it('sends a photo-only message with a placeholder rather than skipping it', async () => {
    mockSupabase({
      unjudged: [row({ body: '', has_attachments: true })],
      people: [personRow()],
    });
    const classify = mockClassify({ ok: verdict() });

    await runCommsSweep(env, NOW);

    const request = classify.mock.calls[0]?.[1];
    expect(request?.user).toContain(IMAGE_PLACEHOLDER);
    expect(request?.user).toContain('[priority person]');
  });

  it('tells the model this message carries a list header when the row says so', async () => {
    // The raw signal both producers (gmail.ts, ingest.ts) now write onto the row has to actually
    // reach the prompt — this is the one place `has_list_header` is read back off the message and
    // handed to `buildCommsRequest` as `carriesListHeader`.
    mockSupabase({ unjudged: [row({ has_list_header: true })] });
    const classify = mockClassify({ ok: verdict() });

    await runCommsSweep(env, NOW);

    const request = classify.mock.calls[0]?.[1];
    expect(request?.user).toContain('list header');
  });

  it('says nothing about a list header when the row carries none', async () => {
    mockSupabase({ unjudged: [row({ has_list_header: false })] });
    const classify = mockClassify({ ok: verdict() });

    await runCommsSweep(env, NOW);

    const request = classify.mock.calls[0]?.[1];
    expect(request?.user).not.toContain('list header');
  });

  it('still lands on raced when the row was genuinely already judged, now via an extra insert', async () => {
    // Every patch on this message misses, as if another tick's write had already landed. The
    // freshness check used to catch this BEFORE paying for a verdict insert — but it now also
    // guards the attempt count (so a concurrent CAS-incremented count can't fool it into
    // clobbering that count back down; see writeVerdict's comment), and a miss is ambiguous
    // between "already judged" and "just the attempt count moved elsewhere." The two need
    // opposite responses, so a miss no longer bails early: this tick pays for the insert
    // regardless, and it is the FINAL write's own (attempts-blind) filter that actually lands on
    // 'raced' once it, too, misses.
    const { calls } = mockSupabase({ unjudged: [row()], patchRows: () => [] });
    mockClassify({ ok: verdict() });
    const logged = captureErrors();

    const summary = await runCommsSweep(env, NOW);

    expect(summary).toMatchObject({ eligible: 1, classified: 0, failed: 0 });
    expect(logged.join(' ')).toContain('judged by another tick first');
    expect(patchOf(calls, 'message-1')).toBeDefined();
    expect(patches(calls)).toHaveLength(2);
    expect(verdicts(calls)).toHaveLength(1);
  });

  it('can still orphan a verdict in the narrow window between the freshness check and the final write', async () => {
    // The freshness check shrinks the window an overlapping tick can land in from "the whole
    // model round-trip" down to "the gap between two Supabase calls" — it cannot close that gap
    // entirely. Here the check passes (this tick still looked unjudged) but the final write loses
    // the race anyway, so one verdict row is written that nothing ends up pointing to. Documented
    // here rather than pretended away.
    let patchCount = 0;
    const { calls } = mockSupabase({
      unjudged: [row()],
      patchRows: () => (patchCount++ === 0 ? [{ id: 'message-1' }] : []),
    });
    mockClassify({ ok: verdict() });
    const logged = captureErrors();

    const summary = await runCommsSweep(env, NOW);

    expect(summary).toMatchObject({ classified: 0, failed: 0 });
    expect(logged.join(' ')).toContain('judged by another tick first');
    expect(patches(calls)).toHaveLength(2);
    expect(verdicts(calls)).toHaveLength(1);
  });

  it('leaves the message unjudged when the database refuses the verdict', async () => {
    // A rejected write is not a bad message: no attempt is counted, and the next tick retries.
    // One patch happens — the freshness check, a value-preserving write — but it does not touch
    // tier or judged_by, so the message is exactly as unjudged as before it. The insert was still
    // attempted (and rejected with a non-2xx, so no row exists behind it) — the freshness check
    // only prevents an insert this tick already knows is pointless, not one the database itself
    // goes on to refuse.
    const { calls } = mockSupabase({ unjudged: [row()], verdictFails: true });
    mockClassify({ ok: verdict() });

    const summary = await runCommsSweep(env, NOW);

    expect(summary).toMatchObject({ classified: 0, failed: 1 });
    expect(patches(calls)).toHaveLength(1);
    expect(patchOf(calls, 'message-1')?.body).toEqual({ classify_attempts: 0 });
    expect(verdicts(calls)).toHaveLength(1);
  });
});

/** A row the owner has explicitly asked to have judged again, already judged and already cleared. */
const requested = (): Record<string, unknown> =>
  row({
    id: 'message-1',
    tier: 'fyi',
    judged_by: 'model',
    ask: 'Nothing is owed here.',
    classified_at: '2026-09-08T10:00:00.000Z',
    reclassify_requested_at: '2026-09-09T14:50:00.000Z',
    cleared_at: '2026-09-08T11:00:00.000Z',
    cleared_by: 'nothing_to_answer',
  });

describe('a re-run', () => {
  it('overwrites the tier it already had and clears the request', async () => {
    const { calls } = mockSupabase({ reruns: [requested()] });
    mockClassify({ ok: verdict({ tier: 'asap' }) });

    const summary = await runCommsSweep(env, NOW);

    const written = patches(calls);
    // Unconditional: the whole point of a re-run is to replace a tier that already exists.
    expect(written[0]?.url).not.toContain('tier=is.null');
    expect(written[0]?.body).toMatchObject({ tier: 'asap', judged_by: 'model' });
    // The request is answered, so it goes back to empty — otherwise the row is re-judged every
    // two minutes forever.
    expect(written[1]?.body).toEqual({ reclassify_requested_at: WIRE_NULL });
    expect(summary.classified).toBe(1);
  });

  it('writes a second verdict rather than destroying the first', async () => {
    const { calls } = mockSupabase({ reruns: [requested()] });
    mockClassify({ ok: verdict({ tier: 'asap' }) });

    await runCommsSweep(env, NOW);

    expect(verdicts(calls)).toHaveLength(1);
    expect(verdicts(calls)[0]?.method).toBe('POST');
  });

  it('leaves triage state alone on a row the owner already cleared', async () => {
    const { calls } = mockSupabase({ reruns: [requested()] });
    mockClassify({ ok: verdict() });

    await runCommsSweep(env, NOW);

    expect(patches(calls)[0]?.body).not.toHaveProperty('cleared_at');
    expect(patches(calls)[0]?.body).not.toHaveProperty('cleared_by');
  });

  it('clears the request even when the re-run could not be judged either', async () => {
    // A re-run of a message whose body never decoded is re-parked rather than re-asked — but the
    // request must still be answered, or the row comes back every two minutes forever.
    const { calls } = mockSupabase({ reruns: [{ ...requested(), body_extracted: false }] });
    const classify = mockClassify();

    await runCommsSweep(env, NOW);

    expect(classify).not.toHaveBeenCalled();
    expect(patches(calls)[0]?.body).toMatchObject({ judged_by: 'unjudged' });
    expect(patches(calls)[1]?.body).toEqual({ reclassify_requested_at: WIRE_NULL });
  });
});

describe('the failure table', () => {
  it('aborts the tick on a rejected credential, counting nothing', async () => {
    const { calls } = mockSupabase({ unjudged: [row({ id: 'a' }), row({ id: 'b' })] });
    const classify = mockClassify({
      failed: { reason: 'credentials', detail: 'invalid x-api-key' },
    });
    const logged = captureErrors();

    const summary = await runCommsSweep(env, NOW);

    expect(classify).toHaveBeenCalledTimes(1);
    expect(patches(calls)).toHaveLength(0);
    expect(summary).toMatchObject({ eligible: 2, classified: 0, failed: 0, aborted: true });
    expect(logged.join(' ')).toContain(CREDENTIAL_FAILURE);
    expect(health(calls)[0]?.body).toMatchObject([{ last_error: 'invalid x-api-key' }]);
  });

  it('aborts the tick on a rejected request, counting nothing', async () => {
    // The request shape and the model id are identical for every message, so a 400 on one is a
    // 400 on all of them — counting it per-message would park the whole stream in ten minutes.
    const { calls } = mockSupabase({ unjudged: [row({ id: 'a' }), row({ id: 'b' })] });
    const classify = mockClassify({
      failed: { reason: 'bad_request', detail: 'model: not found' },
    });
    const logged = captureErrors();

    const summary = await runCommsSweep(env, NOW);

    expect(classify).toHaveBeenCalledTimes(1);
    expect(patches(calls)).toHaveLength(0);
    expect(summary.aborted).toBe(true);
    expect(logged.join(' ')).toContain(REQUEST_FAILURE);
  });

  it('writes and counts nothing on a transport failure, and keeps going', async () => {
    // The divergence from the Inbox sweep that matters. With an active ceiling, counting a 429
    // would empty a twenty-minute Anthropic incident into a counted tier — none of it drainable
    // by replying, because nobody owes a reply to a newsletter.
    const { calls } = mockSupabase({ unjudged: [row({ id: 'a' }), row({ id: 'b' })] });
    const classify = mockClassify(
      { failed: { reason: 'transport', detail: '429 rate limited' } },
      { ok: verdict() },
    );

    const summary = await runCommsSweep(env, NOW);

    expect(classify).toHaveBeenCalledTimes(2);
    expect(patchOf(calls, 'a')).toBeUndefined();
    expect(summary).toMatchObject({ eligible: 2, classified: 1, failed: 0, aborted: false });
  });

  it.each([
    ['an unparseable', { failed: { reason: 'unparseable', detail: 'not valid JSON: hi' } }],
    ['a truncated', { failed: { reason: 'truncated' } }],
  ] as const)('counts one attempt on %s answer', async (_name, outcome) => {
    const { calls } = mockSupabase({ unjudged: [row({ classify_attempts: 2 })] });
    mockClassify(outcome);

    const summary = await runCommsSweep(env, NOW);

    // No re-ask: the same prompt mostly produces the same shape, so one attempt is the whole
    // response, and at five the message is parked rather than retried forever.
    expect(patchOf(calls, 'message-1')?.body).toEqual({ classify_attempts: 3 });
    // Compare-and-set on the count as it was read: an overlapping tick that already moved this
    // row past 2 must make this write miss rather than silently clobber a newer count.
    expect(patchOf(calls, 'message-1')?.url).toContain('classify_attempts=eq.2');
    expect(summary).toMatchObject({ classified: 0, failed: 1, parked: 0 });
  });

  it('counts an attempt when the JSON parsed but the verdict did not', async () => {
    // A tier outside the enum is a structured-output failure, not a tier to repair.
    const { calls } = mockSupabase({ unjudged: [row({ classify_attempts: 1 })] });
    mockClassify({ ok: { ...verdict(), tier: 'urgent' } });

    const summary = await runCommsSweep(env, NOW);

    expect(patchOf(calls, 'message-1')?.body).toEqual({ classify_attempts: 2 });
    expect(patchOf(calls, 'message-1')?.url).toContain('classify_attempts=eq.1');
    expect(verdicts(calls)).toHaveLength(0);
    expect(summary.failed).toBe(1);
  });

  it('shelves a refusal with a visible flag, and never retries it', async () => {
    const { calls } = mockSupabase({ unjudged: [row()] });
    mockClassify({ failed: { reason: 'refusal' } });

    const summary = await runCommsSweep(env, NOW);

    expect(patchOf(calls, 'message-1')?.body).toEqual({
      tier: 'fyi',
      judged_by: 'refusal',
      ask: REFUSAL_ASK,
      classified_at: NOW.toISOString(),
    });
    // No attempt counted: re-sending an identical prompt cannot change a refusal.
    expect(patches(calls)).toHaveLength(1);
    expect(summary).toMatchObject({ classified: 0, failed: 0, parked: 1 });
  });

  it('stamps the classifier healthy after a tick that finished', async () => {
    const { calls } = mockSupabase({ unjudged: [row()] });
    mockClassify({ ok: verdict() });

    await runCommsSweep(env, NOW);

    expect(health(calls)[0]?.body).toMatchObject([
      { id: 1, last_run_at: NOW.toISOString(), last_success_at: NOW.toISOString() },
    ]);
  });
});

/**
 * A real `comm_messages` row for ONE message, with PATCH filters actually enforced against its
 * current state — unlike `mockSupabase`, which answers every PATCH the same way regardless of
 * what it asks for. This is what lets the race tests below exercise the race rather than merely
 * asserting a filter string appears in a URL: a stale write really can, or really cannot, land
 * on the row depending on what has happened to it since.
 *
 * Both of `patchMessage`'s filters are enforced — `classify_attempts=eq.<n>` (present or absent)
 * and `tier=is.null` (present or absent) — combined with AND, exactly as PostgREST would. A
 * verdict insert is also answered, so a test can drive a tick all the way through a real SUCCESS
 * and inspect what actually landed in `state` afterward, not just how many calls were made.
 */
function fakeMessageTable(initial: Record<string, unknown>): {
  state: Record<string, unknown>;
  patchResults: number[];
} {
  const state = { ...initial };
  const patchResults: number[] = [];

  function respond(input: unknown, init: RequestInit | undefined): Promise<Response> {
    const url = input as string;
    const method = init?.method ?? 'GET';

    if (url.includes('/rest/v1/comm_messages') && method === 'PATCH') {
      const params = new URL(url).searchParams;
      const wantAttempts = params.get('classify_attempts'); // "eq.<n>" or absent
      const wantTier = params.get('tier'); // "is.null" or absent
      const attemptsMatch =
        wantAttempts === null || wantAttempts === `eq.${String(state['classify_attempts'])}`;
      const tierMatch = wantTier === null || (wantTier === 'is.null' && state['tier'] === null);
      const matches = attemptsMatch && tierMatch;
      if (matches) Object.assign(state, JSON.parse(init?.body as string) as object);
      patchResults.push(matches ? 1 : 0);
      return Promise.resolve(Response.json(matches ? [{ id: state['id'] }] : []));
    }
    if (url.includes('/rest/v1/comm_verdicts') && method === 'POST') {
      return Promise.resolve(Response.json([{ id: 'verdict-fake' }]));
    }
    if (url.includes('classify_attempts=lt.')) return Promise.resolve(Response.json([state]));
    if (url.includes('reclassify_requested_at=not.is.null')) {
      return Promise.resolve(Response.json([]));
    }
    if (url.includes('classify_attempts=gte.')) return Promise.resolve(Response.json([]));
    if (url.includes('/rest/v1/comm_accounts')) {
      return Promise.resolve(Response.json([accountRow()]));
    }
    if (url.includes('/rest/v1/rpc/comm_example_set_version'))
      return Promise.resolve(Response.json(7));
    // comm_people, comm_rubrics, comm_corrections: none configured, an empty list each.
    return Promise.resolve(Response.json([]));
  }

  spyOnFetch().mockImplementation(respond);
  return { state, patchResults };
}

describe('an overlapping tick with a stale attempt count', () => {
  it('does not let a late write from a slow tick roll a newer count backward', async () => {
    // The scenario sweep.ts:~277 describes: two ticks both read classify_attempts before either
    // has written it. Tick 2 reads it here, then is held at its model call — the long leg of a
    // tick — while ticks 1 and 3 each run a full, real content-shaped failure to completion on
    // the freshly-current state (2 -> 3 -> 4). Only once that has happened does tick 2 hear back
    // and try to write the count IT read: 2 + 1 = 3. A write with no compare-and-set always
    // lands, and would roll the row backward from 4 to 3 — silently erasing tick 3's failure, the
    // exact loss the bug report describes ("one failure is lost"). The fix must make that write
    // miss instead.
    const { state, patchResults } = fakeMessageTable(row({ classify_attempts: 2 }));

    const classifySpy = jest.spyOn(classifier, 'classifyJson');
    let releaseTick2: ((outcome: classifier.JsonOutcome) => void) | undefined;
    const tick2ReachedTheModel = new Promise<void>((resolveReached) => {
      classifySpy.mockImplementationOnce(() => {
        resolveReached();
        return new Promise((resolve) => {
          releaseTick2 = resolve;
        });
      });
    });
    const contentShapedFailure: classifier.JsonOutcome = {
      failed: { reason: 'unparseable', detail: 'not valid JSON: hi' },
    };
    classifySpy.mockResolvedValue(contentShapedFailure);

    // Tick 2 starts and reads classify_attempts=2, then parks at its (paused) model call.
    const tick2 = runCommsSweep(env, NOW);
    await tick2ReachedTheModel;

    // Ticks 1 and 3 each run to completion on the row as it now stands: 2 -> 3, then 3 -> 4.
    await runCommsSweep(env, NOW);
    await runCommsSweep(env, NOW);
    expect(state['classify_attempts']).toBe(4);

    // Tick 2 finally hears back and tries to write the stale count it read at the start.
    releaseTick2?.(contentShapedFailure);
    await tick2;

    expect(state['classify_attempts']).toBe(4);
    expect(patchResults.at(-1)).toBe(0); // tick 2's own write matched nothing
  });
});

describe('a verdict landing after a sibling tick moved the attempt count', () => {
  it('writes the paid-for verdict without rolling the attempt count backward', async () => {
    // The scenario the bug report reproduces: tick A reads classify_attempts=2, tier=null, then
    // parks at its (paused) model call — the long leg of a tick. While it is held there, tick B
    // reads the SAME row, runs a real content-shaped failure to completion, and correctly
    // CAS-increments the count to 3 (tier is untouched by that path — a content-shaped failure
    // never judges anything). Only once that has happened is tick A released, with a genuine
    // SUCCESS verdict it already paid a model call for.
    //
    // Tick A's freshness check now filters on BOTH the count it read (2) and the tier (still
    // null) — so it misses, because the count has moved even though the row is still exactly as
    // unjudged as when tick A read it. The bug this guards against: a check filtered on tier
    // alone would still MATCH here (tier really is still null) and blindly write back the STALE
    // count of 2 anyway, silently erasing tick B's real, billed attempt. The fix: a miss on the
    // combined filter must not roll the count back — and must not discard tick A's verdict either
    // — so the count stays at 3 (tick B's attempt intact) and the tier still lands at "today"
    // (tick A's verdict intact), via the final write two lines down, which never touches
    // `classify_attempts` at all.
    const { state, patchResults } = fakeMessageTable(row({ classify_attempts: 2 }));

    const classifySpy = jest.spyOn(classifier, 'classifyJson');
    let releaseTickA: ((outcome: classifier.JsonOutcome) => void) | undefined;
    const tickAReachedTheModel = new Promise<void>((resolveReached) => {
      classifySpy.mockImplementationOnce(() => {
        resolveReached();
        return new Promise((resolve) => {
          releaseTickA = resolve;
        });
      });
    });
    classifySpy.mockResolvedValueOnce({
      failed: { reason: 'unparseable', detail: 'not valid JSON: hi' },
    });

    // Tick A starts, reads classify_attempts=2, and parks at its (paused) model call.
    const tickA = runCommsSweep(env, NOW);
    await tickAReachedTheModel;

    // Tick B reads the same row fresh, fails, and CAS-increments the count: 2 -> 3. Tier is
    // still null — a content-shaped failure never judges the message.
    const summaryB = await runCommsSweep(env, NOW);
    expect(summaryB).toMatchObject({ classified: 0, failed: 1 });
    expect(state['classify_attempts']).toBe(3);
    expect(state['tier']).toBeNull();

    // Tick A finally hears back with the SUCCESS it already paid for.
    releaseTickA?.({ ok: verdict() });
    const summaryA = await tickA;

    // The verdict is written — not discarded — and the count tick B earned is not rolled back.
    expect(summaryA).toMatchObject({ classified: 1, failed: 0 });
    expect(state['tier']).toBe('today');
    expect(state['classify_attempts']).toBe(3);
    // Tick A's freshness check (patch 2) misses — the count moved — and falls through rather
    // than bailing; the final write (patch 3) is what actually lands the verdict.
    expect(patchResults).toEqual([1, 0, 1]);
  });
});

/** The wall time one sweep of `limit` messages can take when every request times out and retries. */
const sweepBudget = (limit: number): number => limit * REQUEST_TIMEOUT_MS * (MAX_RETRIES + 1);

describe('the tick stays inside the cron cadence', () => {
  it('bounds both sweeps of failing requests against the two-minute schedule', () => {
    // wrangler.toml fires one trigger every 2 minutes and the entrypoint runs the Inbox sweep and
    // then this one on it. Cloudflare does not serialize scheduled invocations, so the pair's
    // worst case is what decides how many ticks can be in flight at once: ten items each, every
    // request timing out, every retry taken.
    //
    // This pins the arithmetic rather than the values — raise either limit, the timeout or the
    // retry count past what the schedule affords and it fails. The overlap it permits is harmless
    // by construction: every write here is compare-and-set on "still unjudged" except a re-run,
    // and a transport failure counts nothing, so a second tick on the same row writes nothing.
    const CADENCE_MS = 2 * 60 * 1000;
    const worstCase = sweepBudget(SWEEP_LIMIT) + sweepBudget(COMMS_SWEEP_LIMIT);

    expect(worstCase).toBeLessThan(CADENCE_MS * 4);
  });
});
