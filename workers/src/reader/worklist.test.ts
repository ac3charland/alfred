import { type FetchInit, type FetchInput, spyOnFetch } from '../fetch-stub';
import type { SupabaseEnv } from '../supabase';
import { READER_LEASE_STALE_MS, fetchFresh, fetchRetries, leaseFreeFilter } from './worklist';

const env: SupabaseEnv = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

const NOW = new Date('2026-09-18T11:45:00.000Z');

/** A JSON `null` — how PostgREST spells an absent column. This package bans the literal. */
const WIRE_NULL: unknown = JSON.parse('null');

/** Answer every read with `rows`, and hand back the URLs that were asked for. */
function harness(rows: unknown[]): string[] {
  const urls: string[] = [];
  spyOnFetch().mockImplementation((input: FetchInput, _init?: FetchInit) => {
    urls.push(input as string);
    return Promise.resolve(Response.json(rows));
  });
  return urls;
}

/** The decoded query string, so an encoded PostgREST filter reads as it was written. */
function query(url: string | undefined): string {
  return decodeURIComponent(new URL(url ?? 'https://x/').search);
}

describe('leaseFreeFilter', () => {
  it('describes a row whose lease is free: never claimed, or claimed longer ago than the bound', () => {
    expect(leaseFreeFilter(NOW)).toBe(
      '(summarizing_since.is.null,summarizing_since.lt.2026-09-18T11:30:00.000Z)',
    );
  });

  it('bounds staleness at the runtime’s own fifteen-minute wall clock', () => {
    // So a tick that died mid-call cannot still be running when its rows are released — and a
    // tick that is merely slow (the eight-minute budget) is comfortably inside it.
    expect(READER_LEASE_STALE_MS).toBe(15 * 60_000);
  });
});

describe('fetchRetries', () => {
  it('asks for pending, under-ceiling, lease-free posts, oldest first', async () => {
    const urls = harness([]);

    await fetchRetries(env, NOW, 6);

    const sent = query(urls[0]);
    expect(urls[0]).toContain('/reader_posts');
    expect(sent).toContain('summary_state=eq.pending');
    // Three failures in a row on the same prompt is a bug in the prompt, not bad luck.
    expect(sent).toContain('summarize_attempts=lt.3');
    expect(sent).toContain(`or=${leaseFreeFilter(NOW)}`);
    // Oldest first, so a backlog drains in the order it arrived rather than newest-wins.
    expect(sent).toContain('order=created_at.asc');
    expect(sent).toContain('limit=6');
  });

  it('asks only for the columns a retry needs, never the whole row', async () => {
    const urls = harness([]);
    await fetchRetries(env, NOW, 6);
    expect(query(urls[0])).toContain('select=id,publication_id,title,author');
  });

  it('maps the wire nulls to undefined, so nothing downstream sees one', async () => {
    harness([
      {
        id: 'post-1',
        publication_id: 'pub-1',
        title: 'The Grain Ledger',
        author: WIRE_NULL,
        canonical_url: WIRE_NULL,
        received_at: '2026-09-16T11:06:40.000Z',
        text: WIRE_NULL,
        word_count: 0,
        summarize_attempts: 1,
      },
    ]);

    await expect(fetchRetries(env, NOW, 6)).resolves.toEqual([
      {
        id: 'post-1',
        publication_id: 'pub-1',
        title: 'The Grain Ledger',
        author: undefined,
        canonical_url: undefined,
        received_at: '2026-09-16T11:06:40.000Z',
        text: undefined,
        word_count: 0,
        summarize_attempts: 1,
      },
    ]);
  });
});

describe('fetchFresh', () => {
  it('reads the view, oldest first, capped', async () => {
    // The view, not a query: what makes a message eligible is "there is no post for it yet",
    // which is an anti-join PostgREST cannot express. The seven-day horizon and the claimed-row
    // exclusion live there too, so nothing here can get them subtly different.
    const urls = harness([]);

    await fetchFresh(env, 6);

    expect(urls[0]).toContain('/v_reader_worklist');
    expect(query(urls[0])).toBe('?order=received_at.asc&limit=6');
  });

  it('maps the wire nulls to undefined', async () => {
    harness([
      {
        comm_message_id: 'comm-1',
        gmail_message_id: 'gmail-1',
        account_key: 'gmail-personal',
        publication_id: 'pub-1',
        sender_handle: 'mira@harborline.substack.com',
        sender_name: WIRE_NULL,
        subject: WIRE_NULL,
        rfc822_message_id: WIRE_NULL,
        received_at: '2026-09-16T11:06:40.000Z',
      },
    ]);

    await expect(fetchFresh(env, 6)).resolves.toEqual([
      {
        comm_message_id: 'comm-1',
        gmail_message_id: 'gmail-1',
        account_key: 'gmail-personal',
        publication_id: 'pub-1',
        sender_handle: 'mira@harborline.substack.com',
        sender_name: undefined,
        subject: undefined,
        rfc822_message_id: undefined,
        received_at: '2026-09-16T11:06:40.000Z',
      },
    ]);
  });
});
