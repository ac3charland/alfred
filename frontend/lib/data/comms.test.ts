/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {
  makeCommAccount,
  makeCommCorrection,
  makeCommHandle,
  makeCommHealth,
  makeCommMessage,
  makeCommPerson,
  makeCommRubric,
  resetCommFixtureClock,
} from '@/lib/comms/fixtures';
import { RETENTION_DAYS } from '@/lib/comms/markers';
import { pinClock } from '@/lib/pin-clock';
import * as supabaseServer from '@/lib/supabase/server';

import { COMMS_MAX_PAGES, COMMS_PAGE_SIZE, getCommsSeed, getCommsSettingsSeed } from './comms';

// `import 'server-only'` throws outside a Server Component context; neutralise it under Jest.
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
const mockCreateClient = jest.mocked(supabaseServer.createClient);

pinClock('2026-03-01T12:00:00.000Z');

const ACCOUNT = makeCommAccount('personal', { id: '00000000-0000-4000-8000-00000000000a' });

interface Result {
  data: unknown;
  error: { message: string; code?: string } | null;
}

/** What one request asked for, recorded so the query itself can be asserted. */
interface RecordedQuery {
  eq: [string, unknown][];
  gte?: [string, unknown];
  in?: [string, unknown];
  order: [string, unknown][];
  range?: [number, number];
  select?: string | undefined;
  maybeSingle?: boolean;
}

type Table =
  | 'comm_accounts'
  | 'comm_messages'
  | 'comm_verdicts'
  | 'comm_classifier_health'
  | 'comm_people'
  | 'comm_rubrics'
  | 'comm_corrections';

/** The chaining surface the two seed readers use, over a promise of the request's result. */
type Builder = Promise<Result> & {
  select: (columns?: string) => Builder;
  eq: (column: string, value: unknown) => Builder;
  gte: (column: string, value: unknown) => Builder;
  in: (column: string, values: unknown) => Builder;
  order: (column: string, options: unknown) => Builder;
  range: (start: number, end: number) => Builder;
  overrideTypes: () => Builder;
  maybeSingle: () => Promise<Result>;
};

/**
 * A stand-in for the Supabase query builder. It IS a promise — the real builder is thenable —
 * with the chaining methods assigned onto it, so awaiting the end of any chain resolves the
 * result queued for that request. A fresh builder per request is what lets the paged message
 * read be driven by queueing several `comm_messages` results in an array.
 */
function makeClient(results: Partial<Record<Table, Result | Result[]>>) {
  // Every table starts with an empty list, so "was this read at all?" is a length assertion
  // rather than an undefined check the type system then has to be talked through.
  const calls: Record<Table, RecordedQuery[]> = {
    comm_accounts: [],
    comm_messages: [],
    comm_verdicts: [],
    comm_classifier_health: [],
    comm_people: [],
    comm_rubrics: [],
    comm_corrections: [],
  };
  const pages: Partial<Record<Table, number>> = {};

  const from = jest.fn((table: Table) => {
    const recorded: RecordedQuery = { eq: [], order: [] };
    calls[table].push(recorded);

    const queued = results[table];
    let result: Result = { data: [], error: null };
    if (Array.isArray(queued)) {
      const page = pages[table] ?? 0;
      // The last queued page repeats, so a read that never shortens can be exercised.
      result = queued[Math.min(page, queued.length - 1)] ?? result;
      pages[table] = page + 1;
    } else if (queued !== undefined) {
      result = queued;
    }

    const builder: Builder = Object.assign(Promise.resolve(result), {
      select: jest.fn((columns?: string) => {
        recorded.select = columns;
        return builder;
      }),
      eq: jest.fn((column: string, value: unknown) => {
        recorded.eq.push([column, value]);
        return builder;
      }),
      gte: jest.fn((column: string, value: unknown) => {
        recorded.gte = [column, value];
        return builder;
      }),
      in: jest.fn((column: string, values: unknown) => {
        recorded.in = [column, values];
        return builder;
      }),
      order: jest.fn((column: string, options: unknown) => {
        recorded.order.push([column, options]);
        return builder;
      }),
      range: jest.fn((start: number, end: number) => {
        recorded.range = [start, end];
        return builder;
      }),
      overrideTypes: jest.fn(() => builder),
      maybeSingle: jest.fn(() => {
        recorded.maybeSingle = true;
        return Promise.resolve(result);
      }),
    });
    return builder;
  });

  return { client: { from } as never, calls };
}

beforeEach(() => {
  resetCommFixtureClock();
  jest.clearAllMocks();
});

describe('getCommsSeed', () => {
  it('reads only INBOUND messages, and only inside the retention window', async () => {
    const { client, calls } = makeClient({ comm_accounts: { data: [ACCOUNT], error: null } });
    mockCreateClient.mockResolvedValue(client);

    await getCommsSeed();

    const query = calls.comm_messages[0];
    expect(query?.eq).toContainEqual(['direction', 'inbound']);
    // 60 days before the pinned now — the sweep deletes anything older anyway.
    expect(RETENTION_DAYS).toBe(60);
    expect(query?.gte).toEqual(['received_at', '2025-12-31T12:00:00.000Z']);
  });

  it('pages the message read until a short page arrives, keeping every row', async () => {
    const full = Array.from({ length: COMMS_PAGE_SIZE }, () => makeCommMessage(ACCOUNT.id));
    const tail = [makeCommMessage(ACCOUNT.id)];
    const { client, calls } = makeClient({
      comm_messages: [
        { data: full, error: null },
        { data: tail, error: null },
      ],
    });
    mockCreateClient.mockResolvedValue(client);

    const seed = await getCommsSeed();

    expect(seed.messages).toHaveLength(COMMS_PAGE_SIZE + 1);
    expect(calls.comm_messages).toHaveLength(2);
    expect(calls.comm_messages[1]?.range).toEqual([COMMS_PAGE_SIZE, COMMS_PAGE_SIZE * 2 - 1]);
  });

  it('calls a never-terminating read a failure rather than silently truncating the queue', async () => {
    const full = Array.from({ length: COMMS_PAGE_SIZE }, () => makeCommMessage(ACCOUNT.id));
    const { client, calls } = makeClient({
      comm_accounts: { data: [ACCOUNT], error: null },
      comm_messages: { data: full, error: null },
    });
    mockCreateClient.mockResolvedValue(client);

    const seed = await getCommsSeed();

    expect(calls.comm_messages).toHaveLength(COMMS_MAX_PAGES);
    expect(seed.messages).toEqual([]);
    // Degrades in layers: the accounts still arrive, so the header isn't blank too.
    expect(seed.accounts).toEqual([ACCOUNT]);
  });

  it('fetches only the verdicts the messages actually point at', async () => {
    const judged = makeCommMessage(ACCOUNT.id, {
      tier: 'today',
      judged_by: 'model',
      verdict_id: '00000000-0000-4000-8000-0000000000v1'.replace('v', '1'),
    });
    const unjudged = makeCommMessage(ACCOUNT.id);
    const { client, calls } = makeClient({
      comm_messages: { data: [judged, unjudged], error: null },
    });
    mockCreateClient.mockResolvedValue(client);

    await getCommsSeed();

    expect(calls.comm_verdicts[0]?.in).toEqual(['id', [judged.verdict_id]]);
  });

  it('asks for no verdicts at all when nothing has been judged', async () => {
    const { client, calls } = makeClient({
      comm_messages: { data: [makeCommMessage(ACCOUNT.id)], error: null },
    });
    mockCreateClient.mockResolvedValue(client);

    const seed = await getCommsSeed();

    expect(calls.comm_verdicts).toHaveLength(0);
    expect(seed.verdicts).toEqual([]);
  });

  it('reads the singleton health row, and reports undefined before the sweep has ever run', async () => {
    const { client, calls } = makeClient({ comm_classifier_health: { data: null, error: null } });
    mockCreateClient.mockResolvedValue(client);

    const seed = await getCommsSeed();

    expect(calls.comm_classifier_health[0]?.eq).toContainEqual(['id', 1]);
    expect(calls.comm_classifier_health[0]?.maybeSingle).toBe(true);
    expect(seed.health).toBeUndefined();
  });

  it('hands back the health row when there is one', async () => {
    const health = makeCommHealth();
    const { client } = makeClient({ comm_classifier_health: { data: health, error: null } });
    mockCreateClient.mockResolvedValue(client);

    const seed = await getCommsSeed();
    expect(seed.health).toEqual(health);
  });

  it('takes a caller-supplied client rather than creating one', async () => {
    const { client } = makeClient({ comm_accounts: { data: [ACCOUNT], error: null } });

    const seed = await getCommsSeed(client);

    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(seed.accounts).toEqual([ACCOUNT]);
  });
});

describe('getCommsSettingsSeed', () => {
  it('embeds each person’s handles, and orders rubrics + corrections newest first', async () => {
    const dana = makeCommPerson('Dana Whitfield');
    const people = [{ ...dana, comm_handles: [makeCommHandle(dana.id, 'dana@example.com')] }];
    const { client, calls } = makeClient({
      comm_people: { data: people, error: null },
      comm_rubrics: { data: [makeCommRubric('Be responsive.', { version: 2 })], error: null },
      comm_corrections: { data: [makeCommCorrection()], error: null },
    });
    mockCreateClient.mockResolvedValue(client);

    const seed = await getCommsSettingsSeed();

    expect(calls.comm_people[0]?.select).toBe('*,comm_handles(*)');
    expect(seed.people[0]?.comm_handles).toHaveLength(1);
    // The secondary `id` order is the total-order tie-breaker paging needs — see the pitfall in
    // the supabase skill: without one, two pages can return the same row and never return another.
    expect(calls.comm_rubrics[0]?.order).toEqual([
      ['version', { ascending: false }],
      ['id', { ascending: true }],
    ]);
    expect(calls.comm_corrections[0]?.order).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: true }],
    ]);
  });

  it('degrades to empty slices rather than blanking the shell', async () => {
    const { client } = makeClient({
      comm_people: { data: null, error: { message: 'nope' } },
      comm_rubrics: { data: null, error: { message: 'nope' } },
      comm_corrections: { data: null, error: { message: 'nope' } },
    });
    mockCreateClient.mockResolvedValue(client);

    expect(await getCommsSettingsSeed()).toEqual({ people: [], rubrics: [], corrections: [] });
  });

  // BUG 1 (settings reads silently truncate at PostgREST's row cap): `comm_people`,
  // `comm_rubrics` and `comm_corrections` used to be read with one unbounded `.select()` each,
  // so a table past the project's `Max rows` cap (1000 by default) lost its tail with no error —
  // and for rubrics specifically, a verdict stamped with a version that fell off the tail became
  // unresolvable. These three pin that every one of the three now pages exactly like
  // `getCommsSeed`'s message read already does.

  it('pages past comm_rubrics to keep every version, even beyond one page', async () => {
    const full = Array.from({ length: COMMS_PAGE_SIZE }, (_unused, index) =>
      makeCommRubric('Be responsive.', { version: index + 1 }),
    );
    const tail = [makeCommRubric('Be responsive, v2.', { version: COMMS_PAGE_SIZE + 1 })];
    const { client, calls } = makeClient({
      comm_rubrics: [
        { data: full, error: null },
        { data: tail, error: null },
      ],
    });
    mockCreateClient.mockResolvedValue(client);

    const seed = await getCommsSettingsSeed();

    expect(seed.rubrics).toHaveLength(COMMS_PAGE_SIZE + 1);
    expect(calls.comm_rubrics).toHaveLength(2);
    expect(calls.comm_rubrics[1]?.range).toEqual([COMMS_PAGE_SIZE, COMMS_PAGE_SIZE * 2 - 1]);
  });

  it('pages past comm_people to keep every person, even beyond one page', async () => {
    const full = Array.from({ length: COMMS_PAGE_SIZE }, () => ({
      ...makeCommPerson('Roster Row'),
      comm_handles: [],
    }));
    const tail = [{ ...makeCommPerson('One More Person'), comm_handles: [] }];
    const { client, calls } = makeClient({
      comm_people: [
        { data: full, error: null },
        { data: tail, error: null },
      ],
    });
    mockCreateClient.mockResolvedValue(client);

    const seed = await getCommsSettingsSeed();

    expect(seed.people).toHaveLength(COMMS_PAGE_SIZE + 1);
    expect(calls.comm_people).toHaveLength(2);
  });

  it('pages past comm_corrections to keep every correction, even beyond one page', async () => {
    const full = Array.from({ length: COMMS_PAGE_SIZE }, () => makeCommCorrection());
    const tail = [makeCommCorrection()];
    const { client, calls } = makeClient({
      comm_corrections: [
        { data: full, error: null },
        { data: tail, error: null },
      ],
    });
    mockCreateClient.mockResolvedValue(client);

    const seed = await getCommsSettingsSeed();

    expect(seed.corrections).toHaveLength(COMMS_PAGE_SIZE + 1);
    expect(calls.comm_corrections).toHaveLength(2);
  });

  it('calls a never-terminating rubric read a failure rather than silently truncating the history', async () => {
    const full = Array.from({ length: COMMS_PAGE_SIZE }, (_unused, index) =>
      makeCommRubric('Be responsive.', { version: index + 1 }),
    );
    const { client, calls } = makeClient({
      comm_rubrics: { data: full, error: null },
    });
    mockCreateClient.mockResolvedValue(client);

    const seed = await getCommsSettingsSeed();

    expect(calls.comm_rubrics).toHaveLength(COMMS_MAX_PAGES);
    // Degrades to an empty slice rather than a silently truncated (and therefore misleading)
    // rubric history a verdict's stamped version could stop resolving against.
    expect(seed.rubrics).toEqual([]);
  });
});
