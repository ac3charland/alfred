/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { GET, POST } from './route';

// `import 'server-only'` throws outside a Server Component context; both verbs reach the read
// layer through it, so neutralise it under Jest.
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);
const mockCreateAdminClient = jest.mocked(createAdminClient);

const API_KEY = 'test-ingest-key';
const TEST_USER = { id: 'user-123' };

const PLAN_ID = '6f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8';
const OLDER_PLAN_ID = '11111111-2222-3333-4444-555555555555';
const PLAN = { id: PLAN_ID, uploaded_at: '2026-09-05T21:03:11.482Z' };
const OLDER_PLAN = { id: OLDER_PLAN_ID, uploaded_at: '2026-08-29T21:03:11.482Z' };

interface QueryResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

/** A created `items` row, with every column the payload reads at a sane default. */
function itemRow(overrides: Record<string, unknown>) {
  return {
    notes: null,
    source_url: null,
    item_type: 'unclassified',
    created_at: '2026-09-05T21:04:02.118Z',
    raw_capture: null,
    due_date: null,
    status: 'active',
    completed_at: null,
    folder_id: null,
    dispatched_at: null,
    parent_id: null,
    occurrence_index: null,
    recurrence: null,
    priority: null,
    recurrence_series_id: null,
    intended_project_id: null,
    intended_epic_id: null,
    sort_order: 0,
    classified_at: null,
    classified_provider: null,
    classified_model: null,
    classified_prompt_version: null,
    classified_guess: null,
    classify_attempts: 0,
    weekly_plan_id: PLAN_ID,
    ...overrides,
  };
}

/**
 * A Supabase double: every builder method chains, an awaited builder resolves to the next
 * queued table result, and `rpc()` resolves to whatever `rpcResult` holds. Table reads are
 * recorded so a test can assert which table was asked and how.
 */
function makeSupabase(options: {
  user?: { id: string } | undefined;
  tables?: QueryResult[];
  rpc?: QueryResult;
}) {
  const queue = [...(options.tables ?? [])];
  const calls: { table: string; filters: unknown[] }[] = [];
  const rpc = jest.fn().mockResolvedValue(options.rpc ?? { data: [], error: null });
  const from = jest.fn((table: string) => {
    const record = { table, filters: [] as unknown[] };
    calls.push(record);
    // A real Promise carrying the builder methods: a PostgREST builder is awaitable at any
    // point in the chain, and attaching the methods to a promise gives that without hand-rolling
    // a thenable.
    const builder = Promise.resolve(
      queue.shift() ?? { data: [], error: null },
    ) as Promise<QueryResult> & Record<string, unknown>;
    for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
      builder[method] = jest.fn((...arguments_: unknown[]) => {
        record.filters.push([method, ...arguments_]);
        return builder;
      });
    }
    return builder;
  });
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: options.user } }) },
    from,
    rpc,
    calls,
  };
}

/** Wire the double up as the ADMIN client — the path a keyed caller takes. */
function keyed(options: Parameters<typeof makeSupabase>[0] = {}) {
  const supabase = makeSupabase(options);
  mockCreateAdminClient.mockReturnValue(supabase as never);
  // A signed-out session double, so a route that reached for the cookie client instead of the
  // admin one would read nothing and the test would catch it.
  mockCreateClient.mockResolvedValue(makeSupabase({ user: undefined }) as never);
  return supabase;
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** The keyed caller's headers — the default for both request builders below. */
const KEYED = { 'x-api-key': API_KEY };

function postRequest(body: unknown, headers?: Record<string, string>) {
  return new Request(`http://localhost/api/weekly-plans/${PLAN_ID}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers ?? KEYED) },
    body: JSON.stringify(body),
  });
}

function getRequest(headers?: Record<string, string>) {
  return new Request(`http://localhost/api/weekly-plans/${PLAN_ID}/items`, {
    headers: headers ?? KEYED,
  });
}

/** One node of the published tree, as much of it as the assertions below reach for. */
interface NodeBody {
  children: NodeBody[];
}

interface CohortBody {
  plan: { id: string; uploaded_at: string } | null;
  counts: Record<string, number>;
  items: NodeBody[];
}

const ONE_TASK = {
  items: [{ item_type: 'task', title: 'Ship the motivic harness spike', due_date: '2026-09-08' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.INGEST_API_KEY = API_KEY;
});

describe('POST /api/weekly-plans/[id]/items', () => {
  it('creates the cohort through the admin client and returns 201 with the tree', async () => {
    const supabase = keyed({
      tables: [{ data: [PLAN], error: null }],
      rpc: {
        data: [
          itemRow({ id: 'root', title: 'Ship the spike', item_type: 'task' }),
          itemRow({ id: 'kid', title: 'Write the skeleton', item_type: 'task', parent_id: 'root' }),
        ],
        error: null,
      },
    });

    const response = await POST(postRequest(ONE_TASK), context(PLAN_ID));

    expect(response.status).toBe(201);
    const body = (await response.json()) as CohortBody & { created: number };
    expect(body.plan).toStrictEqual(PLAN);
    // Every node written, roots and children alike.
    expect(body.created).toBe(2);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.children).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ state: 'active', done: false, done_at: null });
    // The keyed caller carries no cookie: reading through the session client would answer
    // "no such plan" on a plan that exists (the habits trap).
    expect(mockCreateAdminClient).toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalledWith('create_weekly_plan_items', {
      p_plan: PLAN_ID,
      p_items: ONE_TASK.items,
    });
  });

  it('accepts a browser session when no key is presented', async () => {
    const supabase = makeSupabase({
      user: TEST_USER,
      tables: [{ data: [PLAN], error: null }],
      rpc: { data: [itemRow({ id: 'a', title: 'x' })], error: null },
    });
    mockCreateClient.mockResolvedValue(supabase as never);

    const response = await POST(postRequest(ONE_TASK, {}), context(PLAN_ID));

    expect(response.status).toBe(201);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('rejects a caller with neither a key nor a session', async () => {
    mockCreateClient.mockResolvedValue(makeSupabase({ user: undefined }) as never);

    const response = await POST(postRequest(ONE_TASK, {}), context(PLAN_ID));

    expect(response.status).toBe(401);
  });

  it('answers 404 for a plan id that names nothing, and writes nothing', async () => {
    const supabase = keyed({ tables: [{ data: [], error: null }] });

    const response = await POST(postRequest(ONE_TASK), context(PLAN_ID));

    expect(response.status).toBe(404);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('answers 404 for the latest segment — a write names its plan', async () => {
    const supabase = keyed({});

    const response = await POST(postRequest(ONE_TASK), context('latest'));

    expect(response.status).toBe(404);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('answers 400 for a path segment that is neither a UUID nor latest', async () => {
    keyed({});

    const response = await POST(postRequest(ONE_TASK), context('not-a-uuid'));

    expect(response.status).toBe(400);
  });

  it('answers 400 with the zod issue list when the body fails the schema', async () => {
    const supabase = keyed({ tables: [{ data: [PLAN], error: null }] });

    const response = await POST(
      postRequest({ items: [{ item_type: 'code', title: 'x', due_date: '2026-09-08' }] }),
      context(PLAN_ID),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { details: unknown };
    expect(body.details).toBeDefined();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('maps an RPC failure rather than reporting a created week', async () => {
    keyed({
      tables: [{ data: [PLAN], error: null }],
      rpc: { data: null, error: { message: 'a code item may only be nested under another' } },
    });

    const response = await POST(postRequest(ONE_TASK), context(PLAN_ID));

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('a code item may only be nested under another');
  });
});

describe('GET /api/weekly-plans/[id]/items', () => {
  it('returns the cohort with its counts and the plan it is reporting on', async () => {
    keyed({
      tables: [
        { data: [PLAN], error: null },
        {
          data: [
            itemRow({
              id: 'a',
              title: 'Ship the spike',
              item_type: 'task',
              status: 'completed',
              completed_at: '2026-09-08T19:41:08.221Z',
              folder_id: 'f-1',
              dispatched_at: '2026-09-06T09:00:00Z',
            }),
            itemRow({ id: 'b', title: 'Still open', item_type: 'task' }),
          ],
          error: null,
        },
        { data: [{ id: 'f-1', name: 'RealPlay' }], error: null },
      ],
    });

    const response = await GET(getRequest(), context(PLAN_ID));

    expect(response.status).toBe(200);
    const body = (await response.json()) as CohortBody;
    expect(body.plan).toStrictEqual(PLAN);
    expect(body.counts).toStrictEqual({
      total: 2,
      done: 1,
      open: 1,
      abandoned: 0,
      untriaged: 1,
    });
    expect(body.items[0]).toMatchObject({
      done: true,
      done_at: '2026-09-08T19:41:08.221Z',
      folder: { id: 'f-1', name: 'RealPlay' },
      in_inbox: false,
    });
  });

  it('resolves latest to the newest plan that has items, not merely the newest plan', async () => {
    keyed({
      tables: [
        // The plan index, newest first — the head is a revision nothing was created against.
        { data: [PLAN, OLDER_PLAN], error: null },
        { data: [], error: null },
        { data: [{ id: 'probe' }], error: null },
        { data: [itemRow({ id: 'a', title: 'x', weekly_plan_id: OLDER_PLAN_ID })], error: null },
      ],
    });

    const response = await GET(getRequest(), context('latest'));

    expect(response.status).toBe(200);
    const body = (await response.json()) as CohortBody;
    expect(body.plan).toStrictEqual(OLDER_PLAN);
  });

  it('answers the documented empty payload when no cohort has ever been created', async () => {
    keyed({ tables: [{ data: [], error: null }] });

    const response = await GET(getRequest(), context('latest'));

    // 200, never 404: a coach told "not found" would have to read it as an outage.
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({
      plan: null,
      counts: { total: 0, done: 0, open: 0, abandoned: 0, untriaged: 0 },
      items: [],
    });
  });

  it('answers 200 with an empty list for a plan that exists but was never built on', async () => {
    keyed({
      tables: [
        { data: [PLAN], error: null },
        { data: [], error: null },
      ],
    });

    const response = await GET(getRequest(), context(PLAN_ID));

    expect(response.status).toBe(200);
    const body = (await response.json()) as CohortBody;
    expect(body.plan).toStrictEqual(PLAN);
    expect(body.items).toStrictEqual([]);
  });

  it('answers 404 for an explicit id naming no plan', async () => {
    keyed({ tables: [{ data: [], error: null }] });

    const response = await GET(getRequest(), context(PLAN_ID));

    expect(response.status).toBe(404);
  });

  it('answers 400 for a segment that is neither a UUID nor latest', async () => {
    keyed({});

    const response = await GET(getRequest(), context('last-week'));

    expect(response.status).toBe(400);
  });

  it('rejects a caller with neither a key nor a session', async () => {
    mockCreateClient.mockResolvedValue(makeSupabase({ user: undefined }) as never);

    const response = await GET(getRequest({}), context(PLAN_ID));

    expect(response.status).toBe(401);
  });

  it('reads through the admin client on the keyed path', async () => {
    keyed({
      tables: [
        { data: [PLAN], error: null },
        { data: [], error: null },
      ],
    });

    await GET(getRequest(), context(PLAN_ID));

    expect(mockCreateAdminClient).toHaveBeenCalled();
  });

  it('maps a read failure rather than reporting an empty week', async () => {
    keyed({
      tables: [
        { data: [PLAN], error: null },
        { data: null, error: { message: 'connection reset' } },
      ],
    });

    const response = await GET(getRequest(), context(PLAN_ID));

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('connection reset');
  });
});
