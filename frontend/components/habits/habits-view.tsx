'use client';

import { Plus } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { EmptyState } from '@/components/atoms/empty-state';
import { HabitCard } from '@/components/habits/habit-card';
import { CELL_PLATE } from '@/components/habits/habits.styles';
import { NewHabitDialog } from '@/components/habits/new-habit-dialog';
import { useHabitActions, useHabits } from '@/lib/stores/habits-store';
import { cn } from '@/lib/utils';

/** What each swatch stands for. Six states on small cells is too much for hue alone. */
const LEGEND: readonly { label: string; className: string }[] = [
  { label: 'met', className: CELL_PLATE.met },
  { label: 'partial', className: CELL_PLATE.partial },
  { label: 'missed', className: CELL_PLATE.missed },
  { label: 'skipped', className: CELL_PLATE.skipped },
  { label: 'not logged', className: CELL_PLATE.unknown },
  { label: 'not tracked', className: CELL_PLATE.not_applicable },
];

/**
 * `/habits` — the habit tracker's only view: a header, then one card per habit.
 *
 * Everything reads from the shell-seeded store, so switching to this view is a URL change with
 * no fetch, and a logged day repaints the grid it came from immediately.
 */
export function HabitsView() {
  const habits = useHabits();
  const { addHabit } = useHabitActions();
  const [isCreating, setIsCreating] = React.useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl text-foreground">Habits</h1>
        <Button
          size="sm"
          variant="accent"
          onClick={() => {
            setIsCreating(true);
          }}
        >
          <Plus size={14} />
          New habit
        </Button>
      </div>

      {habits.length === 0 ? (
        <div className="flex flex-col items-center">
          <EmptyState
            title="No habits yet"
            description="Define one and start a chain — the grid fills in as you log."
          />
          <Button
            variant="accent"
            size="sm"
            onClick={() => {
              setIsCreating(true);
            }}
          >
            <Plus size={14} />
            New habit
          </Button>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {habits.map((habit) => (
              <li key={habit.id}>
                <HabitCard habit={habit} />
              </li>
            ))}
          </ul>
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {LEGEND.map((entry) => (
              <li key={entry.label} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn('inline-block h-[13px] w-[13px] rounded-[4px]', entry.className)}
                />
                {entry.label}
              </li>
            ))}
          </ul>
        </>
      )}

      <NewHabitDialog open={isCreating} onOpenChange={setIsCreating} onCreate={addHabit} />
    </div>
  );
}
