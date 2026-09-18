/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { makeSignedOutDouble, makeSupabaseDouble } from '@/lib/api/supabase-route-double';
import { pinClock } from '@/lib/pin-clock';
import { makeReaderPost, makeReaderPublication } from '@/lib/reader/fixtures';
import { createClient } from '@/lib/supabase/server';

import { PATCH } from './route';

jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

pinClock('2026-09-18T12:00:00.000Z');

const PUBLICATION = makeReaderPublication('Second Thoughts');
const POST_ID = '11111111-1111-4111-8111-111111111111';
const POST = makeReaderPost(PUBLICATION.id, { id: POST_ID });

function signedIn(
  overrides: Parameters<typeof makeSupabaseDouble>[0] = {},
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = makeSupabaseDouble({
    reader_posts: { maybeSingle: { data: POST } },
    ...overrides,
  });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function patch(id: string, body: unknown): Request {
  return new Request(`http://localhost/api/reader/posts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

describe('PATCH /api/reader/posts/[id]', () => {
  it('archives the row, stamping archived_at at the current instant', async () => {
    const supabase = signedIn();

    const response = await PATCH(patch(POST_ID, { archived: true }), context(POST_ID));

    expect(response.status).toBe(200);
    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith({
      archived_at: '2026-09-18T12:00:00.000Z',
    });
  });

  it('unarchives the row, nulling archived_at — a boolean is a boolean', async () => {
    const supabase = signedIn();

    await PATCH(patch(POST_ID, { archived: false }), context(POST_ID));

    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith({ archived_at: null });
  });

  it('marks the row opened, stamping opened_at', async () => {
    const supabase = signedIn();

    await PATCH(patch(POST_ID, { opened: true }), context(POST_ID));

    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith({
      opened_at: '2026-09-18T12:00:00.000Z',
    });
  });

  it('reads the row back through the shared column list — no text', async () => {
    const supabase = signedIn();

    await PATCH(patch(POST_ID, { archived: true }), context(POST_ID));

    // Compared as a COLUMN rather than as a substring: `text_swept_at` is a column the list does
    // carry, and a substring match on "text" would read it as the body coming back.
    const [columns] = supabase.table('reader_posts').select.mock.calls[0] as [string];
    expect(columns.split(',')).not.toContain('text');
  });

  it('401s with no session', async () => {
    mockCreateClient.mockResolvedValue(makeSignedOutDouble() as never);

    const response = await PATCH(patch(POST_ID, { archived: true }), context(POST_ID));

    expect(response.status).toBe(401);
  });

  it('400s on a malformed id', async () => {
    signedIn();

    const response = await PATCH(patch('nope', { archived: true }), context('nope'));

    expect(response.status).toBe(400);
  });

  it.each([
    ['opened: false has no meaning to accept', { opened: false }],
    ['a non-boolean archived value', { archived: 'yes' }],
    [
      'both verbs at once — ambiguous about which timestamp matters',
      { archived: true, opened: true },
    ],
    ['an empty body', {}],
  ])('400s on %s', async (_name, body) => {
    signedIn();

    const response = await PATCH(patch(POST_ID, body), context(POST_ID));

    expect(response.status).toBe(400);
  });

  it('404s for a post that is not there', async () => {
    signedIn({ reader_posts: { maybeSingle: { data: null } } });

    const response = await PATCH(patch(POST_ID, { archived: true }), context(POST_ID));

    expect(response.status).toBe(404);
  });

  it('maps a failed write to its status', async () => {
    signedIn({ reader_posts: { maybeSingle: { data: null, error: { message: 'boom' } } } });

    const response = await PATCH(patch(POST_ID, { archived: true }), context(POST_ID));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'boom' });
  });
});

/**
 * The re-summarise verb reads the row and then writes it, both through `.maybeSingle()` on the
 * same table, so the two answers are queued in the order the handler asks for them: the stored
 * text first, the patched row second.
 */
function withStoredText(
  stored: { text: string | null; text_swept_at: string | null } | null,
): ReturnType<typeof makeSupabaseDouble> {
  const supabase = signedIn();
  supabase.table('reader_posts').maybeSingle.mockResolvedValueOnce({ data: stored });
  return supabase;
}

describe('PATCH /api/reader/posts/[id] — re-summarise', () => {
  it('puts the row back on the worklist, keeping the summary it already has', async () => {
    const supabase = withStoredText({ text: 'the whole post', text_swept_at: null });

    const response = await PATCH(patch(POST_ID, { resummarize: true }), context(POST_ID));

    expect(response.status).toBe(200);
    expect(supabase.table('reader_posts').update).toHaveBeenCalledWith({
      summary_state: 'pending',
      summarize_attempts: 0,
      last_error: null,
      summarizing_since: null,
    });
  });

  it('reads the stored body before queueing anything', async () => {
    const supabase = withStoredText({ text: 'the whole post', text_swept_at: null });

    await PATCH(patch(POST_ID, { resummarize: true }), context(POST_ID));

    expect(supabase.table('reader_posts').select).toHaveBeenNthCalledWith(1, 'text,text_swept_at');
  });

  it('404s for a post that is not there', async () => {
    withStoredText(null);

    const response = await PATCH(patch(POST_ID, { resummarize: true }), context(POST_ID));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Post not found' });
  });

  it('409s with the sweep date when the retention sweep took the text', async () => {
    withStoredText({ text: null, text_swept_at: '2026-09-08T03:00:00.000Z' });

    const response = await PATCH(patch(POST_ID, { resummarize: true }), context(POST_ID));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Post text was swept on Sep 8, 2026',
    });
  });

  it('names the sweep even when the row somehow still holds a body', async () => {
    // The stamp is the audit trail for what happened to the row; a body present beside it is a
    // state nothing writes, and answering "no stored text" would be the wrong story.
    withStoredText({ text: 'somehow still here', text_swept_at: '2026-09-08T03:00:00.000Z' });

    const response = await PATCH(patch(POST_ID, { resummarize: true }), context(POST_ID));

    await expect(response.json()).resolves.toEqual({
      error: 'Post text was swept on Sep 8, 2026',
    });
  });

  it('409s when extraction never produced a body to summarise', async () => {
    withStoredText({ text: null, text_swept_at: null });

    const response = await PATCH(patch(POST_ID, { resummarize: true }), context(POST_ID));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Post has no stored text to summarise',
    });
  });

  it('maps a failed pre-read to its status, rather than queueing blind', async () => {
    const supabase = signedIn();
    supabase
      .table('reader_posts')
      .maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

    const response = await PATCH(patch(POST_ID, { resummarize: true }), context(POST_ID));

    expect(response.status).toBe(500);
    expect(supabase.table('reader_posts').update).not.toHaveBeenCalled();
  });
});
