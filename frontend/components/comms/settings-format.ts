import { TIER_LABEL, formatElapsed, formatMessageTime } from '@/components/comms/comms-format';
import type { CommCorrection, CommPerson } from '@/lib/types';

/**
 * The strings and derivations the three settings surfaces put on screen: what a priority means,
 * when a rubric version was saved, which example-set version is current, and what a correction
 * changed.
 *
 * Pure and `now`-taking, like the queue's own formatters — a view owns one ticking instant and
 * hands the same one to everything it renders, so a list can't show two different "now"s.
 */

/** The three priorities the roster's CHECK allows, in the order the picker offers them. */
export const PRIORITY_VALUES = ['high', 'normal', 'low'] as const;

export type CommPersonPriority = (typeof PRIORITY_VALUES)[number];

export const PRIORITY_LABEL: Record<CommPersonPriority, string> = {
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

/**
 * One line each, because the three are not a scale — they are three different jobs. Taken from
 * the column's own documentation so the picker and the schema can't drift apart.
 */
export const PRIORITY_MEANING: Record<CommPersonPriority, string> = {
  high: 'Delay costs something real. Queued even when the message asks nothing outright.',
  normal: 'Listed only so a handle resolves to a name.',
  low: 'Never urgent, however the message reads.',
};

/**
 * The stored priority as one of the three the UI knows. The column is a text CHECK rather than
 * an enum, so a row could in principle hold something else; treating that as `normal` keeps the
 * card renderable instead of blank.
 */
export function personPriority(person: CommPerson): CommPersonPriority {
  return PRIORITY_VALUES.find((value) => value === person.priority) ?? 'normal';
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * When a rubric version was saved. Relative while the edit is still fresh in mind ("3h ago"),
 * and an ordinary date once it isn't — "1,247d ago" is arithmetic, not an answer, and the older
 * a version gets the more the reader wants to place it on a calendar.
 */
export function formatSavedAt(iso: string, now: Date): string {
  const elapsed = now.getTime() - new Date(iso).getTime();
  if (Number.isNaN(elapsed)) return '';
  return elapsed < SEVEN_DAYS_MS ? formatElapsed(iso, now) : formatMessageTime(iso, now);
}

/**
 * The example set's current version: the highest number any insert or prune has claimed. The
 * same expression the database's `comm_example_set_version()` evaluates, derived here so the
 * page can state it without a round-trip — every correction is already in hand.
 */
export function exampleSetVersion(corrections: CommCorrection[]): number {
  let highest = 0;
  for (const row of corrections) {
    highest = Math.max(highest, row.created_version, row.pruned_version ?? 0);
  }
  return highest;
}

/**
 * What kind of correction this was. The two are opposite signals — one says the model queued
 * something that asked nothing, the other says it queued the right row at the wrong urgency —
 * so the card names which, rather than showing an undifferentiated "correction".
 */
export function exampleKindLabel(kind: string): string {
  return kind === 'nothing_to_answer' ? 'Nothing to answer' : 'Tier change';
}

/**
 * The correction as a move: what the model said, and what the owner said instead. A row with no
 * verdict behind it (the attempt ceiling, a decode failure) has no guess to contrast, and says
 * so — it still teaches, but there was never a model answer to disagree with.
 */
export function tierTransition(correction: CommCorrection): { from: string; to: string } {
  return {
    from: correction.model_tier === null ? 'unjudged' : TIER_LABEL[correction.model_tier],
    to: TIER_LABEL[correction.chosen_tier],
  };
}

/**
 * A version's first line, for the history list. The rubric is prose the owner wrote, and its
 * opening line is what tells one version from another at a glance.
 */
export function rubricFirstLine(body: string): string {
  const [first = ''] = body.trim().split('\n');
  return first.trim();
}
