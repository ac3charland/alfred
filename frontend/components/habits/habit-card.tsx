'use client';

import * as React from 'react';

import { habitSummary } from '@/components/habits/habit-format';
import { HabitMenu } from '@/components/habits/habit-menu';
import { HistoryGrid } from '@/components/habits/history-grid';
import { StatsRail } from '@/components/habits/stats-rail';
import { useHabitEntries, useHabitStats, useHabitsToday } from '@/lib/stores/habits-store';
import type { Habit } from '@/lib/types';

/**
 * One habit: its name, a plain-English cadence summary, its history grid, and the stats rail
 * beside it — plus the `⋯` menu that acts on the habit itself.
 *
 * The grid and rail sit in a flex row that becomes a column below `sm`, where the rail wraps under
 * the grid and its dividing rule follows. The grid keeps its own horizontal scroll, so a long
 * history scrolls inside itself rather than pushing the numbers off-screen.
 */
export function HabitCard({
  habit,
  onEdit,
  onArchive,
  onDelete,
}: {
  habit: Habit;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const entries = useHabitEntries(habit.id);
  const today = useHabitsToday();
  const stats = useHabitStats(habit);

  return (
    <section className="rounded-lg border border-border bg-surface/40 p-4">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="text-sm font-semibold text-foreground">{habit.name}</h2>
        <p className="text-xs text-muted-foreground">· {habitSummary(habit)}</p>
        <span className="flex-1" />
        <HabitMenu name={habit.name} onEdit={onEdit} onArchive={onArchive} onDelete={onDelete} />
      </header>
      <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:gap-4">
        <HistoryGrid habit={habit} entries={entries} today={today} />
        <StatsRail habitName={habit.name} stats={stats} />
      </div>
    </section>
  );
}
