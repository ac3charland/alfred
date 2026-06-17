'use client';

import { Dialog } from 'radix-ui';
import * as React from 'react';

import { FieldLabel } from '@/components/atoms/field-label';
import { TextField } from '@/components/atoms/text-field';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface NewStoryDialogProperties {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The epic name shown in the dialog title so the user knows where the story lands. */
  epicName: string;
  /** Persist the story (calls `create_code_story` via the store action). */
  onCreateStory: (title: string, notes: string | null) => Promise<void>;
}

/**
 * The form body — mounts fresh each time the dialog opens (Radix only renders Content
 * while open), so the fields reset without a setState-in-effect and the title autofocuses.
 */
function NewStoryForm({
  onOpenChange,
  epicName,
  onCreateStory,
}: Omit<NewStoryDialogProperties, 'open'>) {
  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const titleRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const canSubmit = title.trim() !== '' && !isSaving;

  const handleSubmit = async () => {
    setError(null);
    setIsSaving(true);
    try {
      await onCreateStory(title.trim(), notes.trim() === '' ? null : notes.trim());
      onOpenChange(false);
    } catch {
      setError('Could not create the story. Try again.');
      setIsSaving(false);
    }
  };

  return (
    <>
      <Dialog.Title className="text-base font-semibold text-foreground">
        New story in {epicName}
      </Dialog.Title>
      <Dialog.Description className="mt-1 text-sm text-muted-foreground">
        Will be created at Needs Refinement.
      </Dialog.Description>

      <div className="mt-5 flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="new-story-title">Title</FieldLabel>
          <TextField
            id="new-story-title"
            ref={titleRef}
            value={title}
            onChange={(event_) => {
              setTitle(event_.target.value);
            }}
            onKeyDown={(event_) => {
              if (event_.key === 'Enter' && canSubmit) void handleSubmit();
            }}
            placeholder="Wire the webhook"
            className="px-3 py-2"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor="new-story-notes">Notes</FieldLabel>
          <textarea
            id="new-story-notes"
            value={notes}
            onChange={(event_) => {
              setNotes(event_.target.value);
            }}
            rows={3}
            placeholder="Optional context…"
            className="w-full resize-none rounded-sm border border-border bg-input px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal"
          />
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
          {isSaving ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </>
  );
}

/**
 * Modal for creating a new code story directly in an epic from the board.
 * The `+` button on each epic header opens this; project and epic are already known
 * from context, so the user only supplies the title (required) and optional notes.
 */
export function NewStoryDialog({ open, onOpenChange, ...rest }: NewStoryDialogProperties) {
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
          <NewStoryForm onOpenChange={onOpenChange} {...rest} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
