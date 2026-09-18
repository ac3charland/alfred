import { spyOnFetch } from '../fetch-stub';
import type { SupabaseEnv } from '../supabase';
import { READER_TEXT_RETENTION_DAYS, SWEEP_BATCH, runReaderRetention } from './retention';

const env: SupabaseEnv = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

const NOW = new Date('2026-09-18T09:17:00.000Z');

describe('runReaderRetention', () => {
  it('asks the database to sweep one batch, naming the rpc and its body', async () => {
    const spy = spyOnFetch().mockResolvedValue(Response.json(0));

    await runReaderRetention(env, NOW);

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/rest/v1/rpc/reader_sweep_text');
    expect(JSON.parse(init.body as string)).toEqual({
      p_days: READER_TEXT_RETENTION_DAYS,
      p_limit: SWEEP_BATCH,
    });
  });

  it('loops until a batch reports nothing left, summing every count', async () => {
    const counts = [2, 1, 0];
    const spy = spyOnFetch().mockImplementation(() =>
      Promise.resolve(Response.json(counts.shift())),
    );

    await expect(runReaderRetention(env, NOW)).resolves.toEqual({ swept: 3 });

    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('makes one call when the first batch is already empty', async () => {
    const spy = spyOnFetch().mockResolvedValue(Response.json(0));

    await expect(runReaderRetention(env, NOW)).resolves.toEqual({ swept: 0 });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('throws on a non-2xx response, via fetchJson', async () => {
    spyOnFetch().mockResolvedValue(new Response('boom', { status: 500 }));

    await expect(runReaderRetention(env, NOW)).rejects.toThrow(
      /Supabase POST rpc\/reader_sweep_text failed: 500/,
    );
  });

  it('throws rather than loop forever when a batch never reaches zero', async () => {
    // Every call returns a full batch — the runaway guard, not a real table size. A fresh
    // Response per call: `Response.json` can only be read once, and this path reads over a
    // hundred of them.
    const spy = spyOnFetch().mockImplementation(() => Promise.resolve(Response.json(SWEEP_BATCH)));

    await expect(runReaderRetention(env, NOW)).rejects.toThrow(
      /reader_sweep_text did not reach 0 after 100 batches/,
    );
    expect(spy).toHaveBeenCalledTimes(100);
  });

  it('keeps the retention window at ninety days', () => {
    // Nothing in the design depends on the exact number, but changing it changes how long a post
    // stays re-summarisable, so it moves deliberately or not at all.
    expect(READER_TEXT_RETENTION_DAYS).toBe(90);
  });
});
