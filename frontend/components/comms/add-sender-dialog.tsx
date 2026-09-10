'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { DialogDescription, DialogTitle, FormDialog } from '@/components/atoms/dialog';
import { FieldLabel } from '@/components/atoms/field-label';
import { OptionButton } from '@/components/atoms/option-button';
import { TextField } from '@/components/atoms/text-field';
import { createCommPerson } from '@/lib/api-client';
import type { CreatePersonInput } from '@/lib/api-client';
import { useFormSubmit } from '@/lib/hooks/use-form-submit';
import { useCommsSettingsActions } from '@/lib/stores/comms-settings-store';
import type { CommMessage } from '@/lib/types';

/**
 * Add the sender of a mistiered message to the roster, without leaving the queue.
 *
 * This exists because a structured roster does not stop it drifting — it drifts SILENTLY, which
 * is worse than prose, and nothing announces the gap. A new colleague, a changed number, a
 * second address: each is a message that will be judged as if it came from a stranger, and the
 * only moment the owner ever notices is the moment they are looking at one of those messages.
 * So the fix has to be reachable from that message, and not only from a settings page.
 */

type Priority = NonNullable<CreatePersonInput['priority']>;

const PRIORITIES: Priority[] = ['high', 'normal', 'low'];

const PRIORITY_HINT: Record<Priority, string> = {
  high: 'Their messages can’t wait.',
  normal: 'Judged on the message, not the sender.',
  low: 'Rarely urgent.',
};

interface AddSenderDialogProperties {
  /** The message whose sender is being added; `undefined` keeps the dialog closed. */
  message: CommMessage | undefined;
  onOpenChange: (open: boolean) => void;
}

/**
 * The form body, split out so it MOUNTS FRESH each time the dialog opens (Radix only renders
 * Content while open) — which resets the fields without a setState-in-effect and lets the name
 * field take focus on mount.
 */
function AddSenderForm({
  message,
  onOpenChange,
}: {
  message: CommMessage;
  onOpenChange: (open: boolean) => void;
}) {
  const { upsertPeopleLocally } = useCommsSettingsActions();
  const [name, setName] = React.useState(message.sender_name ?? '');
  const [priority, setPriority] = React.useState<Priority>('high');
  const nameRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const handle = message.sender_handle;
  // An address is an address and everything else is a number — the same split the resolver
  // makes when it normalises a handle.
  const kind = handle.includes('@') ? 'email' : 'phone';

  const { error, isPending, submit } = useFormSubmit({
    onSubmit: () =>
      createCommPerson({
        name: name.trim(),
        priority,
        handles: [{ handle, kind }],
      }),
    onSuccess: (person) => {
      // The roster lives in the settings store, so the queue's own priority chips light up
      // without a reload — the point of adding them was to change how this row reads.
      upsertPeopleLocally([person]);
      onOpenChange(false);
    },
    errorMessage: 'Could not add that person — is this handle already on the roster?',
  });

  const canSubmit = name.trim() !== '' && !isPending;

  return (
    <>
      <DialogTitle className="text-base font-semibold text-foreground">
        Add sender to people
      </DialogTitle>
      <DialogDescription className="mt-1 text-sm text-muted-foreground">
        The classifier weighs who a message is from. Adding {handle} here is what makes the next one
        land differently.
      </DialogDescription>

      <div className="mt-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="add-sender-name">Name</FieldLabel>
          <TextField
            id="add-sender-name"
            ref={nameRef}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder="Dana Whitfield"
            className="px-3 py-2"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="add-sender-priority">Priority</FieldLabel>
          <div id="add-sender-priority" className="flex flex-col gap-1">
            {PRIORITIES.map((option) => (
              <OptionButton
                key={option}
                selected={option === priority}
                aria-pressed={option === priority}
                onClick={() => {
                  setPriority(option);
                }}
              >
                <span className="capitalize">{option}</span>
                <span className="text-xs text-muted-foreground">{PRIORITY_HINT[option]}</span>
              </OptionButton>
            ))}
          </div>
        </div>

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
          disabled={!canSubmit}
          onClick={() => {
            if (canSubmit) void submit();
          }}
        >
          {isPending ? 'Adding…' : 'Add to people'}
        </Button>
      </div>
    </>
  );
}

export function AddSenderDialog({ message, onOpenChange }: AddSenderDialogProperties) {
  return (
    <FormDialog
      open={message !== undefined}
      onOpenChange={onOpenChange}
      maxWidth="md"
      onOpenAutoFocus={(event) => {
        // Focus the name field, not the close button Radix would otherwise pick.
        event.preventDefault();
      }}
    >
      {message !== undefined && <AddSenderForm message={message} onOpenChange={onOpenChange} />}
    </FormDialog>
  );
}
