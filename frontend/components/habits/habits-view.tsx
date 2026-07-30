'use client';

import { Plus } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { EmptyState } from '@/components/atoms/empty-state';
import { ArchivedHabits } from '@/components/habits/archived-habits';
import { DeleteHabitDialog } from '@/components/habits/delete-habit-dialog';
import { EditHabitDialog } from '@/components/habits/edit-habit-dialog';
import { HabitCard } from '@/components/habits/habit-card';
import { CELL_PLATE } from '@/components/habits/habits.styles';
import { NewHabitDialog } from '@/components/habits/new-habit-dialog';
import {
  useArchivedHabits,
  useHabitActions,
  useHabits,
  useLoggedDaysReader,
} from '@/lib/stores/habits-store';
import { useToastActions } from '@/lib/stores/toast-store';
import type { Habit } from '@/lib/types';
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
 * `/habits` — the habit tracker's only view: a header, one card per active habit, then the
 * collapsed Archived section.
 *
 * Everything reads from the shell-seeded store, so switching to this view is a URL change with
 * no fetch, and a logged day repaints the grid it came from immediately.
 *
 * The edit and delete dialogs are hosted HERE rather than per card: each is a single modal that
 * names the habit it is acting on, so hoisting them keeps one mounted instance instead of one
 * per row, and a card leaving the list can't unmount the dialog mid-write.
 */
export function HabitsView() {
  const habits = useHabits();
  const archived = useArchivedHabits();
  const loggedDays = useLoggedDaysReader();
  const { addHabit, updateHabit, setArchived, deleteHabit } = useHabitActions();
  const { showToast } = useToastActions();
  const [isCreating, setIsCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<Habit | undefined>();
  const [deleting, setDeleting] = React.useState<Habit | undefined>();

  // Memoized, not computed inline: a fresh object every render re-renders the open dialog, and a
  // Radix popover inside it never settles long enough to be clicked.
  const editingLogged = React.useMemo(() => loggedDays(editing), [loggedDays, editing]);
  const deletingLogged = React.useMemo(() => loggedDays(deleting), [loggedDays, deleting]);

  /**
   * Archive takes no confirm — it is the reversible action, and a dialog would charge the safe
   * path the same friction as the destructive one. The way back rides on the toast, because by
   * then the card the menu hung off has left the list.
   */
  const archive = async (habit: Habit) => {
    try {
      await setArchived(habit.id, true);
    } catch {
      // The store already rolled the card back and toasted the failure; nothing to offer.
      return;
    }
    showToast(`Archived ${habit.name}`, 'default', undefined, {
      label: 'Undo',
      onAction: () => {
        void setArchived(habit.id, false);
      },
    });
  };

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
        // Accurate even with archived habits below: there are no ACTIVE ones.
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
                <HabitCard
                  habit={habit}
                  onEdit={() => {
                    setEditing(habit);
                  }}
                  onArchive={() => {
                    void archive(habit);
                  }}
                  onDelete={() => {
                    setDeleting(habit);
                  }}
                />
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

      <ArchivedHabits
        habits={archived}
        onUnarchive={(habit) => {
          void setArchived(habit.id, false);
        }}
        onDelete={setDeleting}
      />

      <NewHabitDialog open={isCreating} onOpenChange={setIsCreating} onCreate={addHabit} />
      <EditHabitDialog
        habit={editing}
        logged={editingLogged}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
        onSave={updateHabit}
      />
      <DeleteHabitDialog
        habit={deleting}
        logged={deletingLogged}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
        onDelete={deleteHabit}
      />
    </div>
  );
}
