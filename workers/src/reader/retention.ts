/**
 * The 90-day text sweep: `reader_posts.text` is nulled once a post ages past the retention
 * window, so the table's byte cost stops compounding while every post it ever summarised stays
 * summarised forever.
 *
 * The arithmetic: at roughly ten posts a day and a few thousand words of extracted text apiece,
 * stored text costs on the order of 1.5 MB/day. Held for the full 90-day window before the sweep
 * takes it, that settles into a steady state of roughly 135 MB of post bodies — bounded, not
 * growing without end. Summaries (`headline`/`gist`/`overview`) are never swept and have no
 * expiry: they are the product this module exists to protect. The only reason full text is kept
 * at all is so a post can be re-summarised on demand before its window closes — once the sweep
 * has taken it, that option is gone, which is why the resummarise route refuses on a swept post
 * rather than offering a verb that would always fail.
 *
 * This sweep runs on its OWN cron trigger (`RETENTION_CRON` in `index.ts`, alongside the comms
 * retention sweep) — not on any of the Reader's five-minute ticks — so it gets a full
 * 50-subrequest-per-invocation budget to itself, shared only with the comms sweep that runs the
 * same schedule.
 *
 * `reader_sweep_text` nulls and stamps ONE BATCH per call and reports how many rows it touched,
 * so each batch is its own transaction: a catch-up run that trips Postgres's `statement_timeout`
 * keeps every batch it already finished, which one big `UPDATE` (or a `plpgsql` loop inside a
 * single call) would not. The loop below calls it until a batch reports 0, summing the counts.
 */
import { type SupabaseEnv, fetchJson, restQueryUrl } from '../supabase';

/** How long a post's full text survives before the sweep nulls it. Summaries outlive it forever. */
export const READER_TEXT_RETENTION_DAYS = 90;

/** How many rows one RPC call sweeps — the database's own transaction boundary, not a Worker cap. */
export const SWEEP_BATCH = 5000;

/**
 * A hard ceiling on how many batches one run will ask for. At `SWEEP_BATCH` rows a batch, this
 * is 500,000 rows — an order of magnitude past anything the arithmetic above predicts even for a
 * long-neglected sweep. A loop that never reaches 0 within it is a bug (an RPC whose `where`
 * clause isn't actually narrowing, say), not evidence of a bigger table, so it throws rather than
 * spend the rest of the invocation's budget chasing it.
 */
const MAX_BATCHES = 100;

/** Build the `rpc/<name>` POST URL — a private helper, the reader's own copy of comms' `rpcUrl`. */
function rpcUrl(env: SupabaseEnv, name: string): string {
  return restQueryUrl(env, `rpc/${name}`, {});
}

/**
 * Sweep every post whose text has aged past the window, one batch at a time until a call reports
 * nothing left to sweep.
 *
 * `_now` is unused, as in the comms sweep: the cutoff is computed inside the database function,
 * so what gets swept never depends on which machine asked.
 */
export async function runReaderRetention(env: SupabaseEnv, _now: Date): Promise<{ swept: number }> {
  let swept = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    // Each batch is its own transaction (see the module comment), so the loop is deliberately
    // serial rather than fired concurrently.
    const count = await fetchJson<number>(
      env,
      rpcUrl(env, 'reader_sweep_text'),
      {
        method: 'POST',
        body: JSON.stringify({ p_days: READER_TEXT_RETENTION_DAYS, p_limit: SWEEP_BATCH }),
      },
      'POST rpc/reader_sweep_text',
    );
    swept += count;
    if (count === 0) return { swept };
  }
  throw new Error(`reader_sweep_text did not reach 0 after ${String(MAX_BATCHES)} batches`);
}
