'use client';

import { Pencil } from 'lucide-react';
import * as React from 'react';

import { InlineEditTrigger } from '@/components/atoms/inline-edit-trigger';
import { TextareaField } from '@/components/atoms/textarea-field';

interface InlineNoteFieldProperties {
  /** The stored text. `null` and `''` are the same thing here: undescribed. */
  value: string | null;
  /** Display text when there is no value — also the trigger's accessible name. */
  emptyLabel: string;
  /** Placeholder inside the textarea. */
  placeholder: string;
  /** Accessible name for the textarea (no visible label). */
  editLabel: string;
  /**
   * Persist the new text. Receives the TRIMMED value, or `null` when the field was emptied —
   * never `''`, so "no text" has one representation for every reader. Not called at all when
   * the value is unchanged. A rejection is swallowed: the caller's store owns the rollback, and
   * the draft is re-seeded from `value` the next time the editor opens.
   */
  onSave: (next: string | null) => void | Promise<void>;
  /** Optional cap forwarded to the textarea, so the UI can't produce a body the API rejects. */
  maxLength?: number;
}

/**
 * A one-line piece of prose that edits in place: the line itself is the button, a pencil fades
 * in on hover, and clicking swaps the line for a two-row textarea with Save / Cancel. Shared by
 * the epic header's notes, the folder view's description and the board's project description —
 * one component, so the three cannot drift apart.
 *
 * The line is always rendered, empty or not: with no menu entry and no button anywhere, the
 * `emptyLabel` placeholder is how the field is discovered at all.
 */
export function InlineNoteField({
  value,
  emptyLabel,
  placeholder,
  editLabel,
  onSave,
  maxLength,
}: InlineNoteFieldProperties) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value ?? '');

  const save = async () => {
    const next = draft.trim();
    setEditing(false);
    if (next === (value ?? '')) return;
    try {
      await onSave(next === '' ? null : next);
    } catch {
      setDraft(value ?? '');
    }
  };

  const cancel = () => {
    setEditing(false);
    setDraft(value ?? '');
  };

  return editing ? (
    <TextareaField
      aria-label={editLabel}
      value={draft}
      onChange={setDraft}
      onSave={save}
      onCancel={cancel}
      onEscape={cancel}
      placeholder={placeholder}
      {...(maxLength === undefined ? {} : { maxLength })}
    />
  ) : (
    <InlineEditTrigger
      onClick={() => {
        setDraft(value ?? '');
        setEditing(true);
      }}
      className="group/notes flex min-w-0 flex-1 items-center gap-1.5 text-sm"
    >
      {value === null || value === '' ? (
        <span className="text-muted-foreground hover:text-foreground">{emptyLabel}</span>
      ) : (
        <span className="truncate whitespace-pre-wrap text-muted-foreground">{value}</span>
      )}
      <Pencil
        size={12}
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/notes:opacity-100 motion-reduce:transition-none"
      />
    </InlineEditTrigger>
  );
}
