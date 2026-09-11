'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { DialogDescription, DialogTitle, FormDialog } from '@/components/atoms/dialog';
import { OptionButton } from '@/components/atoms/option-button';
import { TextField } from '@/components/atoms/text-field';
import { type HandleDraft, HandleDraftList, makeHandleDraft } from '@/components/comms/handle-list';
import {
  PRIORITY_LABEL,
  PRIORITY_MEANING,
  PRIORITY_VALUES,
} from '@/components/comms/settings-format';
import { SETTINGS_CAPTION } from '@/components/comms/settings.styles';
import type { CreatePersonInput } from '@/lib/api-client';
import { useFormSubmit } from '@/lib/hooks/use-form-submit';
import type { CommPersonWithHandles } from '@/lib/types';

/**
 * The create dialog: a name, a priority, an optional note, and however many handles are known
 * so far.
 *
 * Priority is three rows rather than a dropdown because the three are not a scale the reader can
 * infer — `low` is not "less high", it is "never urgent whatever this says" — so each one states
 * its meaning where the choice is actually made.
 */
export function PersonDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CreatePersonInput) => Promise<CommPersonWithHandles>;
}) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      maxWidth="lg"
      onOpenAutoFocus={(event_) => {
        event_.preventDefault();
      }}
    >
      {/* Mounted fresh per open, so the draft resets without a setState-in-effect. */}
      <PersonForm
        onCancel={() => {
          onOpenChange(false);
        }}
        onCreate={onCreate}
      />
    </FormDialog>
  );
}

function PersonForm({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (input: CreatePersonInput) => Promise<CommPersonWithHandles>;
}) {
  const [name, setName] = React.useState('');
  const [priority, setPriority] = React.useState<CreatePersonInput['priority']>('high');
  const [notes, setNotes] = React.useState('');
  const [drafts, setDrafts] = React.useState<HandleDraft[]>(() => [makeHandleDraft()]);

  const trimmedName = name.trim();

  const { error, isPending, submit } = useFormSubmit({
    onSubmit: () => {
      const trimmedNotes = notes.trim();
      return onCreate({
        name: trimmedName,
        priority,
        notes: trimmedNotes === '' ? null : trimmedNotes,
        // Empty rows are the editor's own scaffolding, never a handle.
        handles: drafts
          .filter((draft) => draft.handle.trim() !== '')
          .map((draft) => ({ handle: draft.handle.trim(), kind: draft.kind })),
      });
    },
    onSuccess: onCancel,
    errorMessage: 'Could not add that person. Is one of the handles already listed?',
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event_) => {
        event_.preventDefault();
        void submit();
      }}
    >
      <div>
        <DialogTitle className="text-base font-semibold text-foreground">New person</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          The classifier reads this list before it reads the rubric.
        </DialogDescription>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className={SETTINGS_CAPTION}>Name</p>
        <TextField
          aria-label="Name"
          placeholder="Dana Whitfield"
          value={name}
          onChange={(event_) => {
            setName(event_.target.value);
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <p className={SETTINGS_CAPTION}>Priority</p>
        <div className="flex flex-col gap-1" role="radiogroup" aria-label="Priority">
          {PRIORITY_VALUES.map((value) => (
            <OptionButton
              key={value}
              role="radio"
              aria-checked={priority === value}
              selected={priority === value}
              onClick={() => {
                setPriority(value);
              }}
            >
              <span className="font-medium text-foreground">{PRIORITY_LABEL[value]}</span>
              <span className="text-xs text-muted-foreground">{PRIORITY_MEANING[value]}</span>
            </OptionButton>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className={SETTINGS_CAPTION}>Note</p>
        <TextField
          aria-label="Note"
          placeholder="Why they matter — optional"
          value={notes}
          onChange={(event_) => {
            setNotes(event_.target.value);
          }}
        />
      </div>

      <HandleDraftList drafts={drafts} onChange={setDrafts} />

      {error !== null && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="accent" size="sm" disabled={isPending || trimmedName === ''}>
          {isPending ? 'Adding…' : 'Add person'}
        </Button>
      </div>
    </form>
  );
}
