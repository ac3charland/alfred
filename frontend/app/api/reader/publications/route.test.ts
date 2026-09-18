/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { makeReaderPublication, makeReaderPublicationListItem } from '@/lib/reader/fixtures';
import { createClient } from '@/lib/supabase/server';

import { GET, POST } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const STUB_CONTEXT = { params: Promise.resolve({}) };

function signedIn(
  overrides: Parameters<typeof makeSupabaseDouble>[0] = {},
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble(overrides);
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function signedOut(): void {
  mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);
}

function read(): Request {
  return new Request('http://localhost/api/reader/publications');
}

function post(body: unknown): Request {
  return new Request('http://localhost/api/reader/publications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/reader/publications', () => {
  it('returns the roster ordered by name', async () => {
    const publication = makeReaderPublicationListItem('Second Thoughts');
    const supabase = signedIn({ v_reader_publications: { list: { data: [publication] } } });

    const response = await GET(read(), STUB_CONTEXT);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([publication]);
    expect(supabase.table('v_reader_publications').order).toHaveBeenCalledWith('name', {
      ascending: true,
    });
  });

  it('returns 401 without a session', async () => {
    signedOut();
    const response = await GET(read(), STUB_CONTEXT);
    expect(response.status).toBe(401);
  });

  it('maps a failed read to its status', async () => {
    signedIn({ v_reader_publications: { list: { data: null, error: { message: 'boom' } } } });
    const response = await GET(read(), STUB_CONTEXT);
    expect(response.status).toBe(500);
  });
});

describe('POST /api/reader/publications', () => {
  it('normalises the handle, defaults the name and derives the domain', async () => {
    const saved = makeReaderPublication('news', { handle: 'news@example.com', source: 'owner' });
    const supabase = signedIn({ reader_publications: { single: { data: saved } } });

    const response = await POST(post({ handle: '  News@Example.com ' }), STUB_CONTEXT);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(saved);
    expect(supabase.table('reader_publications').insert).toHaveBeenCalledWith({
      handle: 'news@example.com',
      name: 'news',
      domain: 'example.com',
      source: 'owner',
      enabled: true,
    });
  });

  it('keeps a supplied name rather than deriving one', async () => {
    const saved = makeReaderPublication('Weekly News');
    const supabase = signedIn({ reader_publications: { single: { data: saved } } });

    await POST(post({ handle: 'news@example.com', name: 'Weekly News' }), STUB_CONTEXT);

    expect(supabase.table('reader_publications').insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Weekly News' }),
    );
  });

  it('409s on a handle already on the roster', async () => {
    signedIn({
      reader_publications: {
        single: {
          data: null,
          error: {
            message:
              'duplicate key value violates unique constraint "reader_publications_handle_key"',
            code: '23505',
          },
        },
      },
    });

    const response = await POST(post({ handle: 'news@example.com' }), STUB_CONTEXT);

    expect(response.status).toBe(409);
  });

  it('400s on a missing handle', async () => {
    signedIn();
    const response = await POST(post({}), STUB_CONTEXT);
    expect(response.status).toBe(400);
  });

  it('400s on a blank handle', async () => {
    signedIn();
    const response = await POST(post({ handle: ' '.repeat(3) }), STUB_CONTEXT);
    expect(response.status).toBe(400);
  });

  it('returns 401 without a session', async () => {
    signedOut();
    const response = await POST(post({ handle: 'news@example.com' }), STUB_CONTEXT);
    expect(response.status).toBe(401);
  });
});
