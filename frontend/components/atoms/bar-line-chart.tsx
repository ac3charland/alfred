import * as React from 'react';

import { cn } from '@/lib/utils';

export interface BarLinePoint {
  /** Short axis label, e.g. 'Sep 6'. */
  label: string;
  value: number;
  /** The trend value at this point, or `null` to BREAK the line here. */
  average: number | null;
  /** Dim the bar — a bucket that is still filling. */
  provisional?: boolean;
  /** Hover readout for this bucket, e.g. 'Sep 6 – Sep 12 · 1,980 lines (so far)'. */
  title: string;
}

interface BarLineChartProperties {
  points: readonly BarLinePoint[];
  /**
   * What the chart conveys, spelled out for assistive technology — the plot alone carries the
   * information, so it is an image with a label rather than decoration.
   */
  ariaLabel: string;
  className?: string;
}

/** A non-zero bar never disappears: a quiet bucket still gets a visible sliver. */
const MINIMUM_BAR_PERCENT = 2;

/**
 * The next "nice" ceiling at or above `max`: the next multiple of 10^(digits-1), so 6 140 → 7 000,
 * 420 → 500, 3 → 3. A raw maximum would put the tallest bar flush against the top rule and label
 * the axis with an arbitrary number nobody chose.
 *
 * Six-digit values round to the nearest 20,000 instead of the next 100,000: rounding to a whole
 * magnitude step is fine when the step is small relative to `max` (6 140 → 7 000 is a 14% move),
 * but at six digits that same rule can nearly double it — 102 000 → 200 000.
 *
 * Zero (or less) yields zero — the caller draws no plot at all rather than dividing by it.
 */
export function niceCeiling(max: number): number {
  if (max <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const step = magnitude === 100_000 ? 20_000 : magnitude;
  return Math.ceil(max / step) * step;
}

/**
 * The trend polylines: one `points` string per UNBROKEN run of the series. A `null` average
 * splits the run, because the alternatives both lie — one polyline with the gaps dropped draws
 * a straight segment straight across them, and a polyline treating `null` as `0` dives to the
 * floor.
 *
 * Coordinates are percentages in a `0 0 100 100` box: x is the centre of each column, y is
 * inverted so 0 is the top.
 */
export function trendSegments(
  points: readonly BarLinePoint[],
  ceiling: number,
): { key: string; points: string }[] {
  if (ceiling <= 0) return [];

  const width = 100 / points.length;
  const segments: { key: string; points: string }[] = [];
  let run: string[] = [];
  let runStart = 0;

  const flush = (endIndex: number) => {
    // A single point has no line to draw, so a lone reading between two gaps draws nothing.
    if (run.length > 1)
      segments.push({ key: `${String(runStart)}-${String(endIndex)}`, points: run.join(' ') });
    run = [];
  };

  for (const [index, point] of points.entries()) {
    if (point.average === null) {
      flush(index);
      continue;
    }
    if (run.length === 0) runStart = index;
    const x = width * index + width / 2;
    const y = 100 - (point.average / ceiling) * 100;
    run.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  flush(points.length);

  return segments;
}

/**
 * A bucketed series as bars with a trend line over them. Presentation only — no fetching, no
 * arithmetic over domain values, no domain vocabulary — so it stays reusable for any bucketed
 * series with a trend.
 *
 * The bars are HTML, not SVG: a flex row of equal-basis columns, each bar sized by an inline
 * height percentage the way `RatioBar` sets its widths, with the axis labels as real text below
 * the track so they scale with the reader's font size instead of being baked into a `viewBox`.
 *
 * Only the trend line is SVG — one absolutely-positioned overlay at `viewBox="0 0 100 100"`
 * with `preserveAspectRatio="none"`, so its coordinates are plain percentages. That non-uniform
 * scale would distort a stroke, hence `vector-effect="non-scaling-stroke"`; without it the line
 * is visibly fat horizontally and thin vertically. For the same reason there are no point
 * markers: a circle would scale into an ellipse.
 */
export function BarLineChart({ points, ariaLabel, className }: BarLineChartProperties) {
  const ceiling = niceCeiling(Math.max(0, ...points.map((point) => point.value)));
  const segments = trendSegments(points, ceiling);

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="relative">
        {ceiling > 0 && (
          <span className="absolute -top-2 left-0 z-10 bg-surface pr-1 text-[10px] text-muted-foreground">
            {ceiling.toLocaleString('en-US')}
          </span>
        )}
        <div
          role="img"
          aria-label={ariaLabel}
          className="relative flex h-32 items-end gap-1 border-b border-border"
        >
          {/* The axis-maximum rule. Its own element because Tailwind's `border-dashed` styles
              every side, and the baseline below is solid. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border"
          />
          {points.map((point) => (
            <div key={point.label} className="flex h-full flex-1 items-end">
              {ceiling > 0 && point.value > 0 && (
                <div
                  title={point.title}
                  className={cn(
                    'w-full rounded-t-sm',
                    point.provisional === true ? 'bg-accent-teal/30' : 'bg-accent-teal',
                  )}
                  style={{
                    height: `${String(Math.max(MINIMUM_BAR_PERCENT, (point.value / ceiling) * 100))}%`,
                  }}
                />
              )}
            </div>
          ))}
          <svg
            aria-hidden="true"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          >
            {segments.map((segment) => (
              <polyline
                key={segment.key}
                points={segment.points}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className="text-foreground"
              />
            ))}
          </svg>
        </div>
      </div>
      <div className="mt-1.5 flex gap-1">
        {points.map((point, index) => (
          <span
            key={point.label}
            // Labels collide below `sm`; hiding alternates keeps every bar drawn and the axis
            // readable, rather than dropping buckets to make room. The survivors are free to
            // overflow their own column — the neighbour they spill into is blank by then, and
            // truncating instead would leave a row of ellipses.
            className={cn(
              'flex-1 whitespace-nowrap text-center text-[9.5px] text-muted-foreground',
              index % 2 === 1 && 'max-sm:invisible',
            )}
          >
            {point.label}
          </span>
        ))}
      </div>
    </div>
  );
}
