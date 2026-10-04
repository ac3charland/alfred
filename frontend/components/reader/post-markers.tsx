import * as React from 'react';

import { Badge, type BadgeProperties } from '@/components/atoms/badge';
import type { ReaderSummaryState } from '@/lib/types';

/**
 * The row's floor-state badge — the one-word admission that a `pending`, `failed` or `refused`
 * post has nothing to show yet. `done` needs none: a finished summary speaks for itself.
 */
const MARKER: Partial<
  Record<ReaderSummaryState, { label: string; variant: BadgeProperties['variant'] }>
> = {
  pending: { label: 'summarising…', variant: 'muted' },
  failed: { label: 'summary failed', variant: 'alert' },
  refused: { label: 'summary refused', variant: 'destructiveOutline' },
};

/**
 * The row's badges: the floor-state one, and — beside it — `in Instapaper` once the post has been
 * sent there. A sent post keeps the badge wherever it sits, archive or (after an unarchive) list.
 */
export function PostMarkers({
  state,
  sent = false,
}: {
  state: ReaderSummaryState;
  sent?: boolean;
}) {
  const marker = MARKER[state];
  if (marker === undefined && !sent) return null;
  return (
    <>
      {marker !== undefined && <Badge variant={marker.variant}>{marker.label}</Badge>}
      {sent && <Badge variant="secondary">in Instapaper</Badge>}
    </>
  );
}
