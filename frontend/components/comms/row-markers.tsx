'use client';

import * as React from 'react';

import { Badge, type BadgeProperties } from '@/components/atoms/badge';
import { type RowMarkerKind, expiresSoon, rollUpMarkers, rowMarkerKinds } from '@/lib/comms';
import type { CommMessage, CommPersonWithHandles } from '@/lib/types';

/**
 * The chips beside a row — every one of them a way the module can be wrong about it, said out
 * loud on the row's own face.
 *
 * They exist because the alternative to a marked row is an invisible one. A message alfred
 * could not judge, could not read, or refused to judge still has to be distinguishable from a
 * message it judged confidently — otherwise the failure it represents is indistinguishable from
 * ordinary operation, which is the one failure mode this module cannot recover from.
 *
 * All of them are DERIVED (`rowMarkerKinds` decides which apply). Nothing here is a stored flag,
 * so nothing can go stale.
 *
 * One chip is about the verdict rather than a way it can be wrong: a re-run that is waiting on the
 * Worker. It leads, because it qualifies every other chip — they describe a verdict that is about
 * to be replaced — and it is on the collapsed row so the wait is visible without opening it.
 */

/**
 * How each chip looks — the one map a message row and a collapsed conversation both draw from, so
 * a chip can't read differently on a thread and on the message inside it. Expiry's label is
 * per-message (how many days are left), so it is filled in by {@link RowMarkers}.
 */
const MARKER_BADGE: Record<RowMarkerKind, { variant: BadgeProperties['variant']; label: string }> =
  {
    'rerun-pending': { variant: 'secondary', label: 'Re-run pending' },
    priority: { variant: 'accent', label: 'Priority person' },
    // "Not judged" rather than "not classified": the row is in the queue because nothing decided
    // it wasn't, and it is treated as owed until it can be read.
    unjudged: { variant: 'alert', label: 'Unjudged' },
    attachment: { variant: 'alert', label: 'Attachment · not read' },
    // A skipped message is a false negative that leaves no trace, so the row that hid it from the
    // classifier says so on its own face — same treatment as the attachment it couldn't read.
    'decode-failed': { variant: 'alert', label: 'Body · not decoded' },
    expiry: { variant: 'overdue', label: 'Deleted soon' },
    refused: { variant: 'destructiveOutline', label: 'Refused' },
    // Filtered mail carries no verdict and no reason, so it has to stay distinguishable on the
    // shelf from mail the model actually looked at.
    filtered: { variant: 'muted', label: 'Filtered' },
  };

function MarkerChips({ chips }: { chips: { kind: RowMarkerKind; label: string }[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="row-markers">
      {chips.map(({ kind, label }) => (
        <Badge key={kind} variant={MARKER_BADGE[kind].variant} className="font-medium">
          {label}
        </Badge>
      ))}
    </div>
  );
}

interface RowMarkersProperties {
  message: CommMessage;
  /** The roster, for the priority chip — the one marker that is about the SENDER. */
  people: CommPersonWithHandles[];
  /** The instant the expiry marker is measured against. */
  now: Date;
  /** Shelf rows carry two more chips; queued rows can never be refused or filtered. */
  shelved?: boolean;
}

export function RowMarkers({ message, people, now, shelved = false }: RowMarkersProperties) {
  const chips = rowMarkerKinds(message, people, now, shelved).map((kind) => {
    if (kind !== 'expiry') return { kind, label: MARKER_BADGE[kind].label };
    // The marker makes deletion take a week of not looking rather than happening silently.
    const days = expiresSoon(message, now).daysUntilDeletion;
    return { kind, label: days <= 0 ? 'Deleted today' : `Deleted in ${String(days)} days` };
  });
  return <MarkerChips chips={chips} />;
}

interface ConversationMarkersProperties {
  /** Every message in the conversation; the chips are their union. */
  messages: CommMessage[];
  people: CommPersonWithHandles[];
  now: Date;
}

/**
 * A collapsed conversation's chips: each one any of its messages carries, counted when more than
 * one does ("Attachment · not read · 2"), so collapsing a flagged message can't hide its flag.
 */
export function ConversationMarkers({ messages, people, now }: ConversationMarkersProperties) {
  const chips = rollUpMarkers(messages, people, now).map(({ kind, count }) => ({
    kind,
    label: count > 1 ? `${MARKER_BADGE[kind].label} · ${String(count)}` : MARKER_BADGE[kind].label,
  }));
  return <MarkerChips chips={chips} />;
}
