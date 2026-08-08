'use client';

import * as React from 'react';

import { Button } from '@/components/atoms/button';
import { Textarea } from '@/components/atoms/textarea';
import { DueDateChip } from '@/components/tasks/due-date-chip';
import { PriorityChip } from '@/components/tasks/priority-chip';
import {
  FolderChip,
  IntendedEpicChip,
  IntendedProjectChip,
  RepeatChip,
} from '@/components/tasks/task-row/detail-chips';
import type { TaskPriority } from '@/lib/priority';
import type { RecurrenceRule } from '@/lib/recurrence';
import { isDispatched } from '@/lib/tasks/residency';
import type { ItemNode } from '@/lib/tree';
import { isSaveShortcut } from '@/lib/ui/save-shortcut';

interface TaskDetailPanelProperties {
  node: ItemNode;
  /** Left margin (rem) so the panel clears the checkbox column, scaled by row depth. */
  metaLeft: string;
  /** Whether to show the Due / Priority / Folder chips (task rows only). */
  isTask: boolean;
  /** Whether to show the Project / Epic chips (code rows only). */
  isCode: boolean;
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

  /** Label the row's folder without moving it, or null to clear (auto-save). */
  onSetFolder: (folderId: string | null) => void;

  /** Set/clear the pre-factory project hint (clears the epic hint in the same PATCH). */
  onSetProject: (projectId: string | null) => void;

  /** Set/clear the pre-factory epic hint (within the already-set project). */
  onSetEpic: (epicId: string | null) => void;

  /** Persist edited notes (Save / ⌘↵ / auto-save on blur); the value is the raw textarea text. */
  onCommitNotes: (value: string) => void;
}

/**
 * The decluttered inline detail (the ⋯ menu's "Open details"). One horizontal chip row over a
 * focused Notes area with an explicit Save button and a ⌘↵ / Ctrl+↵ shortcut, backed by the same
 * auto-save on blur. The chip set is purely the fields that depend on the item's type — Due ·
 * Repeat · Priority · Folder for a task, Project · Epic for a code item, and no chip row at all
 * for an unclassified row (classify from the ⋯ menu first; the fields appear once there is a
 * type to hang them on). Deliberately NO Type chip: the type is changed only from the ⋯ menu's
 * Classify as… / the bulk bar's, never from here. There is no Cancel / Close: every edit
 * persists, and the panel is dismissed by toggling "Open details" again.
 */
export function TaskDetailPanel({
  node,
  metaLeft,
  isTask,
  isCode,
  showRepeat,
  recurrence,
  onChangeRecurrence,
  onSelectDueDate,
  onClearDueDate,
  onChangePriority,
  onSetFolder,
  onSetProject,
  onSetEpic,
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

  // Drives both the no-op guard and the Save button's disabled state, so the button greys out
  // whenever there's nothing to persist — including right after a commit re-seeds the draft.
  const isNotesDirty = draftNotes.trim() !== (node.notes ?? '');

  const commitNotes = () => {
    if (!isNotesDirty) return;
    onCommitNotes(draftNotes);
  };

  // Dismissing the panel (Escape, an outside pointer press, "Collapse all") UNMOUNTS it, and a
  // removed element never fires blur — so a save that hangs off `onBlur` alone silently drops
  // whatever was typed (ALF-126). Commit the pending draft on unmount as well. The cleanup runs
  // once, at unmount, so it reads the draft through a ref kept current by a no-dep effect;
  // committing on blur re-seeds the draft from the optimistic patch, which makes this a no-op.
  const pendingCommit = React.useRef(commitNotes);
  React.useEffect(() => {
    pendingCommit.current = commitNotes;
  });
  React.useEffect(
    () => () => {
      pendingCommit.current();
    },
    [],
  );

  const showChipRow = isTask || showRepeat || isCode;

  return (
    <div
      data-testid="task-detail-panel"
      className="rounded-[13px] border border-border bg-card px-[18px] pb-[18px] pt-4 shadow-[0_0_28px_-10px_rgba(79,209,224,0.18)]"
      style={{ marginLeft: metaLeft, marginRight: 8, marginTop: 2, marginBottom: 12 }}
    >
      {/* Chip row — the per-type field set, each an auto-saving picker. */}
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
          {/* Folder — task-only ("folders hold tasks"): labels the row without moving it. The
              "No folder" entry is offered only while the row is undispatched — a dispatched
              task must keep a folder (the DB CHECK); un-filing stays Move to… → Inbox. */}
          {isTask && (
            <FolderChip
              folderId={node.folder_id}
              allowClear={!isDispatched(node)}
              onSelect={onSetFolder}
            />
          )}
          {/* Project · Epic — the pre-factory hints. The epic list derives from the project
              (disabled with a hint until one is set), and changing the project clears the epic
              in the same write, exactly as in the gate. */}
          {isCode && (
            <IntendedProjectChip projectId={node.intended_project_id} onSelect={onSetProject} />
          )}
          {isCode && (
            <IntendedEpicChip
              projectId={node.intended_project_id}
              epicId={node.intended_epic_id}
              onSelect={onSetEpic}
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
          onKeyDown={(event) => {
            // ⌘↵ / Ctrl+↵ saves in place — the field keeps focus, so typing can continue. A bare
            // Enter stays a newline. preventDefault stops the chord inserting one.
            if (!isSaveShortcut(event)) return;
            event.preventDefault();
            commitNotes();
          }}
          onBlur={commitNotes}
          rows={3}
          placeholder="No notes yet."
          className="min-h-[60px] whitespace-pre-wrap text-[13.5px] leading-[1.65] text-[#c4cedd] placeholder:text-[#5A677C]"
        />
        <div className="mt-2 flex justify-end">
          <Button
            variant="ghostAccent"
            size="sm"
            aria-label="Save notes"
            disabled={!isNotesDirty}
            onClick={commitNotes}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
