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

export interface PostMarkersProperties {
  state: ReaderSummaryState;
  /**
   * Whether the post has been saved to Instapaper. Its own badge rather than part of the
   * summary-state map: the two are independent — a post whose summary failed is just as sendable
   * — so a sent row carries both.
   */
  sent?: boolean;
}

export function PostMarkers({ state, sent = false }: PostMarkersProperties) {
  const marker = MARKER[state];
  return (
    <>
      {marker !== undefined && <Badge variant={marker.variant}>{marker.label}</Badge>}
      {/* Where the post lives now, which is the one thing the row can still tell the owner once
          it has left the reading list. It survives an unarchive, because the post is still in
          Instapaper however the Reader files it. */}
      {sent && <Badge variant="secondary">in Instapaper</Badge>}
    </>
  );
}
