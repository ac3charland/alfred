import * as React from 'react';

import { Badge, type BadgeProperties } from '@/components/atoms/badge';
import type { ReaderSummaryState } from '@/lib/types';

/**
 * The row's badges. The floor-state badge is the one-word admission that a `pending`, `failed`
 * or `refused` post has nothing to show yet — `done` needs none, a finished summary speaks for
 * itself — and beside it, on a post sent to Instapaper, the badge that says where it went.
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
   * Whether Instapaper has confirmed a save of this post. A sent post lives in the archive, so the
   * badge is what tells it apart from one the owner simply dismissed — and it stays through an
   * unarchive, because the post is still in Instapaper either way.
   */
  sent?: boolean;
}

export function PostMarkers({ state, sent = false }: PostMarkersProperties) {
  const marker = MARKER[state];
  return (
    <>
      {marker !== undefined && <Badge variant={marker.variant}>{marker.label}</Badge>}
      {sent && <Badge variant="secondary">in Instapaper</Badge>}
    </>
  );
}
