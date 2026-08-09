import * as classifier from './classifier';
import { spyOnFetch } from './fetch-stub';
import { ATTEMPT_CEILING, CREDENTIAL_FAILURE, SWEEP_LIMIT, type SweepEnv, runSweep } from './sweep';
import type { ClassifyOutcome, Verdict } from './verdict';

const env: SweepEnv = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  ANTHROPIC_API_KEY: 'sk-ant-test',
  CLASSIFIER_MODEL: 'claude-haiku-4-5',
  CLASSIFIER_TIMEZONE: 'America/Chicago',
};

/** A fixed clock, so the provenance a sweep writes is assertable rather than merely present. */
const NOW = new Date('2026-08-08T15:00:00.000Z');

const FOLDER = '7f3a0000-0000-4000-8000-000000000001';

/**
 * A JSON `null`, which is how PostgREST spells an absent column. Produced rather than written,
 * because this package bans the `null` literal in source — the wire still speaks it.
 */
const WIRE_NULL: unknown = JSON.parse('null');

/** One eligible row, as PostgREST hands it over. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'item-1',
    title: 'Call the dentist friday',
    notes: WIRE_NULL,
    // Not null in the database, defaulted to 0, and always selected by the sweep — so a fixture
    // that left it out would be testing a row shape that cannot exist.
    classify_attempts: 0,
    ...overrides,
  };
}

/** A verdict the model might return, with every field stated. */
function verdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    item_type: undefined,
    priority: undefined,
    due_date: undefined,
    folder_id: undefined,
    intended_project_id: undefined,
    intended_epic_id: undefined,
    ...overrides,
  };
}

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
}

/**
 * Route the Worker's Supabase traffic. `items` is what the sweep query returns; every other read
 * is empty (an empty world and an empty correction log are both legal), and a PATCH reports one
 * updated row unless `patchRows` says otherwise.
 */
function mockSupabase(options: {
  items?: Record<string, unknown>[];
  patchRows?: () => unknown[];
  patchThrows?: boolean;
}): { calls: Call[] } {
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

    if (method === 'PATCH') {
      if (options.patchThrows === true) {
        return Promise.resolve(new Response('violates check constraint', { status: 400 }));
      }
      return Promise.resolve(Response.json(options.patchRows?.() ?? [{ id: 'item-1' }]));
    }
    if (url.includes('/rest/v1/items?')) return Promise.resolve(Response.json(options.items ?? []));
    return Promise.resolve(Response.json([]));
  });
  return { calls };
}

/** Stub the one narrow function that talks to the model, so no test ever makes a live call. */
function mockClassify(...outcomes: ClassifyOutcome[]): jest.SpyInstance {
  const spy = jest.spyOn(classifier, 'classify');
  for (const outcome of outcomes) spy.mockResolvedValueOnce(outcome);
  spy.mockResolvedValue(outcomes.at(-1) ?? { ok: verdict() });
  return spy;
}

const patches = (calls: Call[]): Call[] => calls.filter((call) => call.method === 'PATCH');

/**
 * Silence the sweep's own logging and hand back what it wrote, so a test can assert on the line
 * a failure produced instead of only on the writes it skipped.
 */
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

describe('the sweep query', () => {
  it('asks only for top-level, undispatched, unjudged items under the attempt ceiling', async () => {
    const { calls } = mockSupabase({});

    await runSweep(env, NOW);

    expect(calls).toHaveLength(1);
    const url = calls[0]?.url ?? '';
    expect(url).toContain('/rest/v1/items?');
    expect(url).toContain('parent_id=is.null');
    expect(url).toContain('dispatched_at=is.null');
    expect(url).toContain('classified_at=is.null');
    // The ceiling lives in the PREDICATE, not in a marker: a row that has exhausted its
    // attempts simply stops being selected and goes on being an ordinary Inbox item.
    expect(url).toContain(`classify_attempts=lt.${String(ATTEMPT_CEILING)}`);
    // Oldest first, so a burst drains in capture order instead of starving the earliest item.
    expect(url).toContain('order=created_at.asc');
    expect(url).toContain(`limit=${String(SWEEP_LIMIT)}`);
  });

  it('makes exactly one database query and zero model calls when nothing is eligible', async () => {
    const { calls } = mockSupabase({ items: [] });
    const classify = mockClassify();

    const summary = await runSweep(env, NOW);

    expect(calls).toHaveLength(1);
    expect(classify).not.toHaveBeenCalled();
    expect(summary).toEqual({ eligible: 0, classified: 0, failed: 0, aborted: false });
  });
});

describe('the loop', () => {
  it('classifies one item per request, sequentially — never a parallel burst', async () => {
    mockSupabase({
      items: [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })],
    });
    let inFlight = 0;
    let overlapped = false;
    jest.spyOn(classifier, 'classify').mockImplementation(async () => {
      inFlight += 1;
      if (inFlight > 1) overlapped = true;
      await Promise.resolve();
      inFlight -= 1;
      return { ok: verdict() };
    });

    await runSweep(env, NOW);

    expect(overlapped).toBe(false);
  });

  it('keeps going after one item fails, so a bad response costs one item and not the tick', async () => {
    const { calls } = mockSupabase({ items: [row({ id: 'a' }), row({ id: 'b' })] });
    mockClassify({ failed: { reason: 'refusal' } }, { ok: verdict({ item_type: 'task' }) });

    const summary = await runSweep(env, NOW);

    expect(summary).toEqual({ eligible: 2, classified: 1, failed: 1, aborted: false });
    const written = patches(calls);
    expect(written).toHaveLength(2);
    // The failure counted an attempt; the success wrote a verdict.
    expect(written[0]?.body).toEqual({ classify_attempts: 1 });
    expect(written[1]?.url).toContain('id=eq.b');
  });

  it.each<[string, ClassifyOutcome]>([
    ['a refusal', { failed: { reason: 'refusal' } }],
    ['a truncated response', { failed: { reason: 'truncated' } }],
    ['an unparseable body', { failed: { reason: 'unparseable', detail: 'not JSON' } }],
    ['a transport failure', { failed: { reason: 'transport', detail: '503' } }],
  ])('counts an attempt on %s, from the value already in hand', async (_label, outcome) => {
    const { calls } = mockSupabase({ items: [row({ classify_attempts: 3 })] });
    mockClassify(outcome);

    const summary = await runSweep(env, NOW);

    // No extra read: the sweep already selected the counter, so a failure PATCHes n + 1.
    expect(patches(calls)).toHaveLength(1);
    expect(patches(calls)[0]?.body).toEqual({ classify_attempts: 4 });
    expect(summary.failed).toBe(1);
  });
});

describe('the credential carve-out', () => {
  it('aborts the tick on a rejected key, leaving every later item untouched', async () => {
    const { calls } = mockSupabase({ items: [row({ id: 'a' }), row({ id: 'b' })] });
    const classify = mockClassify({ failed: { reason: 'credentials', detail: '401' } });
    const logged = captureErrors();

    const summary = await runSweep(env, NOW);

    // The assertion that matters: no item's counter moved, not even the one that saw the 401.
    // A configuration fault is not the item's fault, so fixing the key later loses nothing.
    expect(patches(calls)).toHaveLength(0);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(summary.aborted).toBe(true);
    expect(logged.join(' ')).toContain(CREDENTIAL_FAILURE);
  });

  it('makes zero requests when the key binding has never been set', async () => {
    const { calls } = mockSupabase({ items: [row()] });
    const classify = mockClassify();
    const { ANTHROPIC_API_KEY: _unset, ...withoutKey } = env;

    const summary = await runSweep(withoutKey, NOW);

    expect(calls).toHaveLength(0);
    expect(classify).not.toHaveBeenCalled();
    expect(summary).toEqual({ eligible: 0, classified: 0, failed: 0, aborted: true });
  });
});

describe('the write', () => {
  it('lands every surviving guess and all of the provenance in one coherent UPDATE', async () => {
    const { calls } = mockSupabase({ items: [row({ id: 'a' })] });
    mockClassify({
      ok: verdict({ item_type: 'task', priority: 'high', due_date: '2026-08-07' }),
    });

    await runSweep(env, NOW);

    const written = patches(calls);
    expect(written).toHaveLength(1);
    expect(written[0]?.url).toBe('https://proj.supabase.co/rest/v1/items?id=eq.a');
    expect(written[0]?.body).toEqual({
      item_type: 'task',
      priority: 'high',
      due_date: '2026-08-07',
      classified_at: NOW.toISOString(),
      classified_provider: 'anthropic',
      classified_model: 'claude-haiku-4-5',
      classified_prompt_version: 1,
      classified_guess: { item_type: 'task', priority: 'high', due_date: '2026-08-07' },
    });
  });

  it('never writes dispatched_at — the machine cannot move anything out of the Inbox', async () => {
    const { calls } = mockSupabase({ items: [row()] });
    mockClassify({ ok: verdict({ item_type: 'task', folder_id: FOLDER }) });

    await runSweep(env, NOW);

    // This is the invariant that makes writing guesses onto real fields safe to live with: the
    // worst a bad guess can do is show a wrong chip on a row you are already looking at.
    for (const call of patches(calls)) {
      expect(Object.keys(call.body ?? {})).not.toContain('dispatched_at');
    }
  });

  it('still marks the item when the model abstained on every single field', async () => {
    const { calls } = mockSupabase({ items: [row()] });
    mockClassify({ ok: verdict() });

    const summary = await runSweep(env, NOW);

    // Eligibility is "no marker", not "still unclassified" — keying on the type would re-ask the
    // same question about the same text forever, on exactly the items known to be unjudgeable.
    expect(patches(calls)).toHaveLength(1);
    expect(patches(calls)[0]?.body).toEqual({
      classified_at: NOW.toISOString(),
      classified_provider: 'anthropic',
      classified_model: 'claude-haiku-4-5',
      classified_prompt_version: 1,
      classified_guess: {},
    });
    expect(summary.classified).toBe(1);
  });

  it('never overwrites a value the item already holds', async () => {
    const { calls } = mockSupabase({
      // An `ALF:`-prefixed capture: already code, already carrying the project a human chose.
      items: [row({ item_type: 'code', intended_project_id: 'project-1' })],
    });
    mockClassify({
      ok: verdict({ item_type: 'task', intended_project_id: 'project-2', priority: 'low' }),
    });

    await runSweep(env, NOW);

    const body = patches(calls)[0]?.body ?? {};
    expect(body).not.toHaveProperty('item_type');
    expect(body).not.toHaveProperty('intended_project_id');
    // The row will end up `code`, so a task-only guess is dropped rather than written — that
    // combination is exactly what the database's task-only CHECK refuses.
    expect(body).not.toHaveProperty('priority');
  });

  it('leaves the item unmarked and counts an attempt when the database refuses the write', async () => {
    const { calls } = mockSupabase({ items: [row({ classify_attempts: 1 })], patchThrows: true });
    mockClassify({ ok: verdict({ item_type: 'task' }) });

    const summary = await runSweep(env, NOW);

    // The database has the last word by design: a rejected write is logged, not forced through.
    expect(summary).toEqual({ eligible: 1, classified: 0, failed: 1, aborted: false });
    expect(patches(calls)).toHaveLength(2);
    expect(patches(calls)[1]?.body).toEqual({ classify_attempts: 2 });
  });

  it('counts nothing when the row vanished between the query and the write', async () => {
    const { calls } = mockSupabase({ items: [row()], patchRows: () => [] });
    mockClassify({ ok: verdict({ item_type: 'task' }) });

    const summary = await runSweep(env, NOW);

    // There is no row left to mark and nothing to count — the next tick simply won't see it.
    expect(patches(calls)).toHaveLength(1);
    expect(summary).toEqual({ eligible: 1, classified: 0, failed: 1, aborted: false });
  });
});
