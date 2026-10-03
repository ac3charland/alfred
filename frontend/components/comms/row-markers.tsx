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
 * All of them are DERIVED (see `rowMarkerKinds`). Nothing here is a stored flag, so nothing can
 * go stale. One chip is about the verdict rather than a way it can be wrong: a re-run that is
 * waiting on the Worker. It leads, because it qualifies every other chip.
 *
 * A collapsed shelf conversation draws the same chips rolled up across its messages, through the
 * same map below, so a chip can't look different on a conversation and on its message.
 */

const CHIP: Record<RowMarkerKind, { label: string; variant: BadgeProperties['variant'] }> = {
  'rerun-pending': { label: 'Re-run pending', variant: 'secondary' },
  priority: { label: 'Priority person', variant: 'accent' },
  // "Not judged" rather than "not classified": the row is in the queue because nothing decided
  // it wasn't, and it is treated as owed until it can be read.
  unjudged: { label: 'Unjudged', variant: 'alert' },
  attachment: { label: 'Attachment · not read', variant: 'alert' },
  'decode-failed': { label: 'Body · not decoded', variant: 'alert' },
  // Labelled per row with the days left — see `expiryLabel`.
  expiry: { label: 'Deleted soon', variant: 'overdue' },
  refused: { label: 'Refused', variant: 'destructiveOutline' },
  // Filtered mail carries no verdict and no reason, so it has to stay distinguishable on the
  // shelf from mail the model actually looked at.
  filtered: { label: 'Filtered', variant: 'muted' },
};

/** The chip row itself; renders nothing for an empty list. */
function MarkerChips({ chips }: { chips: { kind: RowMarkerKind; label: string }[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="row-markers">
      {chips.map(({ kind, label }) => (
        <Badge key={kind} variant={CHIP[kind].variant} className="font-medium">
          {label}
        </Badge>
      ))}
    </div>
  );
}

/** The 60-day sweep's warning, with the days it leaves. */
function expiryLabel(message: CommMessage, now: Date): string {
  const { daysUntilDeletion } = expiresSoon(message, now);
  return daysUntilDeletion <= 0 ? 'Deleted today' : `Deleted in ${String(daysUntilDeletion)} days`;
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
  const chips = rowMarkerKinds(message, people, now, shelved).map((kind) => ({
    kind,
    label: kind === 'expiry' ? expiryLabel(message, now) : CHIP[kind].label,
  }));
  return <MarkerChips chips={chips} />;
}

interface RolledUpMarkersProperties {
  /** A shelf conversation's messages. */
  messages: CommMessage[];
  people: CommPersonWithHandles[];
  now: Date;
}

/**
 * A collapsed conversation's chips: each one any of its messages carries, with a count when more
 * than one does ("Attachment · not read · 2"), so collapsing never hides a warning.
 */
export function RolledUpMarkers({ messages, people, now }: RolledUpMarkersProperties) {
  const chips = rollUpMarkers(messages, people, now).map(({ kind, count }) => ({
    kind,
    label: count > 1 ? `${CHIP[kind].label} · ${String(count)}` : CHIP[kind].label,
  }));
  return <MarkerChips chips={chips} />;
}
