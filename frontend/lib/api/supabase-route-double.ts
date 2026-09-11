/**
 * The chainable Supabase double every Route Handler test needs, in one place.
 *
 * A handler's query is a builder chain that may end in `.maybeSingle()` (a read that tolerates
 * "no such row"), `.single()` (a write returning the row it wrote), or nothing at all (a list
 * read, awaited directly). Stubbing that by hand is thirty lines of `jest.fn(() => chain)` per
 * test file, and the comms routes need several tables and BOTH terminals on the same table — a
 * route reads a message, then writes it — which one shared result can't express.
 *
 * So a table is stubbed by TERMINAL: `maybeSingle` for the read, `single` for the write, `list`
 * for the awaited chain. Anything a test didn't stub resolves empty rather than throwing, so a
 * test names only the calls it cares about.
 *
 * The chain IS a resolved promise with the builder methods hung off it, rather than an object
 * carrying a hand-written `then`. Same behaviour under `await`, and it keeps the double honest:
 * a hand-rolled `then` on a plain object is the trap `unicorn/no-thenable` exists to catch, and
 * the fix is to use a real promise rather than to imitate one.
 *
 * Test-only, but it lives beside the `lib/api` helpers the handlers themselves use rather than
 * inside one test file, because a dozen route suites share it.
 */

/** What one terminal resolves with — the Supabase `{ data, error }` envelope. */
export interface MockResult {
  data: unknown;
  error?: { message: string; code?: string } | undefined;
}

/** Per-table stubs, keyed by the terminal the handler's chain ends in. */
export interface TableStub {
  /** A read that tolerates a missing row (`.maybeSingle()`). */
  maybeSingle?: MockResult;
  /** A write returning its row (`.single()`). */
  single?: MockResult;
  /** An awaited chain with no terminal — a list read, or a delete. */
  list?: MockResult;
}

const EMPTY: MockResult = { data: null, error: undefined };

/** One table's builder chain: every filter method returns it, and awaiting it resolves. */
export interface TableChain extends PromiseLike<MockResult> {
  select: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  eq: jest.Mock;
  is: jest.Mock;
  in: jest.Mock;
  or: jest.Mock;
  order: jest.Mock;
  limit: jest.Mock;
  overrideTypes: jest.Mock;
  single: jest.Mock;
  maybeSingle: jest.Mock;
}

/** One stubbed table. Exported so a suite can build a chain for a table it names itself. */
export function makeChain(stub: TableStub = {}): TableChain {
  // A real promise, extended in place: awaiting the chain is the promise's own `then`, and the
  // builder methods are properties on it.
  const chain = Promise.resolve(stub.list ?? stub.single ?? EMPTY) as unknown as TableChain;
  const self = (): TableChain => chain;

  Object.assign(chain, {
    select: jest.fn(self),
    insert: jest.fn(self),
    update: jest.fn(self),
    delete: jest.fn(self),
    eq: jest.fn(self),
    is: jest.fn(self),
    in: jest.fn(self),
    or: jest.fn(self),
    order: jest.fn(self),
    limit: jest.fn(self),
    overrideTypes: jest.fn(self),
    single: jest.fn(() => Promise.resolve(stub.single ?? EMPTY)),
    maybeSingle: jest.fn(() => Promise.resolve(stub.maybeSingle ?? EMPTY)),
  });

  return chain;
}

/** The whole client double: an authenticated user, the stubbed tables, and `rpc`. */
export interface SupabaseDouble {
  auth: { getUser: jest.Mock };
  from: jest.Mock;
  rpc: jest.Mock;
  /**
   * One table's chain, so a test can assert what the handler actually sent. A method rather
   * than a record because a record is an index signature, and reading `tables.comm_messages`
   * off one is a type error under `noPropertyAccessFromIndexSignature`.
   */
  table: (name: string) => TableChain;
}

/**
 * A signed-in Supabase double. `tables` names the stubs per table; `rpcResult` is what any
 * `supabase.rpc(...)` resolves with.
 */
export function makeSupabaseDouble(
  tables: Record<string, TableStub>,
  rpcResult?: MockResult,
): SupabaseDouble {
  const chains: Record<string, TableChain> = {};
  for (const [name, stub] of Object.entries(tables)) chains[name] = makeChain(stub);

  // An unstubbed table still answers, so a handler touching one the test didn't name fails on
  // its assertion rather than on a TypeError three frames deep.
  const table = (name: string): TableChain => (chains[name] ??= makeChain());

  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-123' } } }) },
    from: jest.fn((name: string) => table(name)),
    rpc: jest.fn(() => Promise.resolve(rpcResult ?? EMPTY)),
    table,
  };
}

/** A client with no session — every `withSession` handler must answer 401 through this. */
export function makeSignedOutDouble(): { auth: { getUser: jest.Mock }; from: jest.Mock } {
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: undefined } }) },
    from: jest.fn(),
  };
}
