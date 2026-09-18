/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { READER_POST_LIST_COLUMNS } from '@/lib/data/reader';
import { makeReaderPost, makeReaderPublication } from '@/lib/reader/fixtures';
import { createClient } from '@/lib/supabase/server';

import { GET } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const PUBLICATION = makeReaderPublication('Second Thoughts');
const POST = makeReaderPost(PUBLICATION.id);

function signedIn(
  overrides: Parameters<typeof makeSupabaseDouble>[0] = {},
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({
    reader_posts: { list: { data: [POST] } },
    ...overrides,
  });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function read(query: string): Request {
  return new Request(`http://localhost/api/reader/posts?${query}`);
}

const STUB_CONTEXT = { params: Promise.resolve({}) };

describe('GET /api/reader/posts', () => {
  it('reads the shared list column set — never the post body', async () => {
    const supabase = signedIn();

    await GET(read(''), STUB_CONTEXT);

    expect(supabase.table('reader_posts').select).toHaveBeenCalledWith(READER_POST_LIST_COLUMNS);
  });

  it('defaults to the active scope — not archived, not null', async () => {
    const supabase = signedIn();

    const response = await GET(read(''), STUB_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([POST]);
    expect(supabase.table('reader_posts').is).toHaveBeenCalledWith('archived_at', null);
    expect(supabase.table('reader_posts').not).not.toHaveBeenCalled();
  });

  it('reads the archived side on scope=archived', async () => {
    const supabase = signedIn();

    const response = await GET(read('scope=archived'), STUB_CONTEXT);

    expect(response.status).toBe(200);
    expect(supabase.table('reader_posts').not).toHaveBeenCalledWith('archived_at', 'is', null);
    expect(supabase.table('reader_posts').is).not.toHaveBeenCalled();
  });

  it('orders newest-received first', async () => {
    const supabase = signedIn();

    await GET(read(''), STUB_CONTEXT);

    expect(supabase.table('reader_posts').order).toHaveBeenCalledWith('received_at', {
      ascending: false,
    });
  });

  it('defaults the limit to 200', async () => {
    const supabase = signedIn();

    await GET(read(''), STUB_CONTEXT);

    expect(supabase.table('reader_posts').limit).toHaveBeenCalledWith(200);
  });

  it('honours an explicit limit', async () => {
    const supabase = signedIn();

    await GET(read('limit=50'), STUB_CONTEXT);

    expect(supabase.table('reader_posts').limit).toHaveBeenCalledWith(50);
  });

  it('400s when the limit exceeds the 500 cap', async () => {
    signedIn();

    const response = await GET(read('limit=501'), STUB_CONTEXT);

    expect(response.status).toBe(400);
  });

  it('400s on a limit below 1', async () => {
    signedIn();

    const response = await GET(read('limit=0'), STUB_CONTEXT);

    expect(response.status).toBe(400);
  });

  it('400s on a scope the module does not have', async () => {
    signedIn();

    const response = await GET(read('scope=other'), STUB_CONTEXT);

    expect(response.status).toBe(400);
  });

  it('401s with no session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await GET(read(''), STUB_CONTEXT);

    expect(response.status).toBe(401);
  });

  it('maps a failed read to its status', async () => {
    signedIn({ reader_posts: { list: { data: null, error: { message: 'boom' } } } });

    const response = await GET(read(''), STUB_CONTEXT);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'boom' });
  });
});
