'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { DialogDescription, DialogTitle, FormDialog } from '@/components/atoms/dialog';
import { FieldLabel } from '@/components/atoms/field-label';
import { TextField } from '@/components/atoms/text-field';
import { Textarea } from '@/components/atoms/textarea';
import { useFormSubmit } from '@/lib/hooks/use-form-submit';
import type { CodeStory } from '@/lib/types';

interface NewStoryDialogProperties {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The epic name, shown so the user knows which epic the story lands in. */
  epicName: string;
  /** The epic ref (e.g. `ALF-1`), shown alongside the name when present. */
  epicRef: string;
  /**
   * Persist the new story (the board wires this to `createStory(epic.id, …)`, which mints the
   * item + sidecar at Needs Refinement). `notes` is `null` for an empty field.
   */
  onCreateStory: (title: string, notes: string | null) => Promise<CodeStory>;
}

/**
 * The form body — mounts fresh each time the dialog opens (Radix only renders Content while
 * open), so the draft resets without a setState-in-effect and the title auto-focuses via a ref.
 */
function NewStoryForm({
  onOpenChange,
  epicName,
  epicRef,
  onCreateStory,
}: Omit<NewStoryDialogProperties, 'open'>) {
  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const titleRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const { error, isPending, submit } = useFormSubmit({
    // Trim the title; map an empty notes field to null (the lib/ layer's null-aware boundary).
    onSubmit: () => onCreateStory(title.trim(), notes.trim() === '' ? null : notes.trim()),
    onSuccess: () => {
      onOpenChange(false);
    },
    errorMessage: 'Could not create the story. Try again.',
  });

  const canSubmit = title.trim() !== '' && !isPending;

  const handleSubmit = () => {
    void submit();
  };

  return (
    <>
      <DialogTitle className="text-base font-semibold text-foreground">
        New story in <span className="text-accent-teal">{epicName}</span>
      </DialogTitle>
      <DialogDescription className="mt-1 text-sm text-muted-foreground">
        It will be created in {epicRef === '' ? 'this epic' : epicRef} at{' '}
        <span className="text-foreground">Needs Refinement</span>.
      </DialogDescription>

      <div className="mt-5 flex flex-col gap-1.5">
        <FieldLabel htmlFor="new-story-title">Title</FieldLabel>
        <TextField
          id="new-story-title"
          ref={titleRef}
          value={title}
          onChange={(event_) => {
            setTitle(event_.target.value);
          }}
          onKeyDown={(event_) => {
            if (event_.key === 'Enter' && canSubmit) handleSubmit();
          }}
          placeholder="Wire up the webhook handler"
          className="px-3 py-2"
        />
      </div>

      <div className="mt-4 flex flex-col gap-1.5">
        <FieldLabel htmlFor="new-story-notes">Notes</FieldLabel>
        <Textarea
          id="new-story-notes"
          value={notes}
          onChange={(event_) => {
            setNotes(event_.target.value);
          }}
          rows={3}
          placeholder="Optional detail…"
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
          {isPending ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </>
  );
}

/**
 * The New-story sub-dialog: a required Title and optional Notes, scoped to the epic the `+`
 * was clicked on. On submit it calls `onCreateStory`, which mints a fresh item + `code_items`
 * sidecar at Needs Refinement with a server-allocated ref (the optimistic card appears on the
 * board immediately). The stateful body is a child that mounts fresh on open so the draft
 * resets — the established pattern in `gate-dialog` / `new-epic-dialog`.
 */
export function NewStoryDialog({ open, onOpenChange, ...rest }: NewStoryDialogProperties) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      maxWidth="md"
      onOpenAutoFocus={(event_) => {
        event_.preventDefault();
      }}
    >
      <NewStoryForm onOpenChange={onOpenChange} {...rest} />
    </FormDialog>
  );
}
