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
 * The row's badges: the summary state's, when it has one, and — beside it rather than instead
 * of it, since the two say unrelated things — a quiet `in Instapaper` once the post has been sent.
 * The sent badge outlives an unarchive: the post is still in Instapaper.
 */
export function PostMarkers({ state, sent }: { state: ReaderSummaryState; sent: boolean }) {
  const marker = MARKER[state];
  return (
    <>
      {marker !== undefined && <Badge variant={marker.variant}>{marker.label}</Badge>}
      {sent && <Badge variant="secondary">in Instapaper</Badge>}
    </>
  );
}
