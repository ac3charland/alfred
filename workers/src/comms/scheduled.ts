/**
 * What the cron actually runs for Comms, and in what order.
 *
 * Two schedules, two units of work. The frequent one polls Gmail and then judges whatever has
 * arrived — ingestion first, so a message captured this tick can be judged in the same one rather
 * than waiting two minutes for the next. The daily one deletes what has aged out.
 *
 * Every unit runs inside its own try/catch, and that is the point of this module. Ingestion and
 * judgment are independent failures with different fixes: a revoked Gmail token must not stop the
 * classifier from judging the messages already stored, and a classifier outage must not stop mail
 * from arriving. A summary is returned rather than logged here so the entrypoint keeps its one
 * job — the schedule is wiring, and wiring should not decide how anything is reported.
 */
import type { SupabaseEnv } from '../supabase';
import { type GmailEnv, type GmailPollSummary, pollGmail } from './gmail';
import { type RetentionSummary, runRetention } from './retention';
import { type CommsSweepEnv, type CommsSweepSummary, runCommsSweep } from './sweep';

/** Everything the frequent tick reads from the environment. */
export type CommsTickEnv = GmailEnv & CommsSweepEnv;

/** What one frequent tick did. A unit that threw is `undefined` and named in `failures`. */
export interface CommsTickSummary {
  gmail: GmailPollSummary | undefined;
  sweep: CommsSweepSummary | undefined;
  failures: string[];
}

/** What one retention run did, with the same failure convention. */
export interface CommsRetentionSummary {
  deleted: number | undefined;
  failures: string[];
}

/** Whatever was thrown, as a line worth logging. */
function describe(unit: string, error: unknown): string {
  return `${unit}: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Poll Gmail, then judge what is waiting. Sequential and both awaited: a scheduled invocation is
 * torn down the moment the promise it returns settles, so anything left running is killed
 * part-way through.
 */
export async function runCommsTick(env: CommsTickEnv, now: Date): Promise<CommsTickSummary> {
  const failures: string[] = [];

  let gmail: GmailPollSummary | undefined;
  try {
    gmail = await pollGmail(env, now);
  } catch (error) {
    failures.push(describe('gmail poll', error));
  }

  let sweep: CommsSweepSummary | undefined;
  try {
    sweep = await runCommsSweep(env, now);
  } catch (error) {
    failures.push(describe('comms sweep', error));
  }

  return { gmail, sweep, failures };
}

/** Run the retention sweep. Its own schedule, because it is housekeeping and not triage. */
export async function runCommsRetention(
  env: SupabaseEnv,
  now: Date,
): Promise<CommsRetentionSummary> {
  const failures: string[] = [];

  let retention: RetentionSummary | undefined;
  try {
    retention = await runRetention(env, now);
  } catch (error) {
    failures.push(describe('comms retention', error));
  }

  return { deleted: retention?.deleted, failures };
}
