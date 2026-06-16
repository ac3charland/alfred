/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createClient } from '@/lib/supabase/server';

import { getAllItems } from './items';

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
