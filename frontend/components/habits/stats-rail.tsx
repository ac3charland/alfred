import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { RatioBar } from '@/components/atoms/ratio-bar';
import {
  STAGE_LABEL,
  bankedAccessibleName,
  formatBanked,
  formatHitRate,
  formatStreakLength,
} from '@/components/habits/habit-format';
import { APP_WINDOW_DAYS, ESTABLISHED_DAYS } from '@/lib/habits';
import type { HabitStats } from '@/lib/habits';
import { cn } from '@/lib/utils';

/**
 * The six figures beside a habit's history grid, plus the formation badge and its meter.
 *
 * Presentational: it is handed a `HabitStats` and renders it, so every question about where a
 * number came from — the server's baseline, the window walk, or the splice of the two — is
 * settled before the component is reached.
 *
 * Each figure is its own labelled element rather than one compact string. Read aloud, "33 · 14,
 * longest · average" is not a sentence, and the rail is the one place in the view that answers
 * "how is this going?". The `data-figure` hooks mirror the grid's `data-date` / `data-status`
 * convention, so a test can address a figure without matching on a number that moves with the
 * calendar.
 *
 * No transition on any figure: a number animating while the owner reads it is noise, and the
 * tap that changed it has already repainted the cell beside it.
 */
export function StatsRail({ habitName, stats }: { habitName: string; stats: HabitStats }) {
  return (
    <div
      role="group"
      aria-label={`${habitName} stats`}
      className="flex shrink-0 flex-col gap-2.5 border-t border-border pt-3 sm:border-t-0 sm:border-l sm:pt-2 sm:pb-2 sm:pl-4"
    >
      {/* Wide, the current streak gets a line of its own and the card stays one band tall;
          on a phone the vertical stack has nothing to buy, so all three share a row. */}
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 sm:flex-col sm:gap-y-2.5">
        <Figure
          name="current-streak"
          label="current streak"
          value={String(stats.currentStreak)}
          // A live chain is lit; a dead one recedes to the label's own grey.
          className={cn(
            'text-lg',
            stats.currentStreak > 0 ? 'text-accent-green' : 'text-muted-foreground',
          )}
        />
        <FigurePair>
          <Figure name="longest" label="longest" value={String(stats.longestStreak)} />
          <Figure name="average" label="average" value={formatStreakLength(stats.averageStreak)} />
        </FigurePair>
      </div>

      <FigurePair>
        <Figure
          name="hit-rate"
          label="hit rate"
          value={formatHitRate(stats.hitRate)}
          title={`Met days over the last ${String(APP_WINDOW_DAYS)} days — exactly the span the grid draws`}
        />
        <Figure
          name="misses-left"
          label="misses left"
          value={String(stats.allowanceRemaining)}
          title="Allowance still unspent in the last 7 days"
        />
      </FigurePair>

      <div data-figure="formation" className="flex flex-col items-start gap-1.5">
        <Badge variant="accent" className="font-medium">
          {STAGE_LABEL[stats.stage]}
        </Badge>
        {/* Decorative reinforcement of the caption below it — the caption is the message, so
            the meter's own name spells the same sentence out rather than adding a claim. */}
        <RatioBar
          segments={[
            {
              label: 'banked',
              value: Math.min(stats.metDaysTotal, ESTABLISHED_DAYS),
              tone: 'bg-accent-teal',
            },
            {
              label: 'remaining',
              value: Math.max(0, ESTABLISHED_DAYS - stats.metDaysTotal),
              tone: 'bg-transparent',
            },
          ]}
          ariaLabel={bankedAccessibleName(stats.metDaysTotal)}
          className="h-1.5 w-44"
        />
        <p className="text-[11px] tabular-nums text-muted-foreground">
          {formatBanked(stats.metDaysTotal)}
        </p>
      </div>
    </div>
  );
}

/** Two figures on one line, separated by a dot the screen reader never reads. */
function FigurePair({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-x-2">
      {React.Children.map(children, (child, index) => (
        <>
          {index > 0 && (
            <span aria-hidden="true" className="text-sm text-muted-foreground">
              ·
            </span>
          )}
          {child}
        </>
      ))}
    </div>
  );
}

/**
 * One figure: the number over its label. `tabular-nums` so a streak ticking 9 → 10 doesn't
 * shift the label beneath it.
 */
function Figure({
  name,
  label,
  value,
  title,
  className,
}: {
  name: string;
  label: string;
  value: string;
  title?: string;
  className?: string;
}) {
  return (
    <div data-figure={name} className="flex flex-col" {...(title === undefined ? {} : { title })}>
      <b className={cn('text-sm font-semibold tabular-nums text-foreground', className)}>{value}</b>
      <small className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</small>
    </div>
  );
}
