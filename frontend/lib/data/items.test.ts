/** @jest-environment node */
import { createClient } from '@/lib/supabase/server';

import { getCompletedItems, getFolderItems, getInboxTree } from './items';

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
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue(result),
  };
}

function mockClient(result: MockResult) {
  const chain = makeChain(result);
  const client = { from: jest.fn().mockReturnValue(chain), _chain: chain };
  mockCreateClient.mockResolvedValue(client as never);
  return client;
}

const ROOT = {
  id: 'r-1',
  title: 'Parent',
  notes: null,
  source_url: null,
  item_type: 'task' as const,
  created_at: '2025-01-02T00:00:00Z',
  raw_capture: null,
  due_date: null,
  status: 'active' as const,
  completed_at: null,
  folder_id: null,
  parent_id: null,
};
const CHILD = {
  ...ROOT,
  id: 'c-1',
  title: 'Child',
  parent_id: 'r-1',
  created_at: '2025-01-01T00:00:00Z',
};

describe('getInboxTree', () => {
  it('scopes to folder-less active items, newest first, and builds the tree', async () => {
    const client = mockClient({ data: [ROOT, CHILD] });

    const tree = await getInboxTree();

    expect(client.from).toHaveBeenCalledWith('items');
    expect(client._chain.is).toHaveBeenCalledWith('folder_id', null);
    expect(client._chain.eq).toHaveBeenCalledWith('status', 'active');
    expect(client._chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    // buildTree nests CHILD under ROOT: one root with one child.
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children.map((c) => c.id)).toStrictEqual(['c-1']);
  });

  it('returns an empty forest when there is no data', async () => {
    mockClient({ data: null });
    expect(await getInboxTree()).toStrictEqual([]);
  });
});

describe('getFolderItems', () => {
  it('scopes to the folder id and active status', async () => {
    const client = mockClient({ data: [] });

    await getFolderItems('f-1');

    expect(client._chain.eq).toHaveBeenCalledWith('folder_id', 'f-1');
    expect(client._chain.eq).toHaveBeenCalledWith('status', 'active');
    expect(client._chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });
});

describe('getCompletedItems', () => {
  it('scopes to completed status, most recently completed first', async () => {
    const client = mockClient({ data: [] });

    await getCompletedItems();

    expect(client._chain.eq).toHaveBeenCalledWith('status', 'completed');
    expect(client._chain.order).toHaveBeenCalledWith('completed_at', { ascending: false });
  });
});
