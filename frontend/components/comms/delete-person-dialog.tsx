'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { DialogDescription, DialogTitle, FormDialog } from '@/components/atoms/dialog';
import { useFormSubmit } from '@/lib/hooks/use-form-submit';
import type { CommPersonWithHandles } from '@/lib/types';

/**
 * The confirm before someone leaves the roster. The cost is stated in handles, because that is
 * what actually stops working: every address listed here goes with the person, and messages from
 * them stop resolving to a name the classifier can weigh.
 *
 * Focus lands on Cancel, so a stray Return never destroys the row.
 */
export function DeletePersonDialog({
  person,
  onOpenChange,
  onDelete,
}: {
  /** The person being removed; `undefined` keeps the dialog closed. */
  person: CommPersonWithHandles | undefined;
  onOpenChange: (open: boolean) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <FormDialog
      open={person !== undefined}
      onOpenChange={onOpenChange}
      onOpenAutoFocus={(event_) => {
        event_.preventDefault();
      }}
    >
      {person !== undefined && (
        <DeletePersonBody
          person={person}
          onCancel={() => {
            onOpenChange(false);
          }}
          onDelete={onDelete}
        />
      )}
    </FormDialog>
  );
}

/** Mounted fresh per person, so a pending state can never outlive the dialog it began in. */
function DeletePersonBody({
  person,
  onCancel,
  onDelete,
}: {
  person: CommPersonWithHandles;
  onCancel: () => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const { error, isPending, submit } = useFormSubmit({
    onSubmit: () => onDelete(person.id),
    onSuccess: onCancel,
    errorMessage: 'Could not remove that person. Try again.',
  });

  const count = person.comm_handles.length;

  return (
    <>
      <DialogTitle className="text-base font-semibold text-foreground">
        Remove “{person.name}” from the roster?
      </DialogTitle>
      <DialogDescription className="mt-2 text-sm text-muted-foreground">
        {count === 0
          ? 'They have no handles listed, so nothing stops resolving.'
          : `Their ${String(count)} ${
              count === 1 ? 'handle goes' : 'handles go'
            } too — messages from ${count === 1 ? 'it' : 'them'} stop resolving to a name.`}{' '}
        Past verdicts keep the judgment they were given.
      </DialogDescription>

      {error !== null && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-6 flex justify-end gap-3">
        <Button variant="outline" size="sm" ref={cancelRef} onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button variant="destructive" size="sm" disabled={isPending} onClick={() => void submit()}>
          {isPending ? 'Removing…' : 'Remove person'}
        </Button>
      </div>
    </>
  );
}
