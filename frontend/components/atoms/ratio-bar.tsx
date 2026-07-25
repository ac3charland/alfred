import * as React from 'react';

import { cn } from '@/lib/utils';

export interface RatioSegment {
  /** Identifies the segment; not rendered — the caller owns the visible legend. */
  label: string;
  /** Raw magnitude. Widths are this value's share of the total, not a pre-rounded percent. */
  value: number;
  /** Fill class for this segment, e.g. `bg-accent-teal`. */
  tone: string;
}

interface RatioBarProperties {
  segments: readonly RatioSegment[];
  /**
   * What the bar conveys, spelled out for assistive technology — the visual split alone
   * carries the information, so the bar is an image with a label rather than decoration.
   */
  ariaLabel: string;
  className?: string;
}

/**
 * A stacked horizontal bar: one proportionally-sized segment per value, rounded at the outer
 * ends. Presentation only — no fetching, no percentage math, no domain vocabulary — so it
 * stays reusable for any part-of-whole split.
 *
 * Widths come from each value's raw share, so the segments always tile the full track even
 * when the caller's displayed percentages have been rounded. Zero-value segments are dropped
 * entirely rather than rendered as a hairline sliver.
 */
export function RatioBar({ segments, ariaLabel, className }: RatioBarProperties) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const filled = total > 0 ? segments.filter((segment) => segment.value > 0) : [];

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={cn('flex h-2.5 w-full overflow-hidden rounded-full bg-border', className)}
    >
      {filled.map((segment) => (
        <div
          key={segment.label}
          aria-hidden="true"
          className={segment.tone}
          style={{ width: `${String((segment.value / total) * 100)}%` }}
        />
      ))}
    </div>
  );
}
