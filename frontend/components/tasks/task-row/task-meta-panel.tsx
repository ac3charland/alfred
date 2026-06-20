'use client';

import { Button } from '@/components/atoms/button';
import { CloseButton } from '@/components/atoms/close-button';
import { FieldLabel } from '@/components/atoms/field-label';
import { InlineEditTrigger } from '@/components/atoms/inline-edit-trigger';
import { TextField } from '@/components/atoms/text-field';
import { Textarea } from '@/components/atoms/textarea';
import { formatDueDate } from '@/lib/date-utils';
import type { ItemNode } from '@/lib/tree';

import { dateInputClass } from './task-meta-panel.styles';

interface TaskMetaPanelProperties {
  node: ItemNode;
  /** True for a `task` row — only tasks render the due-date field (notes stay generic). */
  isTask: boolean;
  /** Left margin (rem) so the panel clears the checkbox column, scaled by row depth. */
  metaLeft: string;

  // Due date
  isEditingDueDate: boolean;
  draftDueDate: string;
  onDraftDueDateChange: (value: string) => void;
  onSaveDueDate: () => void;
  onBeginEditDueDate: () => void;
  onCancelDueDate: () => void;

  // Notes
  isEditingNotes: boolean;
  draftNotes: string;
  onDraftNotesChange: (value: string) => void;
  onSaveNotes: () => void;
  onBeginEditNotes: () => void;
  onCancelNotes: () => void;

  /** Close the whole panel (also exits any open editor). */
  onClose: () => void;
}

/**
 * The inline meta card beneath a task row: the due-date field (task-only) and the notes
 * field, each with a view ⇆ edit toggle and the optimistic save/cancel. The save semantics
 * (trim, no-op on empty/unchanged, rollback on throw) live in the row's handlers; this is the
 * card's layout. Field ids associate the `FieldLabel`s with their inputs for accessibility.
 */
export function TaskMetaPanel({
  node,
  isTask,
  metaLeft,
  isEditingDueDate,
  draftDueDate,
  onDraftDueDateChange,
  onSaveDueDate,
  onBeginEditDueDate,
  onCancelDueDate,
  isEditingNotes,
  draftNotes,
  onDraftNotesChange,
  onSaveNotes,
  onBeginEditNotes,
  onCancelNotes,
  onClose,
}: TaskMetaPanelProperties) {
  return (
    <div
      className="rounded-sm border border-border/50 bg-surface/50 px-3 py-3 space-y-3 mr-2"
      style={{ marginLeft: metaLeft }}
    >
      {/* Due date field — `task`-only; notes (below) stay generic. */}
      {isTask && (
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={`due-date-${node.id}`}>Due date</FieldLabel>
          {isEditingDueDate ? (
            <div className="flex items-center gap-2">
              <TextField
                id={`due-date-${node.id}`}
                type="date"
                value={draftDueDate}
                onChange={(event_) => {
                  onDraftDueDateChange(event_.target.value);
                }}
                onBlur={onSaveDueDate}
                className={dateInputClass}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={onSaveDueDate}
                className="text-accent-teal hover:bg-accent-teal/10"
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onCancelDueDate}
                className="text-muted-foreground"
              >
                Cancel
              </Button>
            </div>
          ) : (
            <InlineEditTrigger
              id={`due-date-${node.id}`}
              onClick={onBeginEditDueDate}
              className="text-sm text-foreground hover:text-accent-teal transition-colors motion-reduce:transition-none focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            >
              {node.due_date ? (
                formatDueDate(node.due_date)
              ) : (
                <span className="text-muted-foreground">Set a due date…</span>
              )}
            </InlineEditTrigger>
          )}
        </div>
      )}

      {/* Notes field */}
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={`notes-${node.id}`}>Notes</FieldLabel>
        {isEditingNotes ? (
          <div className="flex flex-col gap-2">
            <Textarea
              id={`notes-${node.id}`}
              value={draftNotes}
              onChange={(event_) => {
                onDraftNotesChange(event_.target.value);
              }}
              rows={3}
              placeholder="Add notes…"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={onSaveNotes}
                className="text-accent-teal hover:bg-accent-teal/10"
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onCancelNotes}
                className="text-muted-foreground"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <InlineEditTrigger
            id={`notes-${node.id}`}
            onClick={onBeginEditNotes}
            className="text-sm focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            {node.notes ? (
              <span className="whitespace-pre-wrap text-foreground hover:text-accent-teal transition-colors motion-reduce:transition-none">
                {node.notes}
              </span>
            ) : (
              <span className="text-muted-foreground hover:text-foreground transition-colors motion-reduce:transition-none">
                Add notes…
              </span>
            )}
          </InlineEditTrigger>
        )}
      </div>

      <CloseButton variant="text" onClick={onClose} />
    </div>
  );
}
