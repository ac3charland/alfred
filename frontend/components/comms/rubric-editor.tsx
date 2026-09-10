'use client';

import * as React from 'react';

import { TextareaField } from '@/components/atoms/textarea-field';
import { formatSavedAt } from '@/components/comms/settings-format';
import { useNow } from '@/lib/hooks/use-now';
import type { CommRubric } from '@/lib/types';

/**
 * The three lines a blank rubric is shown, because "write your policy" is not a prompt anyone
 * can start from. They are examples of the SHAPE — a person, a kind of message, a tier — not
 * defaults, so nothing is written until the owner writes it.
 */
const BLANK_PLACEHOLDER = [
  'Anything from my wife is ASAP.',
  'Mail with an invoice or a deadline in it goes to Today.',
  'Recruiters are never urgent, however the message reads.',
].join('\n');

/**
 * The rubric editor: the current text, open for editing, with the version it came from stated
 * underneath.
 *
 * Saving writes a NEW version rather than replacing this one, and it sweeps nothing — the line
 * under the buttons says so, because "I edited the rules, so the queue must have re-sorted" is
 * exactly the wrong thing to believe about a queue the owner has already acted on.
 *
 * The draft lives in the view, not here, so restoring an old version can load its text straight
 * into the field.
 */
export function RubricEditor({
  current,
  draft,
  onDraftChange,
  onSave,
}: {
  /** The version in force, or `undefined` before one has ever been written. */
  current: CommRubric | undefined;
  draft: string;
  onDraftChange: (next: string) => void;
  onSave: () => Promise<void>;
}) {
  const now = useNow();
  const [isPending, setIsPending] = React.useState(false);

  const trimmed = draft.trim();
  const isDirty = trimmed !== (current?.body.trim() ?? '') && trimmed !== '';

  const save = async () => {
    setIsPending(true);
    try {
      await onSave();
    } finally {
      // The field stays mounted either way: on success the draft already matches the new head,
      // and on failure the owner's text must survive the toast.
      setIsPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <TextareaField
        aria-label="Rubric"
        value={draft}
        onChange={onDraftChange}
        onSave={save}
        onCancel={() => {
          onDraftChange(current?.body ?? '');
        }}
        onEscape={() => {
          onDraftChange(current?.body ?? '');
        }}
        placeholder={BLANK_PLACEHOLDER}
        rows={12}
        isPending={isPending}
        canSave={isDirty}
        saveLabel={isPending ? 'Saving…' : 'Save new version'}
        cancelLabel="Revert"
      />
      <p className="text-xs text-muted-foreground">
        {current === undefined
          ? 'No version saved yet. The classifier follows the people list alone until there is one.'
          : `Version ${String(current.version)} · saved ${formatSavedAt(current.created_at, now)}`}
      </p>
      <p className="text-xs text-muted-foreground/60">
        Every message already judged keeps the verdict it was given. Ask for a re-run from the queue
        if you want one looked at again.
      </p>
    </div>
  );
}
