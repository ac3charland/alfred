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

export function PostMarkers({ state }: { state: ReaderSummaryState }) {
  const marker = MARKER[state];
  if (marker === undefined) return null;
  return <Badge variant={marker.variant}>{marker.label}</Badge>;
}
