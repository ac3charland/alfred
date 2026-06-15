'use client';

import { Dialog } from 'radix-ui';
import * as React from 'react';

import { FieldLabel } from '@/components/atoms/field-label';
import { TextField } from '@/components/atoms/text-field';
import { Button } from '@/components/ui/button';
import type { Epic } from '@/lib/types';
import { cn } from '@/lib/utils';

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
  const [error, setError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const nameRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const canSubmit = name.trim() !== '' && !isSaving;

  const handleSubmit = async () => {
    setError(null);
    setIsSaving(true);
    try {
      const epic = await onCreateEpic(name.trim());
      onCreated(epic);
      onOpenChange(false);
    } catch {
      setError('Could not create the epic. Try again.');
      setIsSaving(false);
    }
  };

  return (
    <>
      <Dialog.Title className="text-base font-semibold text-foreground">New epic</Dialog.Title>
      <Dialog.Description className="mt-1 text-sm text-muted-foreground">
        A grouping bucket in <span className="text-foreground">{projectName}</span>.
      </Dialog.Description>

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
            if (event_.key === 'Enter' && canSubmit) void handleSubmit();
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
          disabled={isSaving}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => {
            if (canSubmit) void handleSubmit();
          }}
          disabled={!canSubmit}
          className="bg-accent-teal text-background hover:bg-accent-teal/90"
        >
          {isSaving ? 'Creating…' : 'Create epic'}
        </Button>
      </div>
    </>
  );
}

/**
 * The New-epic sub-dialog (§8.2): just an Epic name. On submit it calls `create_epic`
 * (which allocates the shared per-project ref), then hands the row back so the gate can
 * select it.
 */
export function NewEpicDialog({ open, onOpenChange, ...rest }: NewEpicDialogProperties) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[55] -translate-x-1/2 -translate-y-1/2',
            'w-full max-w-md rounded-2xl border border-border bg-surface p-6',
            'shadow-[0_0_40px_0_rgba(79,209,224,0.08)]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none',
          )}
          onOpenAutoFocus={(event_) => {
            event_.preventDefault();
          }}
        >
          <NewEpicForm onOpenChange={onOpenChange} {...rest} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
