'use client';

import { Pencil } from 'lucide-react';
import * as React from 'react';

import { useSheetFooterElement } from '@/components/atoms/dialog';
import { InlineEditTrigger } from '@/components/atoms/inline-edit-trigger';
import { TextareaField } from '@/components/atoms/textarea-field';
import type { DetailLayout } from '@/components/code/story-detail/layout';
import { useCodeActions } from '@/lib/stores/code-store';
import type { CodeStory } from '@/lib/types';

/**
 * The inline notes editor for the story detail modal, mirroring `EpicHeaderActions` in
 * `board/epic-block.tsx`: a click-to-edit affordance with a pencil icon, a `TextareaField` in
 * edit mode, and optimistic save via `updateStoryNotes`.
 *
 * On the desktop card it is as it always was: plain text with a hover pencil, and a two-row
 * editor with its Save/Cancel beneath. On the phone sheet the note sits in a tinted well with an
 * always-visible pencil (so it reads as editable, unlike the read-only spec below it), and the
 * editor opens focused (so the keyboard comes up), four rows tall, growing to fit its text, with
 * Save/Cancel drawn in the sheet's footer — below the scrolling body, never over the text.
 */
export function EditableNotes({
  story,
  layout,
  onStartEditing,
}: {
  story: CodeStory;
  layout: DetailLayout;
  /** Called when the editor opens, so the caller can close any other editor. */
  onStartEditing?: () => void;
}) {
  const { updateStoryNotes } = useCodeActions();
  const footer = useSheetFooterElement();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(story.notes ?? '');
  const isSheet = layout === 'sheet';

  const saveNotes = async () => {
    const next = draft.trim();
    setEditing(false);
    if (next === (story.notes ?? '')) return;
    // Guard on a null item_id exactly as EditableTitle does.
    if (story.item_id === null) return;
    try {
      await updateStoryNotes(story.item_id, next === '' ? null : next);
    } catch {
      setDraft(story.notes ?? '');
    }
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft(story.notes ?? '');
  };

  if (editing) {
    return (
      <TextareaField
        aria-label="Edit notes"
        value={draft}
        onChange={setDraft}
        onSave={saveNotes}
        onCancel={cancelEdit}
        onEscape={cancelEdit}
        placeholder="Story notes…"
        {...(isSheet ? { autoGrow: true, focusOnMount: true, rows: 4, actionsTarget: footer } : {})}
      />
    );
  }

  return (
    <InlineEditTrigger
      onClick={() => {
        setDraft(story.notes ?? '');
        setEditing(true);
        onStartEditing?.();
      }}
      className={
        isSheet
          ? 'group/notes flex w-full min-w-0 items-start gap-2 rounded-md bg-secondary/35 px-3 py-2.5 text-sm'
          : 'group/notes flex min-w-0 flex-1 flex-col items-start gap-1 text-sm'
      }
    >
      {story.notes === null || story.notes.trim() === '' ? (
        <span className="text-muted-foreground/70 hover:text-foreground">Add notes…</span>
      ) : (
        <span className="whitespace-pre-wrap text-foreground">{story.notes}</span>
      )}
      <Pencil
        size={isSheet ? 14 : 12}
        className={
          isSheet
            ? 'ml-auto mt-0.5 shrink-0 text-muted-foreground'
            : 'shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/notes:opacity-100 motion-reduce:transition-none'
        }
      />
    </InlineEditTrigger>
  );
}
