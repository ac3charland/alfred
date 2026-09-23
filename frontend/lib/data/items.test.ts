/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createClient } from '@/lib/supabase/server';

import { getAllItems, getItems } from './items';

// `import 'server-only'` throws outside a Server Component context; neutralise it under Jest.
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

interface MockResult {
  data: unknown;
  error?: { message: string };
}

function makeChain(result: MockResult) {
  // The reader chains `.overrideTypes<Item[]>()` after `.order()` — a type-only passthrough
  // in supabase-js — then awaits the result. Model the tail of the chain as an object whose
  // `overrideTypes()` resolves to the query result (so the final `await` yields it).
  const builder = { overrideTypes: jest.fn().mockResolvedValue(result) };
  return {
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnValue(builder),
    _builder: builder,
  };
}

function mockClient(result: MockResult) {
  const chain = makeChain(result);
  const client = { from: jest.fn().mockReturnValue(chain), _chain: chain };
  mockCreateClient.mockResolvedValue(client as never);
  return client;
}

const ITEM = { id: 'r-1', title: 'Task', status: 'active' };

describe('getAllItems', () => {
  it('reads the task_items view (factory items excluded), newest first', async () => {
    const client = mockClient({ data: [ITEM] });

    const result = await getAllItems();

    // The Tasks/Inbox views must exclude factory stories (items with a code_items
    // sidecar). That membership split lives in the `task_items` view, so the
    // reader queries the view, not the raw `items` table — a factory item never reaches
    // the tasks store. The mock backend's task_items view exercises the exclusion itself.
    expect(client.from).toHaveBeenCalledWith('task_items');
    expect(client._chain.select).toHaveBeenCalledWith('*');
    expect(client._chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    // The nullable view row is overridden back to the non-null `Item` shape (the view is
    // `select i.*`, so it always yields full item rows — see getAllItems).
    expect(client._chain._builder.overrideTypes).toHaveBeenCalled();
    expect(result).toStrictEqual([ITEM]);
  });

  it('returns an empty array when there is no data', async () => {
    mockClient({ data: null });
    expect(await getAllItems()).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getItems — the keyed GET /api/items reader. Reads `task_items` unconditionally (the same
// view getAllItems reads — see the doc comment on getItems for why the raw `items` table is
// never exposed through this endpoint).
// ---------------------------------------------------------------------------

/** A chain with the extra filter methods `getItems` calls (`.eq` / `.is`), tailed by
 * `.overrideTypes()` after `.order()` (mirroring `getAllItems`'s `makeChain` above). */
function makeItemsChain(result: MockResult) {
  const builder = { overrideTypes: jest.fn().mockResolvedValue(result) };
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnValue(builder),
  };
  return { chain, builder };
}

function mockItemsClient(result: MockResult) {
  const { chain, builder } = makeItemsChain(result);
  const client = { from: jest.fn().mockReturnValue(chain), _chain: chain, _builder: builder };
  mockCreateClient.mockResolvedValue(client as never);
  return client;
}

describe('getItems', () => {
  it('reads the "task_items" view, not the raw "items" table', async () => {
    // task_items already excludes any item gated into the Software Factory. GET /api/items is
    // reachable only through a browser session (withSession — see lib/api/auth), and nothing
    // in the app needs to see a gated item back out through this list, so this is unconditional
    // rather than opt-in — see the doc comment on getItems.
    const client = mockItemsClient({ data: [ITEM] });

    const result = await getItems({ status: 'all' });

    expect(client.from).toHaveBeenCalledWith('task_items');
    expect(client.from).not.toHaveBeenCalledWith('items');
    expect(client._chain.select).toHaveBeenCalledWith('*');
    expect(client._chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    // Same nullable-view-column override getAllItems applies, at the same spot in the chain.
    expect(client._builder.overrideTypes).toHaveBeenCalled();
    expect(result).toStrictEqual({ data: [ITEM] });
  });

  it('applies the inbox/folder/status filters', async () => {
    const client = mockItemsClient({ data: [] });

    await getItems({ inbox: true });

    expect(client._chain.is).toHaveBeenCalledWith('dispatched_at', null);
    expect(client._chain.eq).not.toHaveBeenCalledWith('folder_id', expect.anything());
    // Default status is 'active' — filtered unless 'all'.
    expect(client._chain.eq).toHaveBeenCalledWith('status', 'active');
  });
});
