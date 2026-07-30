'use client';

import { ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react';
import * as React from 'react';

import { AnimatedHeightCollapse } from '@/components/atoms/animated-height-collapse';
import { Badge } from '@/components/atoms/badge';
import { Button } from '@/components/atoms/button';
import { DisclosureToggle } from '@/components/atoms/disclosure-toggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/atoms/dropdown-menu';
import { IconButton } from '@/components/atoms/icon-button';
import {
  STAGE_LABEL,
  archivedSpan,
  formatStreakLength,
  habitSummary,
} from '@/components/habits/habit-format';
import { useHabitStats } from '@/lib/stores/habits-store';
import type { Habit } from '@/lib/types';

/**
 * One retired habit: what it was, how long it ran, and the three all-history figures it finished
 * on.
 *
 * **No grid, but the figures are real.** The store holds a trailing window of entries, so a habit
 * that ran last February has none in hand and no grid can be drawn for it — but the seed scores
 * every habit over its WHOLE life before windowing the entries, so longest, banked days and the
 * formation stage are exact rather than window-derived.
 *
 * Deliberately absent: current streak, misses left and hit rate. The first two are statements
 * about *now* and read `0` for anything retired; the hit rate is scoped to the grid's window,
 * which an archived habit has fallen out of. Showing a figure whose basis has quietly changed is
 * the trust bug this section exists to avoid.
 */
function ArchivedHabitRow({
  habit,
  onUnarchive,
  onDelete,
}: {
  habit: Habit;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const stats = useHabitStats(habit);

  return (
    <li className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{habit.name}</p>
        <p className="text-xs text-muted-foreground">
          {habitSummary(habit)} · {archivedSpan(habit)}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>
            longest{' '}
            <b className="font-semibold text-foreground">
              {formatStreakLength(stats.longestStreak)}
            </b>
          </span>
          <span>
            banked <b className="font-semibold text-foreground">{stats.metDaysTotal}</b>
          </span>
          <Badge variant="accent">{STAGE_LABEL[stats.stage]}</Badge>
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onUnarchive}>
        Unarchive
      </Button>
      {/* Unarchive is the first-class action, so the menu carries only the destructive one. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton size="sm" aria-label={`Options for ${habit.name}`}>
            <MoreHorizontal size={14} />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          // The item opens a dialog, so Radix's late focus-restore to this trigger would pull
          // focus straight back out of it. See `HabitMenu` for the full reasoning.
          onCloseAutoFocus={(event_) => {
            event_.preventDefault();
          }}
        >
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            Delete habit…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/**
 * The Archived disclosure at the bottom of `/habits` — collapsed by default, and absent entirely
 * when nothing is archived.
 *
 * Archive used to mean "gone": the reader filtered retired habits out and nothing rendered them,
 * so an accidental archive was unrecoverable without SQL. Making it reversible is what lets it be
 * the safe default it was meant to be.
 */
export function ArchivedHabits({
  habits,
  onUnarchive,
  onDelete,
}: {
  habits: Habit[];
  onUnarchive: (habit: Habit) => void;
  onDelete: (habit: Habit) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const regionId = React.useId();

  if (habits.length === 0) return null;

  return (
    <section className="flex flex-col gap-1">
      <DisclosureToggle
        aria-expanded={open}
        aria-controls={regionId}
        className="self-start gap-1"
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
        Archived ({habits.length})
      </DisclosureToggle>
      <AnimatedHeightCollapse open={open}>
        <ul id={regionId} className="flex flex-col gap-1.5 pt-1">
          {habits.map((habit) => (
            <ArchivedHabitRow
              key={habit.id}
              habit={habit}
              onUnarchive={() => {
                onUnarchive(habit);
              }}
              onDelete={() => {
                onDelete(habit);
              }}
            />
          ))}
        </ul>
      </AnimatedHeightCollapse>
    </section>
  );
}
