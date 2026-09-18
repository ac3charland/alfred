/**
 * The three writes to `reader_health`, the singleton row the migration seeds so the tick only
 * ever patches it.
 *
 * None of them throws. That is the comms convention (`stampHealth` in `comms/sweep.ts`) and it is
 * load-bearing rather than defensive: the health row is how the module SAYS something is wrong,
 * and a failure to record a failure must not replace the failure it was reporting. A Supabase
 * outage would otherwise take down the tick at exactly the moment it was trying to report one.
 *
 * `last_run_at` and `last_success_at` are deliberately separate columns written by separate
 * calls. "Ran" and "got all the way through" are different facts, and a tick that ends on a Gmail
 * transport failure has done the first and not the second — collapsing them would paint an outage
 * green, which is the one reading the health row exists to prevent.
 */
import type { SupabaseEnv } from '../supabase';
import { fetchJson, restQueryUrl } from '../supabase';

/** The singleton's id. The row is seeded by the migration; nothing here ever inserts it. */
const HEALTH_ROW = '1';

/** Stamp that a tick began. Written before anything can fail, so a tick that dies still shows. */
export function recordRunStart(env: SupabaseEnv, now: Date): Promise<void> {
  return patchHealth(env, { last_run_at: now.toISOString() }, 'record the run start');
}

/**
 * Stamp a tick that got all the way through. The caller writes this ONLY when nothing systemic
 * went wrong — an outage that kept stamping success would read as healthy forever.
 */
export function recordRunSuccess(env: SupabaseEnv, now: Date): Promise<void> {
  return patchHealth(env, { last_success_at: now.toISOString() }, 'record the run success');
}

/**
 * Record why a tick stopped. Never touches `last_success_at`, for the reason `recordPollError`
 * never touches `last_seen_at`: that column answers "is this still working", and moving it here
 * would paint a dead module green.
 */
export function recordRunError(env: SupabaseEnv, now: Date, error: string): Promise<void> {
  return patchHealth(
    env,
    { last_error: error, last_error_at: now.toISOString() },
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
