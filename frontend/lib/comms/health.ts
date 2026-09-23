import type { CommAccount, CommClassifierHealth, CommMessage } from '@/lib/types';

/**
 * Whether anything is actually working — per account, and for the classifier as a whole.
 *
 * A firewall's value is that its zero means something, so no source is assumed to be running:
 * quiet and broken are indistinguishable from message volume alone, and only a SUCCESSFUL poll
 * separates them. A classifier outage is a different failure again — ingestion healthy,
 * judgment stalled — so it is module-level state rather than a fourth per-account dot.
 */

/** The three states one account's indicator can be in. */
export type AccountHealth =
  /** Polled successfully within this source's expected interval. */
  | 'live'
  /** No successful poll for longer than that — nothing is arriving and alfred can't say why. */
  | 'stale'
  /** Polls are running and failing: the account is dead, not quiet. */
  | 'erroring';

/**
 * One account's state. Erroring wins over stale: an error NEWER than the last success means the
 * polls are reaching the source and being refused, which is a different fix from a Mac that is
 * asleep. An older error is a past hiccup the next successful poll has already cleared.
 */
export function accountHealth(account: CommAccount, now: Date): AccountHealth {
  const lastSeen = account.last_seen_at === null ? null : Date.parse(account.last_seen_at);
  const lastError = account.last_error_at === null ? null : Date.parse(account.last_error_at);

  if (lastError !== null && (lastSeen === null || lastError > lastSeen)) return 'erroring';
  if (lastSeen === null) return 'stale';
  return now.getTime() - lastSeen <= account.expected_interval_seconds * 1000 ? 'live' : 'stale';
}

/**
 * How long a reconnect attempt (the module's own re-read, kicked off when a tab returns from the
 * background or the network comes back) gets the benefit of the doubt before the account dots
 * start reading off the true clock again — long enough to cover a normal round trip, nowhere
 * near long enough to hide a source that is genuinely still down.
 */
export const ACCOUNT_RECONNECT_GRACE_MS = 5000;

/**
 * ALF-252. `accountHealth`, but fed a clock held at the instant the module's most recent
 * reconcile attempt began, for a short grace window after it — rather than the true, ticking
 * `now`.
 *
 * Nothing about an account row changes until its read lands (the store replaces it wholesale,
 * never incrementally), so the only thing that can move between renders while a read is out is
 * `now` itself. A tab that returns after a while away re-renders with a fresh, ticking `now`
 * against account data that is still exactly what it was before the tab left — which can tip a
 * row that was genuinely live a moment ago over its `expected_interval_seconds` and flash it
 * stale for the fraction of a second the read takes to land. Holding the clock at the read's own
 * start reproduces whatever the dot read right before the attempt began — connected stays
 * connected — until the window passes, at which point a read that is still out has clearly had
 * its chance and the true clock takes back over: a source that is truly offline still shows it,
 * just no sooner than the reconnect attempt itself allowed for.
 */
export function heldNow(now: Date, reconcileStartedAt: string | null): Date {
  if (reconcileStartedAt === null) return now;
  const started = Date.parse(reconcileStartedAt);
  return now.getTime() - started < ACCOUNT_RECONNECT_GRACE_MS ? new Date(started) : now;
}

/** The most recent successful poll across every account, and the account that made it. */
export interface LastPing {
  account: CommAccount;
  at: string;
}

/**
 * Which source checked in last, and when — `null` until any account has been polled. The dots say
 * whether each source is inside its interval; this says the whole surface is still moving, which
 * a row of green can't show on its own.
 */
export function lastPing(accounts: CommAccount[]): LastPing | null {
  let latest: LastPing | null = null;
  for (const account of accounts) {
    if (account.last_seen_at === null) continue;
    if (latest === null || Date.parse(account.last_seen_at) > Date.parse(latest.at)) {
      latest = { account, at: account.last_seen_at };
    }
  }
  return latest;
}

/**
 * How long an inbound message may sit with no tier before the classifier counts as stalled. The
 * sweep rides a cron in minutes, so a quarter of an hour is well past "the next run will get it".
 */
export const CLASSIFIER_STALL_MINUTES = 15;

const MS_PER_MINUTE = 60 * 1000;

/** Whether judgment has stopped, and when it stopped — the banner's whole content. */
export interface ClassifierStall {
  stalled: boolean;
  /** ISO timestamp the stall is measured from; `null` when nothing is stalled. */
  since: string | null;
}

/**
 * Is the classifier stalled? Two independent signals, because either alone can be silent:
 *
 * - the sweep recorded a systemic failure more recently than a success (a missing binding, a
 *   rejected credential), which it knows about; and
 * - a message the sweep SHOULD have judged has been waiting longer than its cadence while
 *   judgment produced nothing, which catches an outage the sweep never got far enough to record.
 *
 * `since` is the EARLIER of the two, so the banner names when judgment actually stopped rather
 * than when the failure was noticed.
 *
 * Two rules keep the second signal from crying wolf, and both were learned the hard way:
 *
 * What counts as waiting must mirror `fetchUnjudgedMessages` in the Worker, which excludes a row
 * a reply has already drained (`cleared_at`). A backfill arrives with a week of threads the owner
 * answered long ago, and the sweep will never judge one of those — correctly. Counting them here
 * reported an outage dated before the classifier had even been switched on.
 *
 * And a waiting row only means judgment stopped if judgment is ALSO producing nothing. The sweep
 * judges a capped batch per tick, so a first run over a backlog leaves rows waiting far past the
 * cadence while working exactly as designed. `classified_at` is the proof of life: a verdict
 * inside the window means the classifier is draining, not stalled — and when there is no such
 * verdict, the LAST one it managed is when judgment actually stopped. A message's own
 * `received_at` says when it arrived, which for anything backfilled is a different and much older
 * moment, so it is only the fallback for a classifier that has never judged anything at all.
 */
export function classifierStalled(
  health: CommClassifierHealth | undefined,
  messages: CommMessage[],
  now: Date,
  /**
   * The newest verdict the server knows of. The client holds only a page of the shelf, so the
   * held rows alone can miss the latest proof of life; this floors it.
   */
  lastClassifiedAt: string | null = null,
): ClassifierStall {
  const signals: string[] = [];

  if (health?.last_error_at != null) {
    const success = health.last_success_at === null ? null : Date.parse(health.last_success_at);
    if (success === null || Date.parse(health.last_error_at) > success) {
      signals.push(health.last_error_at);
    }
  }

  const cutoff = now.getTime() - CLASSIFIER_STALL_MINUTES * MS_PER_MINUTE;
  let waitingSince: string | undefined;
  let lastVerdict: string | undefined = lastClassifiedAt ?? undefined;
  for (const message of messages) {
    if (
      message.classified_at !== null &&
      (lastVerdict === undefined || Date.parse(message.classified_at) > Date.parse(lastVerdict))
    )
      lastVerdict = message.classified_at;
    // Exactly the Worker worklist's predicate: inbound, unjudged, and not already drained.
    if (message.direction !== 'inbound' || message.tier !== null || message.cleared_at !== null)
      continue;
    if (Date.parse(message.received_at) > cutoff) continue;
    if (waitingSince === undefined || Date.parse(message.received_at) < Date.parse(waitingSince))
      waitingSince = message.received_at;
  }

  const judgingStill = lastVerdict !== undefined && Date.parse(lastVerdict) > cutoff;
  if (waitingSince !== undefined && !judgingStill) signals.push(lastVerdict ?? waitingSince);

  // The earliest signal wins, walked rather than sorted: ISO timestamps only compare correctly
  // as strings when they share an offset, so each candidate is parsed to an instant.
  let since = signals[0];
  for (const candidate of signals) {
    if (since === undefined || Date.parse(candidate) < Date.parse(since)) since = candidate;
  }
  return since === undefined ? { stalled: false, since: null } : { stalled: true, since };
}
