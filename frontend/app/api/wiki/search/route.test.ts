/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {
  type MockResult,
  makeSignedOutDouble,
  makeSupabaseDouble,
} from '@/lib/api/supabase-route-double';
import { createClient } from '@/lib/supabase/server';

import { GET } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const HITS = [
  {
    path: 'wiki/sources/brain-rules.md',
    snippet: 'Medina argues that \u0002forgetting\u0003 is the brain pruning',
    rank: 0.25,
  },
];

function signedIn(rpcResult?: MockResult) {
  const supabase = makeSupabaseDouble({}, rpcResult ?? { data: HITS });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function search(query: string): Request {
  return new Request(`http://localhost/api/wiki/search?${query}`);
}

const STUB_CONTEXT = { params: Promise.resolve({}) };

describe('GET /api/wiki/search', () => {
  it('answers the ranked hits, asking the RPC for the trimmed query and the default limit', async () => {
    const supabase = signedIn();

    const response = await GET(search('q=%20forgetting%20'), STUB_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(HITS);
    expect(supabase.rpc).toHaveBeenCalledWith('search_wiki_pages', {
      p_query: 'forgetting',
      p_limit: 20,
    });
  });

  it('passes a requested limit through', async () => {
    const supabase = signedIn();

    await GET(search('q=habit&limit=5'), STUB_CONTEXT);

    expect(supabase.rpc).toHaveBeenCalledWith('search_wiki_pages', {
      p_query: 'habit',
      p_limit: 5,
    });
  });

  it('answers an empty list when the RPC returns no rows', async () => {
    signedIn({ data: null });

    const response = await GET(search('q=zettelkasten'), STUB_CONTEXT);

    await expect(response.json()).resolves.toEqual([]);
  });

  it.each(['q=a', 'q=%20a%20', 'q=', ''])(
    'refuses %j (under two characters) with 400 before any search',
    async (query) => {
      const supabase = signedIn();

      const response = await GET(search(query), STUB_CONTEXT);

      expect(response.status).toBe(400);
      expect(supabase.rpc).not.toHaveBeenCalled();
    },
  );

  it('refuses a limit out of range with 400', async () => {
    const supabase = signedIn();

    const response = await GET(search('q=habit&limit=500'), STUB_CONTEXT);

    expect(response.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('maps an RPC error to its status', async () => {
    signedIn({ data: null, error: { message: 'boom' } });

    const response = await GET(search('q=habit'), STUB_CONTEXT);

    expect(response.status).toBe(500);
  });

  it('rejects an unauthenticated request with 401', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await GET(search('q=habit'), STUB_CONTEXT);

    expect(response.status).toBe(401);
  });
});
