/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createClient } from '@/lib/supabase/server';

import { getFolders } from './folders';

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

const FOLDER = { id: 'f-1', name: 'Work', created_at: '2025-01-01T00:00:00Z' };

describe('getFolders', () => {
  it('returns folders ordered by created_at ascending', async () => {
    const client = mockClient({ data: [FOLDER] });

    const result = await getFolders();

    expect(client.from).toHaveBeenCalledWith('folders');
    expect(client._chain.select).toHaveBeenCalledWith('*');
    expect(client._chain.order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(result).toStrictEqual([FOLDER]);
  });

  it('returns an empty array when the query yields no data', async () => {
    mockClient({ data: null });
    expect(await getFolders()).toStrictEqual([]);
  });
});
