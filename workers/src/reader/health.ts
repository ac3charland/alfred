/**
 * The three writes to `reader_health`, the singleton row the migration seeds so the tick only
 * ever patches it.
 *
 * None of them throws. That is the comms convention (`stampHealth` in `comms/sweep.ts`) and it is
 * load-bearing rather than defensive: the health row is how the module SAYS something is wrong,
 * and a failure to record a failure must not replace the failure it was reporting. A Supabase
 * outage would otherwise take down the tick at exactly the moment it was trying to report one.
 *
 * Each of them can also carry the CEILING the tick enforced — the cap, and once the tick has
 * counted them, the model calls made for that UTC day. It rides the writes that were happening
 * anyway rather than taking a write of its own: the tick's subrequest budget is what bounds how
 * many posts it can take on, so a column that costs a fetch costs posts.
 *
 * `last_run_at` and `last_success_at` are deliberately separate columns written by separate
 * calls. "Ran" and "got all the way through" are different facts, and a tick that ends on a Gmail
 * transport failure has done the first and not the second — collapsing them would paint an outage
 * green, which is the one reading the health row exists to prevent.
 */
import type { SupabaseEnv } from '../supabase';
import { fetchJson, restQueryUrl } from '../supabase';
import type { ReaderCeiling } from './types';

/** The singleton's id. The row is seeded by the migration; nothing here ever inserts it. */
const HEALTH_ROW = '1';

/**
 * The ceiling columns as one patchable object, dropping whatever the caller could not know yet.
 *
 * A tick learns the cap from its config before it does anything, and the COUNT only once it has
 * read it — so the run-start write carries the cap alone and the terminal write carries all
 * three. `JSON.stringify` drops the undefined keys, so an unknown column is simply not in the
 * PATCH body rather than being written as null over a good value.
 */
function ceilingColumns(ceiling: ReaderCeiling | undefined): Record<string, unknown> {
  if (ceiling === undefined) return {};
  return {
    daily_cap: ceiling.daily_cap,
    calls_today: ceiling.calls_today,
    calls_day: ceiling.calls_day,
  };
}

/**
 * Stamp that a tick began. Written before anything can fail, so a tick that dies still shows.
 * Carries the cap this run will enforce, which is the one thing the tick already knows at that
 * point — so a reader of the row never has to hard-code the Worker's deploy var.
 */
export function recordRunStart(
  env: SupabaseEnv,
  now: Date,
  ceiling?: ReaderCeiling,
): Promise<void> {
  return patchHealth(
    env,
    { last_run_at: now.toISOString(), ...ceilingColumns(ceiling) },
    'record the run start',
  );
}

/**
 * Stamp a tick that got all the way through. The caller writes this ONLY when nothing systemic
 * went wrong — an outage that kept stamping success would read as healthy forever.
 */
export function recordRunSuccess(
  env: SupabaseEnv,
  now: Date,
  ceiling?: ReaderCeiling,
): Promise<void> {
  return patchHealth(
    env,
    { last_success_at: now.toISOString(), ...ceilingColumns(ceiling) },
    'record the run success',
  );
}

/**
 * Record why a tick stopped. Never touches `last_success_at`, for the reason `recordPollError`
 * never touches `last_seen_at`: that column answers "is this still working", and moving it here
 * would paint a dead module green.
 */
export function recordRunError(
  env: SupabaseEnv,
  now: Date,
  error: string,
  ceiling?: ReaderCeiling,
): Promise<void> {
  return patchHealth(
    env,
    { last_error: error, last_error_at: now.toISOString(), ...ceilingColumns(ceiling) },
    'record the run error',
  );
}

/** PATCH the singleton, swallowing and logging whatever the database says. */
async function patchHealth(
  env: SupabaseEnv,
  updates: Record<string, unknown>,
  what: string,
): Promise<void> {
  try {
    await fetchJson<unknown[]>(
      env,
      restQueryUrl(env, 'reader_health', { id: `eq.${HEALTH_ROW}` }),
      { method: 'PATCH', body: JSON.stringify(updates) },
      'PATCH reader_health',
    );
  } catch (error) {
    console.error(`reader: could not ${what}`, error);
  }
}
