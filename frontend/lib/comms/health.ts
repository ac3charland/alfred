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
 * - an inbound message has been sitting unjudged for longer than the sweep's cadence, which
 *   catches an outage the sweep never got far enough to record.
 *
 * `since` is the EARLIER of the two, so the banner names when judgment actually stopped rather
 * than when the failure was noticed.
 */
export function classifierStalled(
  health: CommClassifierHealth | undefined,
  messages: CommMessage[],
  now: Date,
): ClassifierStall {
  const signals: string[] = [];

  if (health?.last_error_at != null) {
    const success = health.last_success_at === null ? null : Date.parse(health.last_success_at);
    if (success === null || Date.parse(health.last_error_at) > success) {
      signals.push(health.last_error_at);
    }
  }

  const cutoff = now.getTime() - CLASSIFIER_STALL_MINUTES * MS_PER_MINUTE;
  for (const message of messages) {
    if (message.direction !== 'inbound' || message.tier !== null) continue;
    if (Date.parse(message.received_at) <= cutoff) signals.push(message.received_at);
  }

  // The earliest signal wins, walked rather than sorted: ISO timestamps only compare correctly
  // as strings when they share an offset, so each candidate is parsed to an instant.
  let since = signals[0];
  for (const candidate of signals) {
    if (since === undefined || Date.parse(candidate) < Date.parse(since)) since = candidate;
  }
  return since === undefined ? { stalled: false, since: null } : { stalled: true, since };
}
