/** @jest-environment node */
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
  return {
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue(result),
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
  it('selects every item, newest first', async () => {
    const client = mockClient({ data: [ITEM] });

    const result = await getAllItems();

    expect(client.from).toHaveBeenCalledWith('items');
    expect(client._chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(result).toStrictEqual([ITEM]);
  });

  it('returns an empty array when there is no data', async () => {
    mockClient({ data: null });
    expect(await getAllItems()).toStrictEqual([]);
  });
});
