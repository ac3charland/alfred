/**
 * What the cron actually runs for Comms, and in what order.
 *
 * Three schedules, three units of work. Polling Gmail and judging what has arrived each get their
 * own two-minute tick, offset by a minute, because they compete for the same budget: the Workers
 * runtime allows 50 outbound fetches per invocation on the Free plan, and both units scale with
 * how much mail is waiting. Sharing one invocation made each of them the reason the other ran out.
 * Offset rather than simultaneous so the pipeline still flows in one direction — mail polled at
 * :01 is judged at :02 — which costs a minute of latency on a system whose whole premise is
 * capture-now-refine-later. The daily one deletes what has aged out.
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

/** Everything the two frequent ticks read from the environment, between them. */
export type CommsTickEnv = GmailEnv & CommsSweepEnv;

/** What one frequent tick did. The unit this tick does not run stays `undefined`, as does one
 *  that threw — which is instead named in `failures`, so "did not run" and "broke" stay
 *  distinguishable in the log. */
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
 * Poll Gmail. Awaited: a scheduled invocation is torn down the moment the promise it returns
 * settles, so anything left running is killed part-way through.
 */
export async function runCommsPoll(env: GmailEnv, now: Date): Promise<CommsTickSummary> {
  const failures: string[] = [];

  let gmail: GmailPollSummary | undefined;
  try {
    gmail = await pollGmail(env, now);
  } catch (error) {
    failures.push(describe('gmail poll', error));
  }

  return { gmail, sweep: undefined, failures };
}

/** Judge whatever is waiting, on its own tick and so against its own subrequest budget. */
export async function runCommsJudge(env: CommsSweepEnv, now: Date): Promise<CommsTickSummary> {
  const failures: string[] = [];

  let sweep: CommsSweepSummary | undefined;
  try {
    sweep = await runCommsSweep(env, now);
  } catch (error) {
    failures.push(describe('comms sweep', error));
  }

  return { gmail: undefined, sweep, failures };
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
