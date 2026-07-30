'use client';

import * as React from 'react';

import { FormDialog } from '@/components/atoms/dialog';
import { HabitSentenceForm } from '@/components/habits/habit-sentence-form';
import { ApiError, type UpdateHabitInput } from '@/lib/api-client';
import { parseCriteria } from '@/lib/habits';
import type { LoggedDays } from '@/lib/habits';
import type { Habit } from '@/lib/types';

interface EditHabitDialogProperties {
  /** The habit being edited; `undefined` keeps the dialog closed. */
  habit: Habit | undefined;
  logged: LoggedDays;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, input: UpdateHabitInput) => Promise<Habit>;
}

/**
 * A refused save explains itself. The route's `409` is written to be read — it names the field
 * and how many days stand behind it — so quoting it beats a generic retry prompt the owner
 * cannot act on.
 */
function saveErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.detail !== undefined) return error.detail;
  return 'Could not save the habit. Try again.';
}

/**
 * The edit dialog: the same sentence the habit was written in, read back with its own values.
 *
 * Recognition rather than a new form — every control, popover and keyboard path is one the owner
 * already met when they created the habit. Archive and delete are deliberately NOT here: they
 * act on the habit itself rather than on what it says, so they live one level up in the card's
 * menu.
 */
export function EditHabitDialog({
  habit,
  logged,
  onOpenChange,
  onSave,
}: EditHabitDialogProperties) {
  return (
    <FormDialog
      open={habit !== undefined}
      onOpenChange={onOpenChange}
      maxWidth="lg"
      onOpenAutoFocus={(event_) => {
        event_.preventDefault();
      }}
    >
      {habit !== undefined && (
        <HabitSentenceForm
          title="Edit habit"
          description="Change what counts as a good day."
          initial={{
            name: habit.name,
            criteria: parseCriteria(habit.criteria),
            activeDays: habit.active_days,
            allowance: habit.allowance,
          }}
          logged={logged}
          submitLabel="Save changes"
          pendingLabel="Saving…"
          errorMessage={saveErrorMessage}
          onCancel={() => {
            onOpenChange(false);
          }}
          onSubmit={(values) =>
            // The cadence goes along unchanged: PATCH compares against the stored row and only
            // refuses a real change, so resending what is on screen stays a no-op.
            onSave(habit.id, {
              name: values.name,
              criteria: values.criteria,
              active_days: values.activeDays,
              allowance: values.allowance,
            })
          }
        />
      )}
    </FormDialog>
  );
}
