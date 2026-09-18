import { type FetchInit, type FetchInput, spyOnFetch } from '../fetch-stub';
import type { SupabaseEnv } from '../supabase';
import { JSON_NULL, claimCommMessage, countRows, insertPost, leasePost, patchPost } from './store';

const env: SupabaseEnv = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

const NOW = new Date('2026-09-18T11:45:00.000Z');

interface Call {
  url: string;
  method: string;
  body: string | undefined;
  headers: Record<string, string>;
}

/** Record every call and answer each with the next queued response. */
function harness(responses: Response[]): Call[] {
  const calls: Call[] = [];
  const queue = [...responses];
  spyOnFetch().mockImplementation((input: FetchInput, init?: FetchInit) => {
    calls.push({
      url: input as string,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return Promise.resolve(queue.shift() ?? Response.json([]));
  });
  return calls;
}

/** The decoded query string of a recorded call, so an encoded filter reads as it was written. */
function query(call: Call | undefined): string {
  return decodeURIComponent(new URL(call?.url ?? 'https://x/').search);
}

describe('countRows', () => {
  it('asks for a count instead of the rows, and parses the total out of Content-Range', () => {
    // The ceiling reads a number, not a day of posts. `Prefer: count=exact` REPLACES the
    // `return=representation` that `headers(env)` sets — asking for both hands back every row.
    const calls = harness([new Response('[]', { headers: { 'Content-Range': '0-0/29' } })]);

    return countRows(env, 'reader_posts', { model_called_at: 'gte.2026-09-18T00:00:00.000Z' }).then(
      (total) => {
        expect(total).toBe(29);
        expect(calls[0]?.headers['Prefer']).toBe('count=exact');
        expect(calls[0]?.headers['Range']).toBe('0-0');
        expect(query(calls[0])).toContain('select=id');
        expect(query(calls[0])).toContain('model_called_at=gte.2026-09-18T00:00:00.000Z');
      },
    );
  });

  it('reads an empty table as zero', async () => {
    harness([new Response('[]', { headers: { 'Content-Range': '*/0' } })]);
    await expect(countRows(env, 'reader_posts', {})).resolves.toBe(0);
  });

  it('throws rather than reading a missing header as zero', async () => {
    // Zero is "unlimited" by another name, and the ceiling is the money guard.
    expect.assertions(1);
    harness([new Response('[]')]);
    await expect(countRows(env, 'reader_posts', {})).rejects.toThrow('Content-Range');
  });

  it('throws on an unparsable header', async () => {
    expect.assertions(1);
    harness([new Response('[]', { headers: { 'Content-Range': 'nonsense' } })]);
    await expect(countRows(env, 'reader_posts', {})).rejects.toThrow('Content-Range');
  });

  it('throws on a non-2xx', async () => {
    expect.assertions(1);
    harness([new Response('denied', { status: 403 })]);
    await expect(countRows(env, 'reader_posts', {})).rejects.toThrow('Supabase COUNT reader_posts');
  });
});

describe('insertPost', () => {
  const row = {
    publication_id: 'pub-1',
    comm_message_id: 'comm-1',
    account_key: 'gmail-personal',
    gmail_message_id: 'gmail-1',
    title: 'The Grain Ledger',
    received_at: '2026-09-16T11:06:40.000Z',
    text: 'body',
    word_count: 1,
    html_extracted: true,
    summary_state: 'pending' as const,
    summarizing_since: NOW.toISOString(),
  };

  it('returns the new id', async () => {
    const calls = harness([Response.json([{ id: 'post-1' }])]);
    await expect(insertPost(env, row)).resolves.toEqual({ inserted: true, id: 'post-1' });
    expect(calls[0]?.method).toBe('POST');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({
      summarizing_since: row.summarizing_since,
    });
  });

  it('reports a 409 as a conflict rather than throwing', async () => {
    // The insert IS the claim, so a duplicate key means another tick owns the post. The
    // caller still has a comms row to stamp, which a throw would skip.
    harness([new Response('duplicate key', { status: 409 })]);
    await expect(insertPost(env, row)).resolves.toEqual({ inserted: false, conflict: true });
  });

  it('throws on any other non-2xx', async () => {
    expect.assertions(1);
    harness([new Response('check constraint', { status: 400 })]);
    await expect(insertPost(env, row)).rejects.toThrow('Supabase POST reader_posts failed: 400');
  });

  it('sends a JSON null for the lease on a capped day, not an absent key', async () => {
    // `JSON.stringify` drops an undefined key, which would leave the column at its default rather
    // than saying anything — here the default happens to agree, but the terminal patches rely on
    // the difference and the two must spell a cleared column the same way.
    const calls = harness([Response.json([{ id: 'post-1' }])]);
    await insertPost(env, { ...row, summarizing_since: JSON_NULL });
    expect(calls[0]?.body).toContain('"summarizing_since":null');
  });
});

describe('claimCommMessage', () => {
  it('stamps reader_claimed_at, which is what takes the row off the FYI shelf', async () => {
    const calls = harness([Response.json([{ id: 'comm-1' }])]);

    await expect(claimCommMessage(env, 'comm-1', NOW)).resolves.toBe(1);

    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url).toContain('/comm_messages');
    expect(query(calls[0])).toBe('?id=eq.comm-1');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ reader_claimed_at: NOW.toISOString() });
  });

  it('reports zero when retention purged the comms row first', async () => {
    harness([Response.json([])]);
    await expect(claimCommMessage(env, 'comm-1', NOW)).resolves.toBe(0);
  });
});

describe('leasePost', () => {
  it('sends the CAS filter: still pending, and unclaimed or stale', async () => {
    const calls = harness([Response.json([{ id: 'post-1' }])]);

    await expect(leasePost(env, 'post-1', NOW)).resolves.toBe(1);

    const sent = query(calls[0]);
    expect(calls[0]?.method).toBe('PATCH');
    expect(sent).toContain('id=eq.post-1');
    expect(sent).toContain('summary_state=eq.pending');
    // Fifteen minutes before `now` — the runtime's own wall-clock ceiling, so a tick that died
    // mid-call cannot still be running when its rows are released.
    expect(sent).toContain(
      'or=(summarizing_since.is.null,summarizing_since.lt.2026-09-18T11:30:00.000Z)',
    );
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ summarizing_since: NOW.toISOString() });
  });

  it('reports zero rows when an overlapping tick already holds the row', async () => {
    harness([Response.json([])]);
    await expect(leasePost(env, 'post-1', NOW)).resolves.toBe(0);
  });
});

describe('patchPost', () => {
  it('patches by id alone when no compare-and-set was asked for', async () => {
    const calls = harness([Response.json([{ id: 'post-1' }])]);

    await expect(patchPost(env, 'post-1', { summary_state: 'done' })).resolves.toBe(1);

    expect(query(calls[0])).toBe('?id=eq.post-1');
  });

  it('adds the attempts filter when asked, so a moved base matches nothing', async () => {
    // Two overlapping ticks can both read `summarize_attempts: 1`, both fail, and both PATCH 2 —
    // one real billed failure would go uncounted and the ceiling would take twice as long to fire.
    const calls = harness([Response.json([])]);

    await expect(
      patchPost(env, 'post-1', { summarize_attempts: 2 }, { ifAttemptsEquals: 1 }),
    ).resolves.toBe(0);

    expect(query(calls[0])).toContain('summarize_attempts=eq.1');
  });

  it('spells a cleared column as a JSON null so the column is actually cleared', async () => {
    const calls = harness([Response.json([{ id: 'post-1' }])]);
    await patchPost(env, 'post-1', { last_error: JSON_NULL, summarizing_since: JSON_NULL });
    expect(calls[0]?.body).toBe('{"last_error":null,"summarizing_since":null}');
  });

  it('throws on a non-2xx, so a rejected write is a readable log line', async () => {
    expect.assertions(1);
    harness([new Response('violates check constraint', { status: 400 })]);
    await expect(patchPost(env, 'post-1', {})).rejects.toThrow('PATCH reader_posts');
  });
});
