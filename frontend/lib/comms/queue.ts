import { stableSorted } from '@/lib/sort';
import type { CommMessage, CommTier } from '@/lib/types';

/**
 * The queue rules — which mirrored messages are asking something of the owner right now, and
 * how they group into the three counted tiers.
 *
 * Pure functions over the store's flat message list: the module fetches every message once and
 * derives the queue, the shelf and the badge count client-side (the app's fetch-all,
 * filter-client-side default).
 */

/** The three counted tiers, in the order the queue shows them. `fyi` is the shelf, not a tier. */
export const QUEUED_TIERS = ['asap', 'today', 'whenever'] as const;

/** A tier that puts a message in the response queue. */
export type QueuedTier = (typeof QUEUED_TIERS)[number];

const QUEUED_TIER_SET = new Set<CommTier>(QUEUED_TIERS);

/** The queue grouped into its three tiers, each newest-first. */
export type QueueByTier = Record<QueuedTier, CommMessage[]>;

/**
 * Is this message in the response queue? Three things have to hold: it arrived (outbound rows
 * are mirrored only as the drain signal), it has not been cleared by any of the exits, and its
 * tier is one the queue counts. A message with no tier yet has not been judged and is in
 * neither the queue nor the shelf.
 */
export function isQueued(message: CommMessage): boolean {
  return (
    message.direction === 'inbound' &&
    message.cleared_at === null &&
    message.tier !== null &&
    QUEUED_TIER_SET.has(message.tier)
  );
}

/**
 * Does this message belong to the shelf at all? Everything inbound that has been judged (or
 * cleared) and is not in the queue: the `fyi` tier itself, plus every row that left the queue by
 * one of its exits. Unjudged rows are excluded — nothing is shelved until something decides to
 * shelve it.
 *
 * The one rule the shelf's two numbers are both cut from, so they cannot drift apart: whether an
 * eligible row is DRAWN on the shelf or only COUNTED beneath it is then the single question of
 * whether the Reader claimed it. This predicate and the shelf branch of the server read
 * (`getCommMessagesByScope`) must agree exactly; `isQueued` deliberately never reads
 * `reader_claimed_at`, because a claimed message that owes a reply is still an obligation.
 */
function isShelfEligible(message: CommMessage): boolean {
  if (message.direction !== 'inbound') return false;
  if (isQueued(message)) return false;
  return message.tier !== null || message.cleared_at !== null;
}

/**
 * Is this message on the FYI shelf? Eligible for it, and unclaimed.
 *
 * A newsletter the Reader has claimed (`reader_claimed_at` set) is excluded: it has a better home
 * in the reading list, and the shelf says how many went there rather than listing them twice. The
 * row itself is untouched — it keeps its tier and its filter flag, still counts on the health
 * strip, and is still swept at 60 days.
 */
export function isShelved(message: CommMessage): boolean {
  return isShelfEligible(message) && message.reader_claimed_at === null;
}

/**
 * How many messages the Reader took OFF THE SHELF — the number the shelf's second line reads
 * out, so nothing leaves it silently. Derived from the messages the store already holds; no
 * separate query.
 *
 * The other side of the same eligibility: exactly what `isShelved` would have drawn but for the
 * claim. A claimed newsletter that still owes a reply never left the shelf for the reading list —
 * it was never on the shelf — and counting it would say a row went somewhere it did not while it
 * sits in the queue in plain sight.
 */
export function readerClaimedCount(messages: CommMessage[]): number {
  return messages.filter(
    (message) => isShelfEligible(message) && message.reader_claimed_at !== null,
  ).length;
}

/** Newest first — the order every tier and the shelf read in. */
function byArrivalDescending(messages: CommMessage[]): CommMessage[] {
  return stableSorted(messages, (a, b) => b.received_at.localeCompare(a.received_at));
}

/**
 * Split the queued messages into the three counted tiers, each newest-first. Messages that are
 * not queued (shelved, cleared, outbound, unjudged) are dropped.
 */
export function groupByTier(messages: CommMessage[]): QueueByTier {
  const grouped: QueueByTier = { asap: [], today: [], whenever: [] };
  for (const message of messages) {
    if (!isQueued(message)) continue;
    // `isQueued` already proved the tier is one of the three.
    grouped[message.tier as QueuedTier].push(message);
  }
  return {
    asap: byArrivalDescending(grouped.asap),
    today: byArrivalDescending(grouped.today),
    whenever: byArrivalDescending(grouped.whenever),
  };
}

/** The shelf: everything judged that owes no reply, newest first. */
export function shelved(messages: CommMessage[]): CommMessage[] {
  return byArrivalDescending(messages.filter((message) => isShelved(message)));
}

/**
 * How many messages are waiting for an answer — the sidebar badge and the one number "check
 * comms" collapses to. The shelf is deliberately not counted.
 */
export function queueCount(messages: CommMessage[]): number {
  return messages.filter((message) => isQueued(message)).length;
}
