'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { CheckboxField } from '@/components/atoms/checkbox-field';
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
   * item + sidecar). `notes` is `null` for an empty field. `requiresRefinement` is the checkbox:
   * `true` lands the story at Needs Refinement, `false` straight in Ready for Dev.
   */
  onCreateStory: (
    title: string,
    notes: string | null,
    requiresRefinement: boolean,
  ) => Promise<CodeStory>;
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
  // Checked by default: a story needs refinement unless the author says otherwise, matching the
  // column's `default true` and every other way a story enters the factory.
  const [needsRefinement, setNeedsRefinement] = React.useState(true);
  const titleRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const { error, isPending, submit } = useFormSubmit({
    // Trim the title; map an empty notes field to null (the lib/ layer's null-aware boundary).
    onSubmit: () =>
      onCreateStory(title.trim(), notes.trim() === '' ? null : notes.trim(), needsRefinement),
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
      {/* The landing state follows the checkbox, so the consequence of unchecking it is
          visible before submitting rather than only after the card appears. */}
      <DialogDescription className="mt-1 text-sm text-muted-foreground">
        It will be created in {epicRef === '' ? 'this epic' : epicRef} at{' '}
        <span className="text-foreground">
          {needsRefinement ? 'Needs Refinement' : 'Ready for Dev'}
        </span>
        .
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

      <CheckboxField
        className="mt-4"
        label="Needs refinement"
        checked={needsRefinement}
        onCheckedChange={setNeedsRefinement}
        disabled={isPending}
        hint={
          needsRefinement
            ? 'Checked — the story waits for a spec before development starts.'
            : 'Unchecked — creates the story straight in Ready for Dev, with no spec.'
        }
      />

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
 * The New-story sub-dialog: a required Title, optional Notes, and the "Needs refinement"
 * checkbox, scoped to the epic the `+` was clicked on. On submit it calls `onCreateStory`, which
 * mints a fresh item + `code_items` sidecar with a server-allocated ref (the optimistic card
 * appears on the board immediately) — at Needs Refinement, or straight in Ready for Dev when the
 * box is unchecked. The stateful body is a child that mounts fresh on open so the draft resets —
 * the established pattern in `gate-dialog` / `new-epic-dialog`.
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
