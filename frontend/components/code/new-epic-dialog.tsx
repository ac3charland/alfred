'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { DialogDescription, DialogTitle, FormDialog } from '@/components/atoms/dialog';
import { FieldLabel } from '@/components/atoms/field-label';
import { TextField } from '@/components/atoms/text-field';
import { useFormSubmit } from '@/lib/hooks/use-form-submit';
import type { Epic } from '@/lib/types';

interface NewEpicDialogProperties {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project name, shown so the user knows where the epic lands. */
  projectName: string;
  /** Persist the epic (the `create_epic` RPC allocates the shared ref). */
  onCreateEpic: (name: string) => Promise<Epic>;
  /** Called with the created epic after success (select it). */
  onCreated: (epic: Epic) => void;
}

/**
 * The form body — mounts fresh each time the dialog opens (Radix only renders Content
 * while open), so the field resets without a setState-in-effect and auto-focuses via a ref.
 */
function NewEpicForm({
  onOpenChange,
  projectName,
  onCreateEpic,
  onCreated,
}: Omit<NewEpicDialogProperties, 'open'>) {
  const [name, setName] = React.useState('');
  const nameRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const { error, isPending, submit } = useFormSubmit({
    onSubmit: () => onCreateEpic(name.trim()),
    onSuccess: (epic) => {
      onCreated(epic);
      onOpenChange(false);
    },
    errorMessage: 'Could not create the epic. Try again.',
  });

  const canSubmit = name.trim() !== '' && !isPending;

  const handleSubmit = () => {
    void submit();
  };

  return (
    <>
      <DialogTitle className="text-base font-semibold text-foreground">New epic</DialogTitle>
      <DialogDescription className="mt-1 text-sm text-muted-foreground">
        A grouping bucket in <span className="text-foreground">{projectName}</span>.
      </DialogDescription>

      <div className="mt-5 flex flex-col gap-1.5">
        <FieldLabel htmlFor="new-epic-name">Epic name</FieldLabel>
        <TextField
          id="new-epic-name"
          ref={nameRef}
          value={name}
          onChange={(event_) => {
            setName(event_.target.value);
          }}
          onKeyDown={(event_) => {
            if (event_.key === 'Enter' && canSubmit) handleSubmit();
          }}
          placeholder="Communication Firewall"
          className="px-3 py-2"
        />
        {error !== null && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onOpenChange(false);
          }}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          variant="accent"
          onClick={() => {
            if (canSubmit) handleSubmit();
          }}
          disabled={!canSubmit}
        >
          {isPending ? 'Creating…' : 'Create epic'}
        </Button>
      </div>
    </>
  );
}

/**
 * The New-epic sub-dialog: just an Epic name. On submit it calls `create_epic`
 * (which allocates the shared per-project ref), then hands the row back so the gate can
 * select it.
 */
export function NewEpicDialog({ open, onOpenChange, ...rest }: NewEpicDialogProperties) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      maxWidth="md"
      overlayClassName="z-[55]"
      className="z-[55]"
      onOpenAutoFocus={(event_) => {
        event_.preventDefault();
      }}
    >
      <NewEpicForm onOpenChange={onOpenChange} {...rest} />
    </FormDialog>
  );
}
