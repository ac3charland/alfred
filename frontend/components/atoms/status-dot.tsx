import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A small coloured dot with a label — "this source is live / stale / erroring", in the three
 * words and three tones the app uses everywhere it makes that claim.
 *
 * The distinction the dot exists to draw is between the two ways of NOT working: STALE is
 * nothing arriving (a machine asleep, a cron that did not fire) and ERRORING is work happening
 * and being refused (a revoked token, a rejected key). They look identical from volume alone.
 *
 * Presentational only: what state a source is in, how it is worded and how long it has been that
 * way are each the caller's to decide — this atom draws the claim, it never derives one.
 */

const DOT_TONE = {
  live: 'bg-accent-green',
  stale: 'bg-accent-amber',
  erroring: 'bg-accent-red',
} as const;

export type StatusDotState = keyof typeof DOT_TONE;

interface StatusDotProperties {
  state: StatusDotState;
  /** What the dot is about — the source's name, as the owner knows it. */
  label: string;
  /** Why it is in that state, for the hover/focus title: an error quoted, a silence measured. */
  title: string;
  /** How long it has been this way, when that is worth saying beside the label. */
  elapsed?: string | undefined;
  /**
   * The state in the caller's own words — "never ran" where the tone is merely `stale`. A source
   * whose states have names of their own draws that word beside the dot, and the dot then goes
   * silent: the tone words are a palette of three, and naming the state twice in two
   * vocabularies reads as two claims.
   */
  stateLabel?: string | undefined;
}

export function StatusDot({ state, label, title, elapsed, stateLabel }: StatusDotProperties) {
  // One string, drawn or spoken: a dot whose visible text and accessible name disagree is two
  // different claims about the same source.
  const claim = `${label} · ${stateLabel ?? state}`;
  const marker = cn('h-2 w-2 shrink-0 rounded-full', DOT_TONE[state]);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={title}>
      {/* Exactly one of the two carries the claim. Where the caller named the state, the line
          beside the dot says it in words and a labelled dot would announce it a second time;
          where it did not, the state rides the dot's LABEL rather than the colour alone — a red
          dot and an amber dot are the same dot to a screen reader, and to plenty of eyes. */}
      {stateLabel === undefined ? (
        <span aria-label={claim} role="img" className={marker} />
      ) : (
        <span aria-hidden="true" className={marker} />
      )}
      <span>{stateLabel === undefined ? label : claim}</span>
      {elapsed !== undefined && <span className="text-muted-foreground/70">· {elapsed}</span>}
    </span>
  );
}
