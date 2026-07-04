'use client';

import * as React from 'react';

import { Textarea } from '@/components/atoms/textarea';
import { DueDateChip } from '@/components/tasks/due-date-chip';
import { PriorityChip } from '@/components/tasks/priority-chip';
import { RepeatChip } from '@/components/tasks/task-row/detail-chips';
import type { TaskPriority } from '@/lib/priority';
import type { RecurrenceRule } from '@/lib/recurrence';
import type { ItemNode } from '@/lib/tree';

interface TaskDetailPanelProperties {
  node: ItemNode;
  /** Left margin (rem) so the panel clears the checkbox column, scaled by row depth. */
  metaLeft: string;
  /** Whether to show the Due / Priority chips (task rows only). */
  isTask: boolean;
  /** Whether to show the Repeat chip (top-level task rows only). */
  showRepeat: boolean;

  /** The parsed recurrence rule, or null when the task doesn't repeat. */
  recurrence: RecurrenceRule | null;
  onChangeRecurrence: (rule: RecurrenceRule | null, anchorDate: string) => void;

  /** Apply / clear the due date (auto-save). */
  onSelectDueDate: (iso: string) => void;
  onClearDueDate: () => void;

  /** Persist a priority level, or null to clear (auto-save). */
  onChangePriority: (next: TaskPriority | null) => void;

  /** Persist edited notes (auto-save on blur); the value is the raw textarea text. */
  onCommitNotes: (value: string) => void;
}

/**
 * The decluttered inline detail (the ⋯ menu's "Open details"). One horizontal chip row — Due ·
 * Repeat · Priority, each opening its own auto-saving picker popover — over a focused Notes area
 * that saves on blur. There is no Save / Cancel / Close: every edit persists immediately, and the
 * panel is dismissed by toggling "Open details" again. Replaces the old stacked, per-field meta
 * panel; the chips and notes editor own their own state, so the row just wires the optimistic
 * mutations.
 */
export function TaskDetailPanel({
  node,
  metaLeft,
  isTask,
  showRepeat,
  recurrence,
  onChangeRecurrence,
  onSelectDueDate,
  onClearDueDate,
  onChangePriority,
  onCommitNotes,
}: TaskDetailPanelProperties) {
  // Notes draft is local; it saves on blur (auto-save). When the stored value changes out from
  // under it — an optimistic patch, or a rollback after a failed save — re-seed the draft during
  // render (React's "reset state on prop change" pattern) rather than via an effect.
  const [draftNotes, setDraftNotes] = React.useState(node.notes ?? '');
  const [lastNotes, setLastNotes] = React.useState(node.notes);
  if (node.notes !== lastNotes) {
    setLastNotes(node.notes);
    setDraftNotes(node.notes ?? '');
  }

  const commitNotes = () => {
    if (draftNotes.trim() === (node.notes ?? '')) return;
    onCommitNotes(draftNotes);
  };

  const showChipRow = isTask || showRepeat;

  return (
    <div
      data-testid="task-detail-panel"
      className="rounded-[13px] border border-border bg-card px-[18px] pb-[18px] pt-4 shadow-[0_0_28px_-10px_rgba(79,209,224,0.18)]"
      style={{ marginLeft: metaLeft, marginRight: 8, marginTop: 2, marginBottom: 12 }}
    >
      {/* Chip row — Due · Repeat · Priority, each an auto-saving picker. */}
      {showChipRow && (
        <div className="flex flex-wrap items-center gap-2">
          {isTask && (
            <DueDateChip
              dueDate={node.due_date}
              size="comfortable"
              onSelect={onSelectDueDate}
              onClear={onClearDueDate}
            />
          )}
          {showRepeat && (
            <RepeatChip rule={recurrence} dueDate={node.due_date} onChange={onChangeRecurrence} />
          )}
          {isTask && (
            <PriorityChip
              priority={node.priority}
              size="comfortable"
              emptyLabel="No priority"
              onChange={onChangePriority}
            />
          )}
        </div>
      )}

      {/* Notes — eyebrow label + an always-editable, auto-saving body. */}
      <div className={showChipRow ? 'mt-4' : undefined}>
        <label
          htmlFor={`notes-${node.id}`}
          className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.15em] text-[#5A677C]"
        >
          Notes
        </label>
        <Textarea
          id={`notes-${node.id}`}
          aria-label="Notes"
          unstyled
          value={draftNotes}
          onChange={(event) => {
            setDraftNotes(event.target.value);
          }}
          onBlur={commitNotes}
          rows={3}
          placeholder="No notes yet."
          className="min-h-[60px] whitespace-pre-wrap text-[13.5px] leading-[1.65] text-[#c4cedd] placeholder:text-[#5A677C]"
        />
      </div>
    </div>
  );
}
