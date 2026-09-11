'use client';

import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import type { QueuedTier } from '@/lib/comms';

import { TIER_LABEL } from './comms-format';
import { sectionEyebrowClass, sectionShellClass } from './message-row.styles';

/**
 * One counted tier and its rows.
 *
 * Always open — only the FYI shelf collapses. A counted tier is a claim that something
 * is owed, and a collapsed claim is one the owner has to remember to check, which is the
 * voluntary triage the module exists to remove.
 *
 * Only ASAP is loud. It is the one tier that says "break focus for this", and that claim
 * is spent the moment a second tier looks the same as it.
 */

interface TierSectionProperties {
  tier: QueuedTier;
  count: number;
  /**
   * Shown in place of the rows when the tier is empty. Only Today carries one: zero
   * there is the state the module exists to produce and is worth saying out loud, whereas an
   * empty ASAP is the unremarkable normal case and an empty Whenever means nothing at all.
   */
  emptyLabel?: string | undefined;
  children: React.ReactNode;
}

export function TierSection({ tier, count, emptyLabel, children }: TierSectionProperties) {
  const loud = tier === 'asap';

  return (
    <section className={sectionShellClass(loud)} aria-label={TIER_LABEL[tier]}>
      <div className="flex items-center gap-2 px-1">
        <h3 className={sectionEyebrowClass}>{TIER_LABEL[tier]}</h3>
        <Badge
          variant={loud ? 'due' : 'secondary'}
          aria-label={`${String(count)} in ${TIER_LABEL[tier]}`}
        >
          {count}
        </Badge>
      </div>

      {count === 0 && emptyLabel !== undefined ? (
        <p className="px-1 py-1.5 text-[13px] text-muted-foreground/70">{emptyLabel}</p>
      ) : (
        <div className="flex flex-col">{children}</div>
      )}
    </section>
  );
}
