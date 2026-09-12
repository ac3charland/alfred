'use client';

import * as React from 'react';

import { BarLineChart, type BarLinePoint } from '@/components/atoms/bar-line-chart';
import { SurfaceCard } from '@/components/atoms/surface-card';
import { useLocVelocity } from '@/lib/hooks/use-loc-velocity';
import type { LocVelocityResponse, LocWeek } from '@/lib/types';

const TITLE = 'Lines changed per week';

/** The last day a week covers — its Sunday plus six. */
const WEEK_SPAN_DAYS = 6;

/**
 * "Sep 6" for a `YYYY-MM-DD` week key, `dayOffset` days along. Formatted in UTC because the
 * buckets are anchored to Sunday 00:00 UTC by GitHub: rendering them in a local zone would
 * shift every label by a day for half the world.
 */
function formatDay(isoDate: string, dayOffset: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "Jun 21 – Sep 12": the first day of the oldest week to the last day the newest one covers. */
function formatWindowRange(weeks: readonly LocWeek[]): string {
  const first = weeks[0];
  const last = weeks.at(-1);
  if (first === undefined || last === undefined) return '';
  return `${formatDay(first.week, 0)} – ${formatDay(last.week, WEEK_SPAN_DAYS)}`;
}

/**
 * The average the card's detail line quotes: the newest week that HAS one, i.e. the last
 * complete week. The in-progress week carries `null`, so quoting "the latest average" naively
 * would either print nothing or print a mid-week number as if it were a full one.
 */
function latestAverage(weeks: readonly LocWeek[]): number | undefined {
  for (let index = weeks.length - 1; index >= 0; index -= 1) {
    const average = weeks[index]?.average;
    if (average !== null && average !== undefined) return average;
  }
  return undefined;
}

/** Each week as a plottable point, with the hover readout spelled out for the bar's title. */
function toPoints(velocity: LocVelocityResponse): BarLinePoint[] {
  return velocity.weeks.map((week) => {
    const range = `${formatDay(week.week, 0)} – ${formatDay(week.week, WEEK_SPAN_DAYS)}`;
    const lines = `${week.lines.toLocaleString('en-US')} lines${week.partial ? ' (so far)' : ''}`;
    return {
      label: formatDay(week.week, 0),
      value: week.lines,
      average: week.average,
      title: `${range} · ${lines}`,
      ...(week.partial && { provisional: true }),
    };
  });
}

/** "12 weeks of lines changed, from 3,800 to 6,140 a week" — what the plot conveys, in words. */
function describeSeries(velocity: LocVelocityResponse): string {
  const values = velocity.weeks.map((week) => week.lines);
  const low = Math.min(...values).toLocaleString('en-US');
  const high = Math.max(...values).toLocaleString('en-US');
  return `Lines changed over the last ${String(velocity.weeks.length)} weeks, ranging from ${low} to ${high} a week`;
}

/** One legend entry: a swatch (or a rule, for the line) and what it names. */
function LegendEntry({ mark, children }: { mark: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {mark}
      <span className="text-foreground">{children}</span>
    </li>
  );
}

/**
 * The Dashboard's lines-changed card: additions plus deletions per calendar week across the
 * configured repos, as one bar per week with a four-week trailing-average line over them.
 *
 * Churn rather than net growth, so a week spent deleting a dead module reads as the busy week
 * it was. The line runs in the neutral foreground, not the bars' teal — a teal line over teal
 * bars disappears, and any second accent would imply a second metric.
 *
 * Like the PR ratio beside it, it is an ornament and never a gate: an unconfigured deployment
 * renders nothing at all (no card, no gap), and every failure resolves to a muted line with the
 * Dashboard around it fully usable.
 */
export function LocVelocity() {
  const state = useLocVelocity();

  if (state.status === 'unconfigured') return null;

  if (state.status === 'loading') {
    return (
      <SurfaceCard title={TITLE}>
        {/* Reserves the plot's height so the cards below don't jump when the series lands. */}
        <div className="h-32 w-full animate-pulse rounded-md bg-border motion-reduce:animate-none" />
      </SurfaceCard>
    );
  }

  if (state.status === 'computing') {
    return (
      <SurfaceCard title={TITLE}>
        <p className="text-sm text-muted-foreground">
          GitHub is still computing these statistics. Refresh in a minute.
        </p>
      </SurfaceCard>
    );
  }

  if (state.status === 'error') {
    return (
      <SurfaceCard title={TITLE}>
        <p className="text-sm text-muted-foreground">Couldn&apos;t load line counts.</p>
      </SurfaceCard>
    );
  }

  const { velocity } = state;
  const range = formatWindowRange(velocity.weeks);

  if (velocity.weeks.every((week) => week.lines === 0)) {
    return (
      <SurfaceCard title={TITLE} detail={range}>
        {/* A genuinely quiet quarter — a normal state, not an error. */}
        <p className="text-sm text-muted-foreground">
          No lines changed in the last {velocity.weeks.length} weeks.
        </p>
      </SurfaceCard>
    );
  }

  const average = latestAverage(velocity.weeks);
  const detail =
    average === undefined
      ? range
      : `${range}  ·  ${String(velocity.averageWeeks)}-week average ${average.toLocaleString('en-US')}`;

  return (
    <SurfaceCard title={TITLE} detail={detail}>
      <BarLineChart points={toPoints(velocity)} ariaLabel={describeSeries(velocity)} />
      {/* Exactly the three marks the plot draws, and nothing else. */}
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <LegendEntry
          mark={
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm bg-accent-teal" />
          }
        >
          Lines changed
        </LegendEntry>
        <LegendEntry
          mark={
            <span aria-hidden="true" className="h-0 w-3.5 shrink-0 border-t-2 border-foreground" />
          }
        >
          {velocity.averageWeeks}-week average
        </LegendEntry>
        <LegendEntry
          mark={
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-sm bg-accent-teal/30"
            />
          }
        >
          This week so far
        </LegendEntry>
      </ul>
    </SurfaceCard>
  );
}
