'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { DialogDescription, DialogTitle, FormDialog } from '@/components/atoms/dialog';
import { deleteConfirmLine } from '@/components/habits/habit-format';
import type { LoggedDays } from '@/lib/habits';
import { useFormSubmit } from '@/lib/hooks/use-form-submit';
import type { Habit } from '@/lib/types';

/**
 * The delete confirm: the habit named, and the cost stated in days.
 *
 * No typed confirmation — the named count and the destructive styling carry the weight, matching
 * the day editor's skip flow ("a second step, not a bigger button"). Focus lands on **Cancel**,
 * and Escape cancels, so the dangerous button is never the one a stray Return finds.
 */
export function DeleteHabitDialog({
  habit,
  logged,
  onOpenChange,
  onDelete,
}: {
  /** The habit being deleted; `undefined` keeps the dialog closed. */
  habit: Habit | undefined;
  logged: LoggedDays;
  onOpenChange: (open: boolean) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <FormDialog open={habit !== undefined} onOpenChange={onOpenChange}>
      {habit !== undefined && (
        <DeleteHabitBody
          habit={habit}
          logged={logged}
          onCancel={() => {
            onOpenChange(false);
          }}
          onDelete={onDelete}
        />
      )}
    </FormDialog>
  );
}

/** The body mounts fresh per habit, so a pending state can never outlive the dialog it began in. */
function DeleteHabitBody({
  habit,
  logged,
  onCancel,
  onDelete,
}: {
  habit: Habit;
  logged: LoggedDays;
  onCancel: () => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  // The dialog suppresses Radix's own auto-focus so the destructive button can't receive it.
  React.useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const { error, isPending, submit } = useFormSubmit({
    onSubmit: () => onDelete(habit.id),
    onSuccess: onCancel,
    errorMessage: 'Could not delete the habit. Try again.',
  });

  return (
    <>
      <DialogTitle className="text-base font-semibold text-foreground">
        Delete “{habit.name}”?
      </DialogTitle>
      <DialogDescription className="mt-2 text-sm text-muted-foreground">
        {deleteConfirmLine(habit, logged)}{' '}
        <b className="font-semibold text-foreground">Archive it instead</b> to keep the record.
      </DialogDescription>

      {error !== null && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-6 flex justify-end gap-3">
        <Button variant="outline" size="sm" ref={cancelRef} onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button variant="destructive" size="sm" disabled={isPending} onClick={() => void submit()}>
          {isPending ? 'Deleting…' : 'Delete habit'}
        </Button>
      </div>
    </>
  );
}
