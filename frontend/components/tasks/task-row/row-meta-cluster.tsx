'use client';

import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { RecurrenceChip } from '@/components/atoms/recurrence-chip';
import { DispatchReadyMark } from '@/components/tasks/dispatch-ready-mark';
import { DueDateChip } from '@/components/tasks/due-date-chip';
import { PriorityChip } from '@/components/tasks/priority-chip';
import { ProjectKeyChip } from '@/components/tasks/project-key-chip';
import { metaFooterClass, subtaskCountBadgeClass } from '@/components/tasks/task-row.styles';
import { FolderChip, IntendedEpicChip } from '@/components/tasks/task-row/detail-chips';
import { TypeBadge } from '@/components/tasks/type-badge';
import type { TaskPriority } from '@/lib/priority';
import { isPriorityLevel } from '@/lib/priority';
import type { RecurrenceRule } from '@/lib/recurrence';
import { isDispatched } from '@/lib/tasks/residency';
import type { ItemNode } from '@/lib/tree';
import { countOverdueDescendants } from '@/lib/tree';

/**
 * The interactive wrappers of the metadata cluster — present on the ordinary row (every label
 * chip is clickable in place, opening the same picker its detail-panel twin does), absent in
 * select mode, where the whole row is one `<button>` and a nested control would be invalid HTML
 * with undefined activation behaviour. There, every chip renders as a non-interactive span and a
 * click anywhere on the row means "toggle selection", nothing else.
 */
export interface RowMetaEditing {
  onSelectDueDate: (iso: string) => void;
  onClearDueDate: () => void;
  onChangePriority: (next: TaskPriority | null) => void;
  onSetFolder: (folderId: string | null) => void;
  onSetProject: (projectId: string | null) => void;
  onSetEpic: (epicId: string | null) => void;
}

interface RowMetaClusterProperties {
  node: ItemNode;
  /** A `task` row (due date / priority are task-only). */
  isTask: boolean;
  /** A top-level task (the Repeat chip is top-level-only). */
  isTopLevelTask: boolean;
  /** The parsed recurrence rule, or null when the task doesn't repeat. */
  recurrenceRule: RecurrenceRule | null;
  /**
   * Whether the type badge shows (Code everywhere; Task only on an undispatched Inbox root;
   * Unclassified only in select mode) — the gate is the row's, see TaskRow's `showTypeBadge`.
   */
  showTypeBadge: boolean;
  /**
   * True inside the Completed view, where the folder chip stays off: the row's context label
   * already names where the item lives, and an undispatched leftover label would shout over it.
   */
  isCompletedView?: boolean;
  /**
   * Whether `dispatchReadiness` calls this row ready (ALF-178) — the gate (Inbox row, undispatched,
   * outside Completed) is the caller's, same as `showTypeBadge`.
   */
  showReadyPip: boolean;
  /** Interactive handlers — omit to render every chip as an inert span (select mode). */
  editing?: RowMetaEditing | undefined;
}

/**
 * The row's metadata cluster (Type → Folder → Project → Epic → Due → Repeat → Priority →
 * Subtask count → Overdue count), shared by the ordinary row and the select-mode branch so the
 * two can't drift. A chip appears only when its field is set — filling an empty field is the
 * detail panel's job — and every label chip that renders is editable where it renders (when
 * `editing` is present), through the same store action the panel uses. Renders nothing at all
 * when the row carries no metadata, so a bare row doesn't reserve an empty footer line.
 */
export function RowMetaCluster({
  node,
  isTask,
  isTopLevelTask,
  recurrenceRule,
  showTypeBadge,
  isCompletedView = false,
  showReadyPip,
  editing,
}: RowMetaClusterProperties) {
  // The folder chip shows the folder an item is LABELLED with while it is still in the Inbox —
  // both are inputs to Dispatch readiness, and a label you cannot see is a label you cannot
  // check. Once dispatched, the row lives in that folder's view, where a chip would restate it;
  // in the Completed view the context label owns "where this lives", so the chip stays off too.
  const showFolderChip = !isCompletedView && !isDispatched(node) && node.folder_id !== null;
  const showProjectChip = node.intended_project_id !== null;
  const showEpicChip = node.intended_epic_id !== null;
  const showDueChip = isTask && node.due_date !== null;
  const showRepeatChip = isTopLevelTask && recurrenceRule !== null;
  const showPriorityChip = isTask && isPriorityLevel(node.priority);
  const totalSubtasks = node.children.length;
  const completedSubtasks = node.children.filter((child) => child.status === 'completed').length;
  // The overdue tally spans the WHOLE subtree, unlike the `completed/total` count beside it: a
  // late subtask buried three levels down still has to surface on the row you can see.
  const overdueSubtasks = countOverdueDescendants(node);

  const hasMeta =
    showTypeBadge ||
    showFolderChip ||
    showProjectChip ||
    showEpicChip ||
    showDueChip ||
    showRepeatChip ||
    showPriorityChip ||
    // No `overdueSubtasks` term needed: an overdue descendant implies at least one child, so
    // `totalSubtasks > 0` already covers every row that can carry the overdue tally.
    totalSubtasks > 0 ||
    // Provably redundant (a ready row always carries a chip already — see the pip's own mount
    // below), included anyway so the component is correct on its own terms, not only by an
    // argument made in the caller.
    showReadyPip;
  if (!hasMeta) return null;

  return (
    <div className={metaFooterClass}>
      {showTypeBadge && <TypeBadge itemType={node.item_type} />}

      {/* Folder — where the row would land (or already lives). Undispatched rows only. */}
      {showFolderChip && (
        <FolderChip
          folderId={node.folder_id}
          allowClear={!isDispatched(node)}
          size="compact"
          inert={editing === undefined}
          onSelect={(folderId) => editing?.onSetFolder(folderId)}
        />
      )}

      {/* Assigned-project chip — a code item's pre-factory project, by key. */}
      {showProjectChip && node.intended_project_id !== null && (
        <ProjectKeyChip
          projectId={node.intended_project_id}
          {...(editing !== undefined && { onSelect: editing.onSetProject })}
        />
      )}

      {/* Epic chip — the pre-factory epic's ref, styled as the project chip's sibling. */}
      {showEpicChip && (
        <IntendedEpicChip
          projectId={node.intended_project_id}
          epicId={node.intended_epic_id}
          size="compact"
          inert={editing === undefined}
          onSelect={(epicId) => editing?.onSetEpic(epicId)}
        />
      )}

      {/* Due date — `task`-only. Clickable: opens the calendar to change or clear the date
          (same chip + auto-save as the detail panel). */}
      {showDueChip && node.due_date !== null && (
        <DueDateChip
          dueDate={node.due_date}
          inert={editing === undefined}
          {...(editing !== undefined && {
            onSelect: editing.onSelectDueDate,
            onClear: editing.onClearDueDate,
          })}
        />
      )}

      {/* Repeat — top-level recurring tasks only. Read-only on the row (edited in the panel). */}
      {isTopLevelTask && recurrenceRule !== null && (
        <RecurrenceChip rule={recurrenceRule} inert={editing === undefined} />
      )}

      {/* Priority — any task with a level set; symbol-only on the row. Clickable: opens the
          picker to change or clear the level (same chip + auto-save as the detail panel). */}
      {showPriorityChip && (
        <PriorityChip
          priority={node.priority}
          symbolOnly
          inert={editing === undefined}
          {...(editing !== undefined && { onChange: editing.onChangePriority })}
        />
      )}

      {/* Subtask count — completed / total of the direct subtasks (e.g. 2/5). */}
      {totalSubtasks > 0 && (
        <Badge
          variant="plain"
          aria-label={`${String(completedSubtasks)} of ${String(totalSubtasks)} subtasks complete`}
          className={subtaskCountBadgeClass}
        >
          {completedSubtasks}/{totalSubtasks}
        </Badge>
      )}

      {/* Overdue subtasks — how much of the subtree is already late. A bare red count, like the
          folder overdue tally: the number carries the signal and the `aria-label` names its
          meaning. Sits last so it reads as a rider on the subtask count. */}
      {overdueSubtasks > 0 && (
        <Badge
          variant="overdue"
          className="font-medium"
          aria-label={`${String(overdueSubtasks)} overdue ${overdueSubtasks === 1 ? 'subtask' : 'subtasks'}`}
        >
          {overdueSubtasks}
        </Badge>
      )}

      {/* Dispatch-ready cue (ALF-178) — LAST: the verdict reads as the closing word of the
          evidence above it, and "last" is what puts it at a fixed offset from the row's right
          edge on every row, the alignment that makes it glanceable down a list. */}
      {showReadyPip && <DispatchReadyMark />}
    </div>
  );
}
