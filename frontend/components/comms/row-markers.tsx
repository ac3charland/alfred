'use client';

import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import {
  attachmentNotRead,
  decodeFailed,
  expiresSoon,
  isFiltered,
  isRefused,
  isUnjudged,
} from '@/lib/comms';
import { resolvePerson } from '@/lib/comms/people';
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

export function RowMarkers({ message, people, now, shelved = false }: RowMarkersProperties) {
  const person = resolvePerson(message.sender_handle, people);
  const expiry = expiresSoon(message, now);

  const chips: React.ReactNode[] = [];

  if (person?.priority === 'high') {
    chips.push(
      <Badge key="priority" variant="accent" className="font-medium">
        Priority person
      </Badge>,
    );
  }

  // "Not judged" rather than "not classified": the row is in the queue because nothing decided
  // it wasn't, and it is treated as owed until it can be read.
  if (isUnjudged(message)) {
    chips.push(
      <Badge key="unjudged" variant="alert" className="font-medium">
        Unjudged
      </Badge>,
    );
  }

  if (attachmentNotRead(message)) {
    chips.push(
      <Badge key="attachment" variant="alert" className="font-medium">
        Attachment · not read
      </Badge>,
    );
  }

  // A skipped message is a false negative that leaves no trace, so the row that hid it from the
  // classifier says so on its own face — same treatment as the attachment it couldn't read.
  if (decodeFailed(message)) {
    chips.push(
      <Badge key="decode-failed" variant="alert" className="font-medium">
        Body · not decoded
      </Badge>,
    );
  }

  // The 60-day sweep is blanket, so a still-owed row can be deleted while still owed. The
  // marker makes that take a week of not looking rather than happening silently.
  if (expiry.soon && message.cleared_at === null) {
    chips.push(
      <Badge key="expiry" variant="overdue" className="font-medium">
        {expiry.daysUntilDeletion <= 0
          ? 'Deleted today'
          : `Deleted in ${String(expiry.daysUntilDeletion)} days`}
      </Badge>,
    );
  }

  if (shelved && isRefused(message)) {
    chips.push(
      <Badge key="refused" variant="destructiveOutline" className="font-medium">
        Refused
      </Badge>,
    );
  }

  // Filtered mail carries no verdict and no reason, so it has to stay distinguishable on the
  // shelf from mail the model actually looked at.
  if (shelved && isFiltered(message)) {
    chips.push(
      <Badge key="filtered" variant="muted" className="font-medium">
        Filtered
      </Badge>,
    );
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="row-markers">
      {chips}
    </div>
  );
}
