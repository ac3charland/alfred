/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {
  makeCommAccount,
  makeCommCorrection,
  makeCommHandle,
  makeCommHealth,
  makeCommMessage,
  makeCommPerson,
  makeCommRubric,
  makeCommVerdict,
  resetCommFixtureClock,
} from '@/lib/comms/fixtures';
import { RETENTION_DAYS } from '@/lib/comms/markers';
import { SHELF_PAGE_SIZE } from '@/lib/comms/queue';
import { pinClock } from '@/lib/pin-clock';
import * as supabaseServer from '@/lib/supabase/server';

import {
  COMMS_MAX_PAGES,
  COMMS_PAGE_SIZE,
  COMMS_VERDICT_CHUNK_SIZE,
  getCommsSeed,
  getCommsSettingsSeed,
  readCommsSnapshot,
} from './comms';

// `import 'server-only'` throws outside a Server Component context; neutralise it under Jest.
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
const mockCreateClient = jest.mocked(supabaseServer.createClient);

pinClock('2026-03-01T12:00:00.000Z');

const ACCOUNT = makeCommAccount('personal', { id: '00000000-0000-4000-8000-00000000000a' });

interface Result {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number;
}

/** What one request asked for, recorded so the query itself can be asserted. */
interface RecordedQuery {
  eq: [string, unknown][];
  gte?: [string, unknown];
  in?: [string, unknown];
  is: [string, unknown][];
  not: [string, string, unknown][];
  or?: string;
  order: [string, unknown][];
  range?: [number, number];
  limit?: number;
  select?: string | undefined;
  selectOptions?: unknown;
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

/** A table's answer: one result, a queue of pages, or a pick by what the request asked. */
type Answer = Result | Result[] | ((query: RecordedQuery) => Result);

/** The chaining surface the seed readers use, over a promise of the request's result. */
type Builder = Promise<Result> & {
  select: (columns?: string, options?: unknown) => Builder;
  eq: (column: string, value: unknown) => Builder;
  gte: (column: string, value: unknown) => Builder;
  in: (column: string, values: unknown) => Builder;
  is: (column: string, value: unknown) => Builder;
  not: (column: string, op: string, value: unknown) => Builder;
  or: (filter: string) => Builder;
  order: (column: string, options: unknown) => Builder;
  range: (start: number, end: number) => Builder;
  limit: (count: number) => Builder;
  overrideTypes: () => Builder;
  maybeSingle: () => Promise<Result>;
};

/**
 * A stand-in for the Supabase query builder. It IS a promise — the real builder is thenable —
 * with the chaining methods assigned onto it. The answer is picked a microtask later, once the
 * synchronous chain has recorded what the request asked for, so a table read several different
 * ways (`comm_messages`) can answer each by its filters. A queue of results is consumed one per
 * request, the last repeating, so a read that never shortens can be exercised.
 */
function makeClient(results: Partial<Record<Table, Answer>>) {
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
    const recorded: RecordedQuery = { eq: [], is: [], not: [], order: [] };
    calls[table].push(recorded);

    const queued = results[table];
    const pick = (): Result => {
      if (typeof queued === 'function') return queued(recorded);
      if (Array.isArray(queued)) {
        const page = pages[table] ?? 0;
        pages[table] = page + 1;
        return queued[Math.min(page, queued.length - 1)] ?? { data: [], error: null };
      }
      return queued ?? { data: [], error: null };
    };
    const answer = new Promise<Result>((resolve) => {
      queueMicrotask(() => {
        resolve(pick());
      });
    });

    const builder: Builder = Object.assign(answer, {
      select: jest.fn((columns?: string, options?: unknown) => {
        recorded.select = columns;
        recorded.selectOptions = options;
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
      is: jest.fn((column: string, value: unknown) => {
        recorded.is.push([column, value]);
        return builder;
      }),
      not: jest.fn((column: string, op: string, value: unknown) => {
        recorded.not.push([column, op, value]);
        return builder;
      }),
      or: jest.fn((filter: string) => {
        recorded.or = filter;
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
      limit: jest.fn((count: number) => {
        recorded.limit = count;
        return builder;
      }),
      overrideTypes: jest.fn(() => builder),
      maybeSingle: jest.fn(() => {
        recorded.maybeSingle = true;
        return answer;
      }),
    });
    return builder;
  });

  return { client: { from } as never, calls };
}

/** Which of the snapshot's four `comm_messages` reads a request is. */
function messageRead(query: RecordedQuery): 'active' | 'shelf' | 'claimed' | 'last' {
  if (query.or === 'tier.is.null,tier.neq.fyi') return 'active';
  if (query.not.some(([column]) => column === 'reader_claimed_at')) return 'claimed';
  if (query.not.some(([column]) => column === 'classified_at')) return 'last';
  return 'shelf';
}

/** Answer the four message reads separately; `active` may be a queue of pages. */
function messages(answers: {
  active?: Result | Result[];
  shelf?: Result;
  claimed?: Result;
  last?: Result;
}): (query: RecordedQuery) => Result {
  let activePage = 0;
  return (query) => {
    const read = messageRead(query);
    if (read === 'active' && Array.isArray(answers.active)) {
      const page = answers.active[Math.min(activePage, answers.active.length - 1)];
      activePage += 1;
      return page ?? { data: [], error: null };
    }
    const answer = read === 'active' ? answers.active : answers[read];
    return (Array.isArray(answer) ? undefined : answer) ?? { data: [], error: null };
  };
}

beforeEach(() => {
  resetCommFixtureClock();
  jest.clearAllMocks();
});

describe('readCommsSnapshot', () => {
  const CUTOFF = '2025-12-31T12:00:00.000Z';

  it('reads everything above FYI in full: inbound, uncleared, not on the shelf, in the window', async () => {
    const { client, calls } = makeClient({ comm_accounts: { data: [ACCOUNT], error: null } });

    await readCommsSnapshot(client);

    const active = calls.comm_messages.find((query) => messageRead(query) === 'active');
    expect(active?.eq).toContainEqual(['direction', 'inbound']);
    // 60 days before the pinned now — the sweep deletes anything older anyway.
    expect(RETENTION_DAYS).toBe(60);
    expect(active?.gte).toEqual(['received_at', CUTOFF]);
    expect(active?.is).toContainEqual(['cleared_at', null]);
    // A null tier is not "not fyi" to SQL — the unjudged rows have to be asked for by name.
    expect(active?.or).toBe('tier.is.null,tier.neq.fyi');
    expect(active?.limit).toBeUndefined();
  });

  it('pages the active read until a short page arrives, keeping every row', async () => {
    const full = Array.from({ length: COMMS_PAGE_SIZE }, () => makeCommMessage(ACCOUNT.id));
    const tail = [makeCommMessage(ACCOUNT.id)];
    const { client, calls } = makeClient({
      comm_messages: messages({
        active: [
          { data: full, error: null },
          { data: tail, error: null },
        ],
      }),
    });

    const { seed } = await readCommsSnapshot(client);

    expect(seed.messages).toHaveLength(COMMS_PAGE_SIZE + 1);
    const actives = calls.comm_messages.filter((query) => messageRead(query) === 'active');
    expect(actives).toHaveLength(2);
    expect(actives[1]?.range).toEqual([COMMS_PAGE_SIZE, COMMS_PAGE_SIZE * 2 - 1]);
  });

  it('calls a never-terminating read a failure rather than silently truncating the queue', async () => {
    const full = Array.from({ length: COMMS_PAGE_SIZE }, () => makeCommMessage(ACCOUNT.id));
    const { client } = makeClient({
      comm_accounts: { data: [ACCOUNT], error: null },
      comm_messages: messages({ active: { data: full, error: null } }),
    });

    const { seed, error } = await readCommsSnapshot(client);

    expect(error?.code).toBe('PGRST_PAGING');
    expect(seed.messages).toEqual([]);
    // Degrades in layers: the accounts still arrive, so the shell's header isn't blank too.
    expect(seed.accounts).toEqual([ACCOUNT]);
  });

  it('reads only the newest page of the shelf, and counts the whole shelf in the same request', async () => {
    const queued = makeCommMessage(ACCOUNT.id, { tier: 'today', judged_by: 'model' });
    const shelved = makeCommMessage(ACCOUNT.id, { tier: 'fyi', judged_by: 'model' });
    const { client, calls } = makeClient({
      comm_messages: messages({
        active: { data: [queued], error: null },
        shelf: { data: [shelved], error: null, count: 1234 },
      }),
    });

    const { seed } = await readCommsSnapshot(client);

    const shelf = calls.comm_messages.find((query) => messageRead(query) === 'shelf');
    expect(shelf?.or).toBe('tier.eq.fyi,cleared_at.not.is.null');
    expect(shelf?.is).toContainEqual(['reader_claimed_at', null]);
    expect(shelf?.gte).toEqual(['received_at', CUTOFF]);
    expect(shelf?.selectOptions).toEqual({ count: 'exact' });
    expect(shelf?.limit).toBe(SHELF_PAGE_SIZE);
    expect(shelf?.order[0]).toEqual(['received_at', { ascending: false }]);
    expect(seed.messages).toEqual([queued, shelved]);
    expect(seed.shelfCount).toBe(1234);
  });

  it('reads as many shelf rows as the tab is showing', async () => {
    const { client, calls } = makeClient({});

    await readCommsSnapshot(client, SHELF_PAGE_SIZE * 3);

    const shelf = calls.comm_messages.find((query) => messageRead(query) === 'shelf');
    expect(shelf?.limit).toBe(SHELF_PAGE_SIZE * 3);
  });

  it('counts the newsletters the Reader claimed without fetching them', async () => {
    const { client, calls } = makeClient({
      comm_messages: messages({ claimed: { data: null, error: null, count: 9 } }),
    });

    const { seed } = await readCommsSnapshot(client);

    const claimed = calls.comm_messages.find((query) => messageRead(query) === 'claimed');
    expect(claimed?.selectOptions).toEqual({ count: 'exact', head: true });
    expect(claimed?.or).toBe('tier.eq.fyi,cleared_at.not.is.null');
    expect(claimed?.not).toContainEqual(['reader_claimed_at', 'is', null]);
    expect(seed.readerClaimedCount).toBe(9);
  });

  it('reads the newest verdict across the window, which the held rows alone can miss', async () => {
    const { client, calls } = makeClient({
      comm_messages: messages({
        last: { data: { classified_at: '2026-03-01T11:58:00.000Z' }, error: null },
      }),
    });

    const { seed } = await readCommsSnapshot(client);

    const last = calls.comm_messages.find((query) => messageRead(query) === 'last');
    expect(last?.order).toEqual([['classified_at', { ascending: false }]]);
    expect(last?.limit).toBe(1);
    expect(seed.lastClassifiedAt).toBe('2026-03-01T11:58:00.000Z');
  });

  it('stamps when it was read', async () => {
    const { client } = makeClient({});

    const { seed } = await readCommsSnapshot(client);

    expect(seed.readAt).toBe('2026-03-01T12:00:00.000Z');
  });

  it('fetches only the verdicts the returned messages actually point at', async () => {
    const judged = makeCommMessage(ACCOUNT.id, {
      tier: 'today',
      judged_by: 'model',
      verdict_id: '00000000-0000-4000-8000-000000000011',
    });
    const unjudged = makeCommMessage(ACCOUNT.id);
    const { client, calls } = makeClient({
      comm_messages: messages({ active: { data: [judged, unjudged], error: null } }),
    });

    await readCommsSnapshot(client);

    expect(calls.comm_verdicts[0]?.in).toEqual(['id', [judged.verdict_id]]);
  });

  it('asks for no verdicts at all when nothing has been judged', async () => {
    const { client, calls } = makeClient({
      comm_messages: messages({ active: { data: [makeCommMessage(ACCOUNT.id)], error: null } }),
    });

    const { seed } = await readCommsSnapshot(client);

    expect(calls.comm_verdicts).toHaveLength(0);
    expect(seed.verdicts).toEqual([]);
  });

  it('reads the singleton health row, and reports undefined before the sweep has ever run', async () => {
    const { client, calls } = makeClient({ comm_classifier_health: { data: null, error: null } });

    const { seed } = await readCommsSnapshot(client);

    expect(calls.comm_classifier_health[0]?.eq).toContainEqual(['id', 1]);
    expect(calls.comm_classifier_health[0]?.maybeSingle).toBe(true);
    expect(seed.health).toBeUndefined();
  });

  it('hands back the health row when there is one', async () => {
    const health = makeCommHealth();
    const { client } = makeClient({ comm_classifier_health: { data: health, error: null } });

    const { seed } = await readCommsSnapshot(client);

    expect(seed.health).toEqual(health);
  });

  it('chunks the verdict read so a large verdict id list never builds one oversized request', async () => {
    const verdictIds = Array.from({ length: COMMS_VERDICT_CHUNK_SIZE * 2 + 1 }, () =>
      crypto.randomUUID(),
    );
    const judged = verdictIds.map((id) =>
      makeCommMessage(ACCOUNT.id, { tier: 'today', judged_by: 'model', verdict_id: id }),
    );
    const idChunks: string[][] = [];
    for (let start = 0; start < verdictIds.length; start += COMMS_VERDICT_CHUNK_SIZE) {
      idChunks.push(verdictIds.slice(start, start + COMMS_VERDICT_CHUNK_SIZE));
    }
    const verdictPages: Result[] = idChunks.map((ids) => ({
      data: ids.map((id) => makeCommVerdict(judged[0]?.id ?? '', { id })),
      error: null,
    }));
    const { client, calls } = makeClient({
      comm_messages: messages({ active: { data: judged, error: null } }),
      comm_verdicts: verdictPages,
    });

    const { seed } = await readCommsSnapshot(client);

    expect(calls.comm_verdicts).toHaveLength(idChunks.length);
    for (const call of calls.comm_verdicts) {
      expect((call.in?.[1] as string[] | undefined)?.length).toBeLessThanOrEqual(
        COMMS_VERDICT_CHUNK_SIZE,
      );
      // The total order paging needs, applied per chunk exactly like every other paged read here.
      expect(call.order).toEqual([['id', { ascending: true }]]);
    }
    expect(seed.verdicts).toHaveLength(verdictIds.length);
  });

  it('pages past a capped verdict response so nothing behind the row cap is lost', async () => {
    const judged = makeCommMessage(ACCOUNT.id, {
      tier: 'today',
      judged_by: 'model',
      verdict_id: '00000000-0000-4000-8000-0000000000ab',
    });
    const full = Array.from({ length: COMMS_PAGE_SIZE }, (_unused, index) =>
      makeCommVerdict(judged.id, {
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      }),
    );
    const tail = [makeCommVerdict(judged.id, { id: judged.verdict_id ?? '' })];
    const { client, calls } = makeClient({
      comm_messages: messages({ active: { data: [judged], error: null } }),
      comm_verdicts: [
        { data: full, error: null },
        { data: tail, error: null },
      ],
    });

    const { seed } = await readCommsSnapshot(client);

    expect(seed.verdicts).toHaveLength(COMMS_PAGE_SIZE + 1);
    expect(calls.comm_verdicts).toHaveLength(2);
    expect(calls.comm_verdicts[1]?.range).toEqual([COMMS_PAGE_SIZE, COMMS_PAGE_SIZE * 2 - 1]);
  });

  it('stops at a failed account read, rather than continuing with an empty roster', async () => {
    const { client, calls } = makeClient({
      comm_accounts: { data: null, error: { message: 'nope' } },
    });

    const { seed, error } = await readCommsSnapshot(client);

    expect(error?.message).toBe('nope');
    expect(seed.accounts).toEqual([]);
    expect(calls.comm_messages).toHaveLength(0);
  });

  it('reports a failed shelf read rather than shipping a shelf of nothing', async () => {
    const queued = makeCommMessage(ACCOUNT.id, { tier: 'today', judged_by: 'model' });
    const { client } = makeClient({
      comm_accounts: { data: [ACCOUNT], error: null },
      comm_messages: messages({
        active: { data: [queued], error: null },
        shelf: { data: null, error: { message: 'shelf down' } },
      }),
    });

    const { seed, error } = await readCommsSnapshot(client);

    expect(error?.message).toBe('shelf down');
    expect(seed.accounts).toEqual([ACCOUNT]);
    expect(seed.shelfCount).toBe(0);
  });

  it('reports a verdict read error, keeping what already succeeded and attempting nothing after', async () => {
    const judged = makeCommMessage(ACCOUNT.id, {
      tier: 'today',
      judged_by: 'model',
      verdict_id: '00000000-0000-4000-8000-0000000000ab',
    });
    const { client, calls } = makeClient({
      comm_accounts: { data: [ACCOUNT], error: null },
      comm_messages: messages({ active: { data: [judged], error: null } }),
      comm_verdicts: { data: null, error: { message: 'nope' } },
    });

    const { seed, error } = await readCommsSnapshot(client);

    expect(error?.message).toBe('nope');
    expect(seed.accounts).toEqual([ACCOUNT]);
    expect(seed.messages).toEqual([judged]);
    expect(seed.verdicts).toEqual([]);
    expect(calls.comm_classifier_health).toHaveLength(0);
  });

  it('reports a failed health read rather than a stale one', async () => {
    const { client } = makeClient({
      comm_accounts: { data: [ACCOUNT], error: null },
      comm_classifier_health: { data: null, error: { message: 'nope' } },
    });

    const { seed, error } = await readCommsSnapshot(client);

    expect(error?.message).toBe('nope');
    expect(seed.health).toBeUndefined();
    expect(seed.accounts).toEqual([ACCOUNT]);
  });
});

describe('getCommsSeed', () => {
  it('seeds the shell from the first shelf page, creating its own client', async () => {
    const { client, calls } = makeClient({ comm_accounts: { data: [ACCOUNT], error: null } });
    mockCreateClient.mockResolvedValue(client);

    const seed = await getCommsSeed();

    expect(seed.accounts).toEqual([ACCOUNT]);
    const shelf = calls.comm_messages.find((query) => messageRead(query) === 'shelf');
    expect(shelf?.limit).toBe(SHELF_PAGE_SIZE);
  });

  it('degrades in layers rather than failing the shell', async () => {
    const { client } = makeClient({
      comm_accounts: { data: [ACCOUNT], error: null },
      comm_classifier_health: { data: null, error: { message: 'nope' } },
    });

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
