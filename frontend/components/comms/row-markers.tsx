'use client';

import * as React from 'react';

import { Badge, type BadgeProperties } from '@/components/atoms/badge';
import { type RolledUpMarker, type RowMarkerKind, expiresSoon, rowMarkerKinds } from '@/lib/comms';
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
 * All of them are DERIVED. Nothing here is a stored flag, so nothing can go stale.
 *
 * One chip is about the verdict rather than a way it can be wrong: a re-run that is waiting on the
 * Worker. It leads, because it qualifies every other chip — they describe a verdict that is about
 * to be replaced — and it is on the collapsed row so the wait is visible without opening it.
 */

interface RowMarkersProperties {
  message: CommMessage;
  /** The roster, for the priority chip — the one marker that is about the SENDER. */
  people: CommPersonWithHandles[];
  /** The instant the expiry marker is measured against. */
  now: Date;
  /** Shelf rows carry two more chips; queued rows can never be refused or filtered. */
  shelved?: boolean;
}

/**
 * Each chip's words and tone, in one place, so a chip reads the same on a message and rolled up
 * onto a shelf conversation. The expiry chip's words depend on the message, so it is worded apart.
 */
const MARKER_CHIP: Record<
  Exclude<RowMarkerKind, 'expiry'>,
  { label: string; variant: NonNullable<BadgeProperties['variant']> }
> = {
  'rerun-pending': { label: 'Re-run pending', variant: 'secondary' },
  priority: { label: 'Priority person', variant: 'accent' },
  // "Not judged" rather than "not classified": the row is in the queue because nothing decided
  // it wasn't, and it is treated as owed until it can be read.
  unjudged: { label: 'Unjudged', variant: 'alert' },
  attachment: { label: 'Attachment · not read', variant: 'alert' },
  // A skipped message is a false negative that leaves no trace, so the row that hid it from the
  // classifier says so on its own face — same treatment as the attachment it couldn't read.
  'decode-failed': { label: 'Body · not decoded', variant: 'alert' },
  refused: { label: 'Refused', variant: 'destructiveOutline' },
  // Filtered mail carries no verdict and no reason, so it has to stay distinguishable on the
  // shelf from mail the model actually looked at.
  filtered: { label: 'Filtered', variant: 'muted' },
};

/**
 * The 60-day sweep is blanket, so a still-owed row can be deleted while still owed. The marker
 * makes that take a week of not looking rather than happening silently.
 */
function expiryLabel(message: CommMessage, now: Date): string {
  const { daysUntilDeletion } = expiresSoon(message, now);
  return daysUntilDeletion <= 0 ? 'Deleted today' : `Deleted in ${String(daysUntilDeletion)} days`;
}

function MarkerChips({
  chips,
}: {
  chips: { key: string; label: string; variant: BadgeProperties['variant'] }[];
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="row-markers">
      {chips.map((chip) => (
        <Badge key={chip.key} variant={chip.variant} className="font-medium">
          {chip.label}
        </Badge>
      ))}
    </div>
  );
}

export function RowMarkers({ message, people, now, shelved = false }: RowMarkersProperties) {
  const chips = rowMarkerKinds(message, people, now, shelved).map((kind) =>
    kind === 'expiry'
      ? { key: kind, label: expiryLabel(message, now), variant: 'overdue' as const }
      : { key: kind, ...MARKER_CHIP[kind] },
  );
  return <MarkerChips chips={chips} />;
}

/**
 * A shelf conversation's chips: every chip any of its messages carries, with a count when more
 * than one does, so collapsing a refused or unreadable message into a conversation can't hide it.
 */
export function RolledUpMarkers({ markers }: { markers: RolledUpMarker[] }) {
  const chips = markers.flatMap(({ kind, count }) => {
    // The rollup never carries expiry — see `rollUpMarkers`.
    if (kind === 'expiry') return [];
    const { label, variant } = MARKER_CHIP[kind];
    return [{ key: kind, label: count > 1 ? `${label} · ${String(count)}` : label, variant }];
  });
  return <MarkerChips chips={chips} />;
}
