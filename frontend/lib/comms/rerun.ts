import { TIER_LABEL } from '@/components/comms/comms-format';
import type { CommMessage, CommTier } from '@/lib/types';

/**
 * How a re-run reads: whether one is still waiting on a row, and what to tell the owner once it
 * has ended.
 *
 * A re-run is asked for in one click and answered a minute or three later by a Worker the browser
 * never hears from directly, so without this the owner clicks and nothing on screen says the
 * request went anywhere, or what became of it. Both halves are pure: the store decides WHEN a
 * re-run has ended, and this decides what that ended as.
 */

/**
 * Whether a re-run request is waiting on this row. Derived, not stored on the client: the request
 * IS `reclassify_requested_at`, so a reloaded tab, another tab and the tab that clicked all agree,
 * and the optimistic write that sets the field and its rollback that clears it need no second
 * flag to keep in step.
 */
export function isReclassifyPending(message: CommMessage): boolean {
  return message.reclassify_requested_at !== null;
}

/** What the store remembers about a row at the moment the owner asked for its re-run. */
export interface RerunBefore {
  /** The tier the row was on when asked, or `null` if nothing had judged it. */
  tier: CommTier | null;
  /** When the request was made — a failure stamped before it belongs to an earlier request. */
  requestedAt: string;
}

/** A tier as the owner reads it, with the row that has none named rather than left blank. */
function tierLabel(tier: CommTier | null): string {
  return tier === null ? 'Unjudged' : TIER_LABEL[tier];
}

/**
 * The toast text for a re-run that has ended.
 *
 * Checked top to bottom, and the first rule that fits wins: a failure outranks everything because
 * the row was NOT re-judged and whatever else it says is the old verdict; a refusal and an
 * unjudged row are both the classifier saying it could not answer, so they outrank a comparison
 * of tiers that would otherwise read "still Today" as if it were a judgment.
 *
 * `senderName` is what the row reads as (the roster's name for the sender, else theirs), because
 * two re-runs can land on one poll and the toast has to say which row it is about.
 */
export function rerunOutcomeMessage(
  before: RerunBefore,
  after: CommMessage,
  senderName: string,
): string {
  // Compared as instants: the database writes `+00:00` and microseconds, this tab writes `Z` and
  // milliseconds, and as text the first sorts before the second whatever the times are.
  const failedAt = after.reclassify_failed_at;
  if (failedAt !== null && Date.parse(failedAt) >= Date.parse(before.requestedAt)) {
    // "Had no tier" is read off the row as it WAS: the park that follows an abandoned row with
    // no tier files it on Today straight away, so its tier now would claim a verdict it never had.
    return before.tier === null
      ? `Re-run failed · ${senderName}: still unjudged`
      : `Re-run failed · ${senderName}: kept ${tierLabel(after.tier ?? before.tier)}`;
  }

  if (after.judged_by === 'refusal') {
    return `Re-run · ${senderName}: the model declined, moved to ${TIER_LABEL.fyi}`;
  }

  if (after.judged_by === 'unjudged') {
    return `Re-run · ${senderName}: still couldn't judge it, on ${tierLabel(after.tier)}`;
  }

  if (after.tier === before.tier) {
    return `Re-run · ${senderName}: still ${tierLabel(after.tier)}`;
  }

  return `Re-run · ${senderName}: ${tierLabel(before.tier)} → ${tierLabel(after.tier)}`;
}
