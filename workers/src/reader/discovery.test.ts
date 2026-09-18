import { type FetchInit, type FetchInput, spyOnFetch } from '../fetch-stub';
import type { SupabaseEnv } from '../supabase';
import { discoverPublications } from './discovery';

const env: SupabaseEnv = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

const NOW = new Date('2026-09-18T11:45:00.000Z');

/** A JSON `null` — how PostgREST spells an absent column. This package bans the literal. */
const WIRE_NULL: unknown = JSON.parse('null');

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  rows: Record<string, unknown>[];
}

/** Answer the view read with `found`, and the upsert with whatever it was sent. */
function harness(found: unknown[], upsert?: () => Response): Call[] {
  const calls: Call[] = [];
  spyOnFetch().mockImplementation((input: FetchInput, init?: FetchInit) => {
    const url = input as string;
    const body = typeof init?.body === 'string' ? init.body : '[]';
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      rows: JSON.parse(body) as Record<string, unknown>[],
    });
    if (url.includes('v_reader_discovery')) return Promise.resolve(Response.json(found));
    return Promise.resolve(upsert === undefined ? Response.json(JSON.parse(body)) : upsert());
  });
  return calls;
}

/** The one recorded upsert. */
function upsertCall(calls: Call[]): Call | undefined {
  return calls.find((call) => call.url.includes('reader_publications'));
}

describe('discoverPublications', () => {
  it('upserts each discovered sender with the handle as the conflict target', async () => {
    const calls = harness([
      {
        handle: 'harborline@substack.com',
        name: 'Harborline',
        first_seen_at: '2026-09-12T00:00:00.000Z',
        message_count: 3,
      },
    ]);

    await expect(discoverPublications(env, NOW)).resolves.toBe(1);

    const upsert = upsertCall(calls);
    expect(upsert?.method).toBe('POST');
    expect(upsert?.url).toContain('on_conflict=handle');
    // `ignore-duplicates`, never `merge-duplicates`: a handle already on the roster carries the
    // owner's own edits — a rename, `enabled = false` after they paused it — and a merge would
    // quietly undo both on the next tick that saw one more message from it.
    expect(upsert?.headers['Prefer']).toBe('resolution=ignore-duplicates,return=representation');
    expect(upsert?.rows).toEqual([
      {
        handle: 'harborline@substack.com',
        name: 'Harborline',
        domain: 'harborline.substack.com',
        source: 'auto',
        enabled: true,
      },
    ]);
  });

  it('falls back to the local part when the sender had no display name', async () => {
    const calls = harness([
      {
        handle: 'tallowfield@substack.com',
        name: WIRE_NULL,
        first_seen_at: '2026-09-12T00:00:00.000Z',
        message_count: 1,
      },
    ]);

    await discoverPublications(env, NOW);

    expect(upsertCall(calls)?.rows[0]).toMatchObject({ name: 'tallowfield' });
  });

  it('never upserts a no-reply sender, even though the view already excludes it', async () => {
    // Substack's platform mail carries a list header and a substack.com address, so every signal
    // discovery leans on is present; the local part is all that separates it from a publication.
    // A roster row is hard to notice and harder to remove once the list has filled with digests.
    const calls = harness([
      {
        handle: 'no-reply@substack.com',
        name: 'Substack',
        first_seen_at: '2026-09-12T00:00:00.000Z',
        message_count: 9,
      },
      {
        handle: 'noreply@substack.com',
        name: 'Substack',
        first_seen_at: '2026-09-12T00:00:00.000Z',
        message_count: 4,
      },
    ]);

    await expect(discoverPublications(env, NOW)).resolves.toBe(0);
    expect(upsertCall(calls)).toBeUndefined();
  });

  it('sends no POST at all when the view found nothing', async () => {
    const calls = harness([]);

    await expect(discoverPublications(env, NOW)).resolves.toBe(0);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('v_reader_discovery');
  });

  it('reports what the upsert actually stored, not what it was offered', async () => {
    // With `ignore-duplicates`, a handle an overlapping tick already added comes back unstored.
    const calls = harness(
      [
        {
          handle: 'a@one.substack.com',
          name: 'One',
          first_seen_at: '2026-09-12T00:00:00.000Z',
          message_count: 1,
        },
        {
          handle: 'b@two.substack.com',
          name: 'Two',
          first_seen_at: '2026-09-12T00:00:00.000Z',
          message_count: 1,
        },
      ],
      () => Response.json([{ id: 'pub-1' }]),
    );

    await expect(discoverPublications(env, NOW)).resolves.toBe(1);
    expect(upsertCall(calls)?.rows).toHaveLength(2);
  });

  it('throws on a refused upsert, so a rejected write is a readable log line', async () => {
    expect.assertions(1);
    harness(
      [
        {
          handle: 'a@one.substack.com',
          name: 'One',
          first_seen_at: '2026-09-12T00:00:00.000Z',
          message_count: 1,
        },
      ],
      () => new Response('violates check constraint', { status: 400 }),
    );

    await expect(discoverPublications(env, NOW)).rejects.toThrow(
      'Supabase POST reader_publications failed: 400',
    );
  });

  it('sends every row with the same key set, which PostgREST requires of a batch', async () => {
    // A mixed-shape array is refused WHOLE with `PGRST102: All object keys must match`, so one
    // odd row would lose every publication beside it.
    const calls = harness([
      {
        handle: 'a@one.substack.com',
        name: 'One',
        first_seen_at: '2026-09-12T00:00:00.000Z',
        message_count: 1,
      },
      {
        handle: 'b@two.substack.com',
        name: WIRE_NULL,
        first_seen_at: '2026-09-12T00:00:00.000Z',
        message_count: 1,
      },
    ]);

    await discoverPublications(env, NOW);

    const rows = upsertCall(calls)?.rows ?? [];
    expect(new Set(Object.keys(rows[0] ?? {}))).toEqual(new Set(Object.keys(rows[1] ?? {})));
  });
});
