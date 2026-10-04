import type { CommMessage, CommPersonWithHandles } from '@/lib/types';

import { resolvePerson } from './people';
import { isReclassifyPending } from './rerun';

/**
 * The per-row markers the queue draws beside a message — all DERIVED, none stored. Each one
 * names a way the module can be wrong about a row, so the row says so on its face rather than
 * looking like an ordinary judged message.
 */

/** Messages are swept whole at this age; nothing survives it, in any tier. */
export const RETENTION_DAYS = 60;

/** A still-queued row inside this many days of the sweep is marked as expiring. */
export const EXPIRY_WARNING_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whether a row is inside its last week, and how long it has left. */
export interface ExpiryMarker {
  /** True once the retention sweep is `EXPIRY_WARNING_DAYS` or less away. */
  soon: boolean;
  /**
   * Whole days until the sweep deletes the row, rounded DOWN so the marker never promises more
   * time than remains. Zero means "today"; a negative value means the sweep is overdue.
   */
  daysUntilDeletion: number;
}

/**
 * How close a message is to being deleted. The sweep is blanket — a row surviving 53 days in a
 * loud tier is the more alarming case, so this is applied to every tier rather than only the
 * undated one. It mitigates and does not prevent: a week of not looking still loses the row.
 */
export function expiresSoon(message: CommMessage, now: Date): ExpiryMarker {
  const deletesAt = new Date(message.received_at).getTime() + RETENTION_DAYS * MS_PER_DAY;
  const remaining = deletesAt - now.getTime();
  return {
    soon: remaining <= EXPIRY_WARNING_DAYS * MS_PER_DAY,
    daysUntilDeletion: Math.floor(remaining / MS_PER_DAY),
  };
}

/**
 * The message reached a tier with nothing behind it — the classification ceiling was hit, or
 * the body never decoded. It is queued rather than shelved, because unknown is not nothing.
 */
export function isUnjudged(message: CommMessage): boolean {
  return message.judged_by === 'unjudged';
}

/** The model declined to judge the message. Shelved, but flagged rather than silent. */
export function isRefused(message: CommMessage): boolean {
  return message.judged_by === 'refusal';
}

/**
 * The deterministic header filter shelved this, not the model — so it carries no verdict and
 * must stay distinguishable on the shelf from mail that was actually judged.
 */
export function isFiltered(message: CommMessage): boolean {
  return message.filtered_reason !== null;
}

/**
 * An attachment with no text beside it: the message was classified with the attachment named,
 * but alfred cannot read what it is asking. Open it at the source.
 */
export function attachmentNotRead(message: CommMessage): boolean {
  return message.has_attachments && message.body.trim() === '';
}

/**
 * The body failed to decode. The row is stored and marked anyway — a skipped message is a
 * false negative that leaves no trace.
 */
export function decodeFailed(message: CommMessage): boolean {
  return !message.body_extracted;
}

/**
 * Every chip a row can carry, in the order it draws them. A re-run that is waiting leads, because
 * it qualifies every other chip — they describe a verdict that is about to be replaced.
 */
export type RowMarkerKind =
  | 'rerun-pending'
  | 'priority'
  | 'unjudged'
  | 'attachment'
  | 'decode-failed'
  | 'expiry'
  | 'refused'
  | 'filtered';

/**
 * The chips one row carries, in draw order. `shelved` adds the two only a shelf row can carry:
 * a queued row can never have been refused or filtered.
 */
export function rowMarkerKinds(
  message: CommMessage,
  people: CommPersonWithHandles[],
  now: Date,
  shelved: boolean,
): RowMarkerKind[] {
  const kinds: RowMarkerKind[] = [];
  if (isReclassifyPending(message)) kinds.push('rerun-pending');
  if (resolvePerson(message.sender_handle, people)?.priority === 'high') kinds.push('priority');
  if (isUnjudged(message)) kinds.push('unjudged');
  if (attachmentNotRead(message)) kinds.push('attachment');
  if (decodeFailed(message)) kinds.push('decode-failed');
  // The 60-day sweep is blanket, so a still-owed row can be deleted while still owed.
  if (expiresSoon(message, now).soon && message.cleared_at === null) kinds.push('expiry');
  if (shelved && isRefused(message)) kinds.push('refused');
  if (shelved && isFiltered(message)) kinds.push('filtered');
  return kinds;
}

/** The draw order, for a rollup gathered out of order. */
const MARKER_ORDER: readonly RowMarkerKind[] = [
  'rerun-pending',
  'priority',
  'unjudged',
  'attachment',
  'decode-failed',
  'expiry',
  'refused',
  'filtered',
];

/** A chip on a collapsed conversation, and how many of its messages carry it. */
export interface RolledUpMarker {
  kind: RowMarkerKind;
  count: number;
}

/**
 * The chips a collapsed shelf conversation shows: the union of its messages' chips, so a refused
 * or unreadable message can't hide inside one.
 *
 * Two kinds are treated differently. The expiry chip does not roll up: the oldest message of any
 * conversation older than 53 days carries it, so it would sit on most old conversations and say
 * nothing — it stays on the message it is about. And the priority chip is never counted, since it
 * describes a sender rather than a message.
 */
export function rollUpMarkers(
  messages: readonly CommMessage[],
  people: CommPersonWithHandles[],
  now: Date,
): RolledUpMarker[] {
  const counts = new Map<RowMarkerKind, number>();
  for (const message of messages) {
    for (const kind of rowMarkerKinds(message, people, now, true)) {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }
  return MARKER_ORDER.flatMap((kind) => {
    const count = counts.get(kind);
    if (count === undefined || kind === 'expiry') return [];
    return [{ kind, count: kind === 'priority' ? 1 : count }];
  });
}
