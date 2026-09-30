import * as React from 'react';

import { Badge, type BadgeProperties } from '@/components/atoms/badge';
import type { ResearchPhase } from '@/lib/reader/research';
import type { ReaderSummaryState } from '@/lib/types';

interface Marker {
  label: string;
  variant: BadgeProperties['variant'];
}

/**
 * The row's floor-state badge — the one-word admission that a `pending`, `failed` or `refused`
 * post has nothing to show yet. `done` needs none: a finished summary speaks for itself.
 */
const MARKER: Partial<Record<ReaderSummaryState, Marker>> = {
  pending: { label: 'summarising…', variant: 'muted' },
  failed: { label: 'summary failed', variant: 'alert' },
  refused: { label: 'summary refused', variant: 'destructiveOutline' },
};

const RESEARCHING: Marker = { label: 'researching…', variant: 'muted' };
const NO_REPORT: Marker = { label: 'no report', variant: 'alert' };

/**
 * A research post's badge while its report has not arrived: waiting on the session, or admitting
 * there is nothing to wait for. Once the report is delivered (`done`) the post is an ordinary one
 * and has none — the summary state's badge takes over.
 */
const RESEARCH_MARKER: Partial<Record<ResearchPhase, Marker>> = {
  queued: RESEARCHING,
  researching: RESEARCHING,
  failed: NO_REPORT,
  'stale-queued': NO_REPORT,
  'stale-researching': NO_REPORT,
};

/**
 * The row's badges: the state's, when it has one, and — beside it rather than instead of it,
 * since the two say unrelated things — a quiet `in Instapaper` once the post has been sent.
 * The sent badge outlives an unarchive: the post is still in Instapaper.
 *
 * A research post with no report yet says that instead of its summary state: it has nothing to
 * summarise, so `summarising…` would be a lie about what it is waiting for.
 */
export function PostMarkers({
  state,
  phase,
  sent,
}: {
  state: ReaderSummaryState;
  /** The research phase, for a research post; absent for every other kind. */
  phase?: ResearchPhase | undefined;
  sent: boolean;
}) {
  const marker = (phase === undefined ? undefined : RESEARCH_MARKER[phase]) ?? MARKER[state];
  return (
    <>
      {marker !== undefined && <Badge variant={marker.variant}>{marker.label}</Badge>}
      {sent && <Badge variant="secondary">in Instapaper</Badge>}
    </>
  );
}
