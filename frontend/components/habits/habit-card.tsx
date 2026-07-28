'use client';

import * as React from 'react';

import { habitSummary } from '@/components/habits/habit-format';
import { HistoryGrid } from '@/components/habits/history-grid';
import { useHabitEntries, useHabitsToday } from '@/lib/stores/habits-store';
import type { Habit } from '@/lib/types';

/**
 * One habit: its name, a plain-English cadence summary, and its history grid.
 *
 * The grid sits in its own row of a flex column so the stats rail can drop in beside it later
 * without moving anything else — the rail is a separate slice, and this card is laid out for
 * its arrival rather than around its absence.
 */
export function HabitCard({ habit }: { habit: Habit }) {
  const entries = useHabitEntries(habit.id);
  const today = useHabitsToday();

  return (
    <section className="rounded-lg border border-border bg-surface/40 p-4">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="text-sm font-semibold text-foreground">{habit.name}</h2>
        <p className="text-xs text-muted-foreground">· {habitSummary(habit)}</p>
      </header>
      <div className="mt-1 flex gap-4">
        <HistoryGrid habit={habit} entries={entries} today={today} />
      </div>
    </section>
  );
}
