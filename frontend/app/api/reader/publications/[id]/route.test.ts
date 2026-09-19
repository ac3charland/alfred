/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { makeReaderPublication } from '@/lib/reader/fixtures';
import { createClient } from '@/lib/supabase/server';

import { PATCH } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const PUBLICATION_ID = '11111111-1111-4111-8111-111111111111';
const PUBLICATION = makeReaderPublication('Second Thoughts', { id: PUBLICATION_ID });

function signedIn(
  overrides: Parameters<typeof makeSupabaseDouble>[0] = {},
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({
    reader_publications: { maybeSingle: { data: PUBLICATION } },
    ...overrides,
  });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function patch(id: string, body: unknown): Request {
  return new Request(`http://localhost/api/reader/publications/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe('PATCH /api/reader/publications/[id]', () => {
  it('pauses a publication', async () => {
    const supabase = signedIn();

    const response = await PATCH(
      patch(PUBLICATION_ID, { enabled: false }),
      context(PUBLICATION_ID),
    );

    expect(response.status).toBe(200);
    expect(supabase.table('reader_publications').update).toHaveBeenCalledWith({ enabled: false });
  });

  it('renames a publication', async () => {
    const supabase = signedIn();

    await PATCH(patch(PUBLICATION_ID, { name: 'New Name' }), context(PUBLICATION_ID));

    expect(supabase.table('reader_publications').update).toHaveBeenCalledWith({
      name: 'New Name',
    });
  });

  it('sets and clears the note', async () => {
    const supabase = signedIn();

    await PATCH(patch(PUBLICATION_ID, { notes: 'why this one' }), context(PUBLICATION_ID));
    expect(supabase.table('reader_publications').update).toHaveBeenCalledWith({
      notes: 'why this one',
    });

    await PATCH(patch(PUBLICATION_ID, { notes: null }), context(PUBLICATION_ID));
    expect(supabase.table('reader_publications').update).toHaveBeenLastCalledWith({ notes: null });
  });

  it('ignores a handle in the body rather than ever accepting one — an otherwise-empty body 400s', async () => {
    signedIn();

    const response = await PATCH(
      patch(PUBLICATION_ID, { handle: 'new@example.com' }),
      context(PUBLICATION_ID),
    );

    expect(response.status).toBe(400);
  });

  it('400s on an empty body', async () => {
    signedIn();

    const response = await PATCH(patch(PUBLICATION_ID, {}), context(PUBLICATION_ID));

    expect(response.status).toBe(400);
  });

  it('400s on a malformed id', async () => {
    signedIn();

    const response = await PATCH(patch('nope', { enabled: false }), context('nope'));

    expect(response.status).toBe(400);
  });

  it('404s for a publication that is not there', async () => {
    signedIn({ reader_publications: { maybeSingle: { data: null } } });

    const response = await PATCH(
      patch(PUBLICATION_ID, { enabled: false }),
      context(PUBLICATION_ID),
    );

    expect(response.status).toBe(404);
  });

  it('401s with no session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await PATCH(
      patch(PUBLICATION_ID, { enabled: false }),
      context(PUBLICATION_ID),
    );

    expect(response.status).toBe(401);
  });

  it('maps a failed write to its status', async () => {
    signedIn({ reader_publications: { maybeSingle: { data: null, error: { message: 'boom' } } } });

    const response = await PATCH(
      patch(PUBLICATION_ID, { enabled: false }),
      context(PUBLICATION_ID),
    );

    expect(response.status).toBe(500);
  });
});
