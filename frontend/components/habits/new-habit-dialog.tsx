'use client';

import * as React from 'react';

import { FormDialog } from '@/components/atoms/dialog';
import { HabitSentenceForm } from '@/components/habits/habit-sentence-form';
import type { CreateHabitInput } from '@/lib/api-client';
import type { Habit } from '@/lib/types';

interface NewHabitDialogProperties {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CreateHabitInput) => Promise<Habit>;
}

/**
 * The create dialog: the shared habit sentence with nothing filled in and every slot open.
 *
 * The stateful body is a child that mounts fresh on open so the draft resets without a
 * setState-in-effect — the established pattern in the code module's dialogs.
 */
export function NewHabitDialog({ open, onOpenChange, onCreate }: NewHabitDialogProperties) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      maxWidth="lg"
      onOpenAutoFocus={(event_) => {
        event_.preventDefault();
      }}
    >
      <HabitSentenceForm
        title="New habit"
        description="Say what you'll do, on which days, and how much slack you get."
        submitLabel="Create habit"
        pendingLabel="Creating…"
        errorMessage="Could not create the habit. Try again."
        onCancel={() => {
          onOpenChange(false);
        }}
        onSubmit={(values) =>
          onCreate({
            name: values.name,
            criteria: values.criteria,
            active_days: values.activeDays,
            allowance: values.allowance,
          })
        }
      />
    </FormDialog>
  );
}
