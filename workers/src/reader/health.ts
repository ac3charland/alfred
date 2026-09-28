/**
 * The writes to `reader_health`, the singleton row the migration seeds so the tick only ever
 * patches it: the tick's three, and the To Reader leg's own outcome, which rides the tick's closing
 * write whenever there is one.
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
 * What the To Reader leg has to record this tick: a clean pass, or the Instapaper failure in the
 * owner's words. A tick where the leg did not run, or ran without finishing, has no outcome and
 * writes none of its columns — so an unconfigured deployment's row never grows an Instapaper dot.
 */
export type InstapaperOutcome = { kind: 'success' } | { kind: 'error'; error: string };

/**
 * The leg's own columns for one outcome. Kept apart from the summariser's `last_*` columns because
 * a dead Instapaper token is a different fault with a different fix: newsletters still flow, and a
 * summariser that read as stalled over it would send the owner to the wrong place.
 */
function instapaperColumns(
  now: Date,
  outcome: InstapaperOutcome | undefined,
): Record<string, unknown> {
  if (outcome === undefined) return {};
  const at = now.toISOString();
  return outcome.kind === 'success'
    ? { instapaper_last_success_at: at }
    : { instapaper_last_error: outcome.error, instapaper_last_error_at: at };
}

/**
 * The ceiling columns as one patchable object, dropping whatever the caller could not know yet.
 *
 * The tick reads the day's model-call count BEFORE it stamps a run start at all (see
 * `scheduled.ts`), so a run-start write that happens carries all three columns — the cap, the
 * count, and the day it was counted over — same as the terminal write. The three pre-flight
 * failures (an unparsable config, a missing API key, a missing Gmail binding) and a count read
 * that itself fails never reach a run-start write: they go straight to `recordRunError` with the
 * cap alone, because there is no count yet and no run to say started. `JSON.stringify` drops the
 * undefined keys, so an unknown column is simply not in the PATCH body rather than being written
 * as null over a good value.
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
 * Stamp that a tick got past pre-flight and read the day's count. A run-start row therefore means
 * exactly that: the config parsed, the API key and Gmail bindings were set, and the count read
 * cleanly. Any of those failing is recorded by `recordRunError` instead, with no `last_run_at`
 * write — so a reader can tell "never even started" apart from "started and then died". Once it
 * does run, it carries the cap and the count this run will enforce, so a reader of the row never
 * has to hard-code the Worker's deploy var or guess a day's spend.
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
  instapaper?: InstapaperOutcome,
): Promise<void> {
  return patchHealth(
    env,
    {
      last_success_at: now.toISOString(),
      ...ceilingColumns(ceiling),
      ...instapaperColumns(now, instapaper),
    },
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
  instapaper?: InstapaperOutcome,
): Promise<void> {
  return patchHealth(
    env,
    {
      last_error: error,
      last_error_at: now.toISOString(),
      ...ceilingColumns(ceiling),
      ...instapaperColumns(now, instapaper),
    },
    'record the run error',
  );
}

/**
 * The leg's outcome on a tick that has no closing write to carry it — the two Gmail stops (a
 * token exchange or a message read that had a bad minute), which end the tick without stamping
 * either of the summariser's columns. One PATCH of the leg's columns alone; those paths stop
 * early, so the fetch it costs is one the tick never spent on its later posts.
 */
export function recordInstapaperHealth(
  env: SupabaseEnv,
  now: Date,
  outcome: InstapaperOutcome,
): Promise<void> {
  return patchHealth(env, instapaperColumns(now, outcome), 'record the To Reader leg');
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
