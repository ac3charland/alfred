/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { makeReaderCandidate } from '@/lib/reader/fixtures';
import { createClient } from '@/lib/supabase/server';

import { GET } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const STUB_CONTEXT = { params: Promise.resolve({}) };

function read(): Request {
  return new Request('http://localhost/api/reader/publications/candidates');
}

describe('GET /api/reader/publications/candidates', () => {
  it("returns the candidates in the view's own rank", async () => {
    const candidate = makeReaderCandidate('news@example.com');
    const supabase = makeSupabaseDouble({ v_reader_candidates: { list: { data: [candidate] } } });
    mockCreateClient.mockResolvedValue(supabase as never);

    const response = await GET(read(), STUB_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([candidate]);
    expect(supabase.table('v_reader_candidates').order).not.toHaveBeenCalled();
  });

  it('returns 401 without a session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await GET(read(), STUB_CONTEXT);

    expect(response.status).toBe(401);
  });

  it('maps a failed read to its status', async () => {
    const supabase = makeSupabaseDouble({
      v_reader_candidates: { list: { data: null, error: { message: 'boom' } } },
    });
    mockCreateClient.mockResolvedValue(supabase as never);

    const response = await GET(read(), STUB_CONTEXT);

    expect(response.status).toBe(500);
  });
});
