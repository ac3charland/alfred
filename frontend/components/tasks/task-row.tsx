'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Check, ChevronRight, ListCheck, Plus } from 'lucide-react';
import * as React from 'react';

import { AnimatedHeightCollapse } from '@/components/atoms/animated-height-collapse';
import { AnimatedHeightEnter } from '@/components/atoms/animated-height-enter';
import { AnimatedHeightReveal } from '@/components/atoms/animated-height-reveal';
import { Badge } from '@/components/atoms/badge';
import { Button } from '@/components/atoms/button';
import { CheckboxButton } from '@/components/atoms/checkbox-button';
import { DisclosureToggle } from '@/components/atoms/disclosure-toggle';
import { IconButton } from '@/components/atoms/icon-button';
import { InlineEditField } from '@/components/atoms/inline-edit-field';
import { PriorityChip } from '@/components/atoms/priority-chip';
import { RecurrenceChip } from '@/components/atoms/recurrence-chip';
import { GateDialog } from '@/components/code/gate-dialog';
import { CaptureBox } from '@/components/tasks/capture-box';
import { CascadeModal } from '@/components/tasks/cascade-modal';
import { DueDateChip } from '@/components/tasks/due-date-chip';
import { useTaskDrag } from '@/components/tasks/task-dnd-provider';
import { TaskDetailPanel } from '@/components/tasks/task-row/task-detail-panel';
import { TaskRowMenu } from '@/components/tasks/task-row/task-row-menu';
import { TypeBadge } from '@/components/tasks/type-badge';
import { useAnimatedRowExit } from '@/lib/hooks/use-animated-row-exit';
import { useFocusItemHighlight } from '@/lib/hooks/use-focus-item-highlight';
import { useIndentation } from '@/lib/hooks/use-indentation';
import { useInlineEdit } from '@/lib/hooks/use-inline-edit';
import { useTaskRowFlags } from '@/lib/hooks/use-task-row-flags';
import { isPriorityLevel } from '@/lib/priority';
import { parseRecurrenceRule } from '@/lib/recurrence';
import type { RecurrenceRule } from '@/lib/recurrence';
import {
  sameEditor,
  useActiveEditor,
  useActiveEditorActions,
} from '@/lib/stores/active-editor-store';
import { useExpansion, useExpansionActions } from '@/lib/stores/expansion-store';
import { useFolders } from '@/lib/stores/folders-store';
import { useInboxSelection, useInboxSelectionActions } from '@/lib/stores/inbox-selection-store';
import { useTaskActions, useTasks } from '@/lib/stores/tasks-store';
import { useToastActions } from '@/lib/stores/toast-store';
import type { ItemNode } from '@/lib/tree';
import { getAncestorTitles, getDescendantIds, isTempId } from '@/lib/tree';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';
import { cn } from '@/lib/utils';

import {
  cardChromeClass,
  checkboxIncompleteClass,
  checkboxSizeClass,
  chevronButtonClass,
  chevronIconClass,
  collapseClass,
  confirmTitleClass,
  deleteCollapseClass,
  deleteFadeClass,
  dropPlusClass,
  metaFooterClass,
  mobileTapClass,
  rowActionsClass,
  rowBaseClass,
  rowDropTargetClass,
  rowHoverClass,
  subtaskCountBadgeClass,
  subtreeClass,
  titleInputClass,
  titleTextClass,
} from './task-row.styles';

interface TaskRowProperties {
  node: ItemNode;
  depth?: number;
  /** True when this row is rendered inside the Completed view (drives the context label). */
  isCompletedView?: boolean;
  /**
   * True for a root Inbox row, which may participate in multi-edit: while select mode is on
   * the row becomes a selection checkbox. Children are never selectable, so they pass false.
   */
  selectable?: boolean;
}

/**
 * A single task row, recursively rendering its children — the composition root for the row:
 * layout + the recursive subtree, with cohesive pieces pulled into their own units. The
 * item-type flags (`useTaskRowFlags`), the indentation math (`useIndentation`), and the
 * delicate completion/deletion exits (`useAnimatedRowExit`) are hooks; the actions dropdown
 * (`TaskRowMenu`) and the auto-saving detail panel (`TaskDetailPanel`) are sub-components. The
 * subtask + completed-children reveals use the shared `AnimatedHeightCollapse`; the
 * completion-collapse stays bespoke (its 300ms + `delay-200` timing and the once-only commit
 * differ from the plain 200ms reveal).
 *
 * Features:
 * - Expand/collapse subtask tree (chevron or row-body click)
 * - Checkbox to complete (cascade modal for tasks with children)
 * - Inline title edit; "Open details" reveals the auto-saving due/repeat/priority/notes panel
 * - "Add subtask" affordance
 * - Move-to-folder dropdown + classify / gate entries
 * - Delete
 */
export function TaskRow({
  node,
  depth = 0,
  isCompletedView = false,
  selectable = false,
}: TaskRowProperties) {
  const folders = useFolders();
  const allTasks = useTasks();
  const {
    completeTask,
    uncompleteTask,
    updateTask,
    moveTask,
    deleteTask,
    classifyItem,
    removeGatedItem,
  } = useTaskActions();
  const { showToast } = useToastActions();
  const activeEditor = useActiveEditor();
  const { openEditor, closeEditor } = useActiveEditorActions();
  const prefersReducedMotion = usePrefersReducedMotion();
  const {
    subtasks: expandedSubtasks,
    completed: expandedCompleted,
    details: openDetails,
  } = useExpansion();
  const { toggleSubtasks, expandSubtasks, toggleCompleted, toggleDetails } = useExpansionActions();
  const { active: selectModeActive, selectedIds } = useInboxSelection();
  const { toggle: toggleSelection } = useInboxSelectionActions();
  // A selectable root row in active select mode is a selection checkbox, not a normal row.
  const inSelectMode = selectable && selectModeActive;
  const isSelected = selectedIds.has(node.id);
  const isExpanded = expandedSubtasks.has(node.id);
  const showCompleted = expandedCompleted.has(node.id);
  // The inline detail panel ("Open details") — independent of the subtask tree (§08): a row can
  // show its detail, its subtasks, both, or neither.
  const isDetailOpen = openDetails.has(node.id);
  const [showCascadeModal, setShowCascadeModal] = React.useState(false);

  // A row's completed state is read off the node itself (not the view), so a completed
  // child shown under an active parent renders checked + low-contrast, and clicking it
  // reactivates rather than completes.
  const isCompleted = node.status === 'completed';

  // The whole row is a drag source (the RowPointerSensor ignores presses on its buttons
  // and inline input, so only a press-and-drag elsewhere lifts it). A task at ANY depth can
  // be dragged to re-parent it; an active task can also be filed into a folder. A completed
  // or temp (unreconciled) id can't be PATCHed yet, so neither is draggable.
  const { draggedSubtreeIds } = useTaskDrag();
  // Item-type flags + drop-target validity (completion/due-date/subtask gating, classify vs
  // send-to-code, the drop highlight) all derive from the node — see useTaskRowFlags.
  const { isTask, isUnclassified, isCode, canConvert, isValidDropTarget } = useTaskRowFlags(
    node,
    isCompleted,
    draggedSubtreeIds,
  );

  // Recurrence is top-level-task-only: the parsed rule drives the row chip and the meta-panel
  // Repeat control. A subtask or non-task row never recurs (the control is hidden there).
  const recurrenceRule = React.useMemo<RecurrenceRule | null>(
    () => parseRecurrenceRule(node.recurrence),
    [node.recurrence],
  );
  const isTopLevelTask = isTask && node.parent_id === null;

  // Only "Code" earns a row badge now. The "Task" pill is gone from the parent row (ALF-67) on
  // top of already being hidden for subtasks / folder items (ALF-65), so a task never shows one;
  // "Code" keeps its badge everywhere (the rare, meaningful distinction). An unclassified row
  // has no badge either way.
  const showTypeBadge = node.item_type === 'code';

  // The completion exit: the once-only mutation fire, the navigate-away fallback, and the
  // collapse-end commit, encapsulated. Begin plays the animation (or commits immediately under
  // reduced motion); the collapse wrapper's onTransitionEnd commits.
  const {
    isExiting: isCompleting,
    begin: beginComplete,
    onCollapseEnd: handleCompleteCollapseEnd,
  } = useAnimatedRowExit(() => completeTask(node.id), prefersReducedMotion);

  // The deletion exit: the same animate-then-commit mechanism, so the row fades out and its
  // height collapses (pulling the surrounding rows up) before `deleteTask` filters it out of
  // the store. Reduced motion commits straight away (no collapse to wait on).
  const {
    isExiting: isDeleting,
    begin: beginDelete,
    onCollapseEnd: handleDeleteCollapseEnd,
  } = useAnimatedRowExit(() => deleteTask(node.id), prefersReducedMotion);

  // Either exit collapses the row to nothing; the deletion additionally fades the whole row out.
  const isExiting = isCompleting || isDeleting;

  // Only one inline input may be open across all rows, so the title-edit and add-subtask
  // flags are derived from the shared active-editor store, not held per-row. Opening
  // either here closes whatever input another row had open (see active-editor-store).
  const isEditingTitle = sameEditor(activeEditor, { itemId: node.id, kind: 'title' });
  const showAddSubtask = sameEditor(activeEditor, { itemId: node.id, kind: 'subtask' });

  // The inline add-subtask field animates in (height-grow + fade) and back out (ALF-66), so it
  // must stay mounted through its exit — otherwise the unmount kills the animation. Derive the
  // render flag from `showAddSubtask` DURING RENDER (React's recommended pattern over a
  // setState-in-effect): mount as soon as it opens, and — under reduced motion, where there is no
  // animation to wait on — unmount immediately on close. The animated path unmounts on the
  // reveal's onExited. This flag also keeps the subtask container (below) alive through the exit
  // for a childless task, where `hasChildren` can't.
  const [addSubtaskRendered, setAddSubtaskRendered] = React.useState(showAddSubtask);
  if (showAddSubtask && !addSubtaskRendered) {
    setAddSubtaskRendered(true);
  } else if (!showAddSubtask && addSubtaskRendered && prefersReducedMotion) {
    setAddSubtaskRendered(false);
  }
  // The title's draft + trim/no-op/rollback save run through the shared useInlineEdit machine;
  // the EDIT-MODE flag stays in the cross-row active-editor store (so opening one row's title
  // closes any other's — the single-open-editor invariant). We therefore drive only the draft
  // and `save()` from the hook and ignore its own isEditing/begin/cancel. The shared
  // InlineEditField (rendered while isEditingTitle is true) owns focus + Enter/Escape/outside
  // dismiss; selectAllOnEdit:false keeps the focus-without-select behavior (no selectAllOnFocus).
  const titleEdit = useInlineEdit(node.title, (next) => updateTask(node.id, { title: next }), {
    selectAllOnEdit: false,
  });
  const { draft: draftTitle, setDraft: setDraftTitle } = titleEdit;

  // The gate: "Send to Code module…" (code rows) / "Convert to Code Story…" (task or
  // unclassified rows). Both open the SAME dialog, which (since ALF-27) routes through the
  // shell-seeded CodeProvider. On confirm the item leaves task_items server-side, so we drop
  // it from the tasks store and toast the allocated ref.
  const [showGate, setShowGate] = React.useState(false);

  const canDrag = !isCompleted && !isTempId(node.id);
  const {
    setNodeRef: setDragNodeRef,
    listeners: dragListeners,
    isDragging,
  } = useDraggable({ id: node.id, disabled: !canDrag });

  // The row is also a drop target: dropping another task onto it re-parents that task here.
  // EVERY reconciled row stays a *registered* droppable — never `disabled`. A disabled
  // droppable doesn't just refuse the drop, it drops out of collision detection, so
  // releasing on it makes dnd-kit report the previously-hovered row as `over` instead.
  // That stale target silently re-parents the item onto the wrong task (the
  // "drop-on-self-after-highlighting-another vanishes the item" bug). Keeping the row
  // registered makes `over` always reflect the row actually under the pointer; whether the
  // drop is *allowed* is decided in the drag-end handler (see resolveReparent + the
  // reparentTask cycle guard).
  const { setNodeRef: setDropNodeRef, isOver } = useDroppable({ id: node.id });

  // A global-search task selection scrolls this row in and rings it briefly (static under
  // reduced motion). The ref is merged onto the row element below.
  const { ref: highlightRef, highlighted: isSearchHighlighted } =
    useFocusItemHighlight<HTMLDivElement>(node.id);

  // Merge the draggable + droppable + search-highlight refs onto the one row element (the dnd
  // refs share node.id — dnd-kit keeps draggables and droppables in separate registries, so
  // this is safe).
  const setRowRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      setDragNodeRef(element);
      setDropNodeRef(element);
      highlightRef.current = element;
    },
    [setDragNodeRef, setDropNodeRef, highlightRef],
  );

  // A valid drop target lights up and swaps its checkbox for a "+" while a task hovers it.
  const isDropTarget = isOver && isValidDropTarget;

  // A just-captured row enters with a height-expand + fade/slide-from-above (ALF-20), pushing
  // the rows below it down. The trigger is the optimistic temp id: a row carries one only
  // between its insert and the server reconcile, so exactly the freshly-added rows animate —
  // a top-level capture, a new subtask, or a recurring task's next occurrence. Rows seeded
  // from the server (a page load, a view switch) already have real ids, so they never animate.
  // On reconcile the temp id is swapped for the real one, remounting the row at its rested
  // height, which also ends the one-shot entrance.
  const isEntering = isTempId(node.id);

  const hasChildren = node.children.length > 0;
  const descendantCount = getDescendantIds(node).length;
  // The row's subtask-count badge reads `${completed}/${total}` over the DIRECT subtasks (ALF-67).
  const totalSubtasks = node.children.length;
  const completedSubtasks = node.children.filter((child) => child.status === 'completed').length;
  // The checkbox reads as "complete" both for a completed row and during the exit
  // animation, so its fill + check icon appear the instant completion begins.
  const showAsComplete = isCompleted || isCompleting;

  // Whether this row has any right-cluster metadata (type / due / repeat / priority / count).
  // On mobile these move into a wrapped footer line below the title; the wrapper is only
  // rendered when there's something to show, so a bare row doesn't reserve an empty footer line.
  const hasMeta =
    showTypeBadge ||
    (isTask && node.due_date !== null) ||
    (isTopLevelTask && recurrenceRule !== null) ||
    (isTask && isPriorityLevel(node.priority)) ||
    totalSubtasks > 0;

  // The card boundary is drawn exactly once, at a top-level (depth-0) node, enclosing the row
  // body AND its subtree — so subtasks sit inside the parent's card, never as cards of their own.
  const isCard = depth === 0;

  // In the Completed view every child is itself completed and renders inline (unchanged).
  // In an active view, completed children are split out and tucked behind a "Show completed"
  // toggle, separate from the active children shown directly above them.
  const activeChildren = isCompletedView
    ? node.children
    : node.children.filter((child) => child.status === 'active');
  const completedChildren = isCompletedView
    ? []
    : node.children.filter((child) => child.status === 'completed');

  // On the Completed screen, each root row carries a context label showing where the
  // task lives: its ancestor breadcrumb (oldest → youngest) when it's a nested subtask,
  // otherwise its folder name (or "Inbox"). Ancestors are resolved from the full task
  // list because they may be active items filtered out of the completed view.
  const isContextRow = isCompletedView && depth === 0;
  const ancestorTitles = React.useMemo(
    // Stryker disable next-line ArrayDeclaration: AT_CEILING — when isContextRow=false the false branch [] is never consumed (contextLabel is null, ancestorTitles.length is never checked); replacing with ["Stryker was here"] is behaviorally identical.
    () => (isContextRow ? getAncestorTitles(allTasks, node.parent_id) : []),
    // Stryker disable next-line ArrayDeclaration: AT_CEILING — constant dep-array literal; every element is Object.is-equal across renders so React never recomputes, identical to [].
    [isContextRow, allTasks, node.parent_id],
  );
  const contextLabel = isContextRow
    ? ancestorTitles.length > 0
      ? ancestorTitles.join(' > ')
      : node.folder_id
        ? (folders.find((f) => f.id === node.folder_id)?.name ?? 'Unknown')
        : 'Inbox'
    : null;

  const { rowLeft: indentLeft, metaLeft: metaIndentLeft } = useIndentation(depth);

  // All mutations go through the optimistic tasks store: the change shows instantly
  // and the store reconciles with the server (rolling back — which remounts this row —
  // on failure). No router.refresh(), no local dismiss/pending state.

  const handleToggleComplete = () => {
    if (hasChildren) {
      setShowCascadeModal(true);
      return;
    }
    beginComplete();
  };

  const handleCascadeConfirm = () => {
    setShowCascadeModal(false);
    beginComplete();
  };

  const handleToggleUncomplete = async () => {
    try {
      await uncompleteTask(node.id);
    } catch {
      // The store already restored the row.
    }
  };

  const handleSaveTitle = async () => {
    // Exit edit mode immediately so the optimistic title shows the instant the user submits —
    // without waiting for the server. The active-editor store owns the edit-mode flag (closed
    // here in every case); useInlineEdit.save() then trims, no-ops on empty/unchanged, awaits
    // updateTask, and rolls the draft back on throw (the store rolls the row back underneath).
    closeEditor({ itemId: node.id, kind: 'title' });
    await titleEdit.save();
  };

  // The detail panel's Due chip auto-saves on every pick. Setting a date is a bare patch;
  // clearing it also clears any recurrence rule (a rule has nowhere to anchor without a due date).
  const handleSelectDueDate = async (iso: string) => {
    if (iso === (node.due_date ?? '')) return;
    try {
      await updateTask(node.id, { due_date: iso });
    } catch {
      // The store already rolled the row back.
    }
  };

  const handleClearDueDate = async () => {
    if (node.due_date === null) return;
    try {
      await (node.recurrence === null
        ? updateTask(node.id, { due_date: null })
        : updateTask(node.id, { due_date: null, recurrence: null }));
    } catch {
      // The store already rolled the row back.
    }
  };

  const handleSaveRecurrence = async (rule: RecurrenceRule | null, anchorDate: string) => {
    try {
      // Setting a rule requires an anchor due date: when the task has none, stamp the anchor
      // (default today) in the same patch.
      await updateTask(node.id, {
        recurrence: rule,
        ...(rule !== null && node.due_date === null && { due_date: anchorDate }),
      });
    } catch {
      // The store already rolled the row back.
    }
  };

  // The detail panel's notes editor auto-saves on blur, handing back the raw text. Trim, no-op on
  // an unchanged value, and clear with null when emptied.
  const handleCommitNotes = async (value: string) => {
    const newValue = value.trim();
    if (newValue === (node.notes ?? '')) return;
    try {
      await updateTask(node.id, { notes: newValue === '' ? null : newValue });
    } catch {
      // The store already rolled the row back.
    }
  };

  const handleMoveToFolder = async (targetFolderId?: string) => {
    try {
      // undefined target = move to the Inbox (folder_id null).
      await moveTask(node.id, targetFolderId ?? null);
    } catch {
      // The store already restored the subtree.
    }
  };

  // Deletion is animated: beginDelete plays the fade + height collapse and only fires
  // deleteTask once the collapse ends (the store rolls the row back on failure). Under
  // reduced motion it commits immediately. See useAnimatedRowExit.

  const handleClassify = async (itemType: 'task' | 'code') => {
    try {
      await classifyItem(node.id, itemType);
    } catch {
      // The store already rolled the item_type back.
    }
  };

  const handleSavePriority = async (next: ItemNode['priority']) => {
    try {
      await updateTask(node.id, { priority: next });
    } catch {
      // The store already rolled the row back.
    }
  };

  // Select mode: the whole row is one toggle button — its leading control becomes a selection
  // checkbox and clicking anywhere flips membership. Inline edit, expand, the drag handle and
  // the "More actions" menu are all suppressed so the row has exactly one meaning, and the
  // subtree is hidden (only root Inbox rows are selectable). A selected row gets the teal ring.
  if (inSelectMode) {
    return (
      <li className="group/row list-none">
        <Button
          variant="ghost"
          onClick={() => {
            toggleSelection(node.id);
          }}
          aria-pressed={isSelected}
          aria-label={`${isSelected ? 'Deselect' : 'Select'} "${node.title}"`}
          className={cn(
            // Reset the Button atom's centred, fixed-height chrome into a full-width row.
            'h-auto w-full justify-start gap-2 px-2 py-2 text-left font-normal',
            isSelected && 'bg-accent-teal/5 ring-2 ring-inset ring-accent-teal',
          )}
          style={{ paddingLeft: indentLeft }}
        >
          <span
            aria-hidden="true"
            className={cn(
              checkboxSizeClass,
              'flex items-center justify-center rounded border',
              isSelected ? 'border-accent-teal bg-accent-teal' : checkboxIncompleteClass,
            )}
          >
            {isSelected && <Check size={10} className="text-background" strokeWidth={3} />}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{node.title}</span>
          {showTypeBadge && <TypeBadge itemType={node.item_type} />}
        </Button>
      </li>
    );
  }

  return (
    <li className="group/row list-none">
      {/* A freshly-captured row grows in from 0 height and slides down from above, pushing
          the rows below it down (ALF-20). For an existing row this wrapper is a no-op
          passthrough. */}
      <AnimatedHeightEnter entering={isEntering}>
        {/* Both exits (complete + delete) collapse the row (and its expanded subtree): a
          transition on the grid row track from 1fr to 0fr shrinks the height to nothing,
          pulling the rows below up. `ease-out` (a transition, not a keyframe) makes the
          collapse start briskly, then settle. Completion uses `collapseClass` (delay-200 holds
          the collapse back until the 200ms checkbox pop finishes); deletion uses
          `deleteCollapseClass` (no delay — nothing to wait on) and fades the whole row out via
          `deleteFadeClass` on the clipped inner child. The inner child is clipped so it can
          shrink past its content. Kept bespoke (not AnimatedHeightCollapse) for the 300ms
          timing and the commit-on-end contract. Both exits' onTransitionEnd handlers run; each
          only acts on its own `grid-template-rows` transition while its flag is set. */}
        <div
          className={cn(
            isDeleting ? deleteCollapseClass : collapseClass,
            isExiting ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
          )}
          data-testid="task-collapse"
          onTransitionEnd={(event) => {
            handleCompleteCollapseEnd(event);
            handleDeleteCollapseEnd(event);
          }}
        >
          <div
            className={cn(
              // At depth 0 this wrapper — which encloses both the row body and the subtree
              // <ul> — carries the mobile card chrome, so the whole subtree lives inside one
              // card (md+ dissolves it back into the shared divide-y list).
              isCard && cardChromeClass,
              isExiting && 'overflow-hidden',
              isDeleting && cn(deleteFadeClass, 'opacity-0'),
            )}
          >
            {/* Main row — the whole surface is the drag handle (RowPointerSensor lets the
              buttons/input below stay clickable). Dropping another task here re-parents it. */}
            <div
              ref={setRowRef}
              {...(dragListeners ?? {})}
              data-drop-over={isDropTarget ? 'true' : undefined}
              className={cn(
                rowBaseClass,
                // A valid drop target lights up (teal); otherwise the usual hover wash.
                isDropTarget ? rowDropTargetClass : rowHoverClass,
                // Dim the in-place row while its DragOverlay clone is being dragged.
                isDragging && 'opacity-40',
                // A search-selected row rings briefly, then the ring fades out.
                'transition-shadow duration-700 motion-reduce:transition-none',
                isSearchHighlighted && 'ring-2 ring-inset ring-accent-teal',
              )}
              style={{ paddingLeft: indentLeft }}
            >
              {/* Expand/collapse toggle */}
              <IconButton
                size="sm"
                onClick={() => {
                  toggleSubtasks(node.id);
                }}
                aria-label={isExpanded ? 'Collapse subtasks' : 'Expand subtasks'}
                aria-expanded={isExpanded}
                className={cn(
                  chevronButtonClass,
                  mobileTapClass,
                  !hasChildren && 'invisible pointer-events-none',
                )}
              >
                <ChevronRight
                  size={14}
                  className={cn(
                    chevronIconClass,
                    // Enlarged glyph on mobile (16px), today's 14px at md+.
                    'h-4 w-4 md:h-3.5 md:w-3.5',
                    isExpanded && 'rotate-90',
                  )}
                />
              </IconButton>

              {/* Completion is `task`-only: an unclassified/code row shows no checkbox,
                just a spacer so its title stays aligned with task rows. */}
              {isTask ? (
                isDropTarget ? (
                  <div aria-hidden="true" className={dropPlusClass}>
                    <Plus size={10} strokeWidth={3} />
                  </div>
                ) : (
                  <CheckboxButton
                    onClick={() => {
                      if (isCompleting) return;
                      if (isCompleted) {
                        void handleToggleUncomplete();
                      } else {
                        handleToggleComplete();
                      }
                    }}
                    aria-label={
                      isCompleted ? `Mark "${node.title}" active` : `Mark "${node.title}" complete`
                    }
                    className={cn(
                      checkboxSizeClass,
                      mobileTapClass,
                      showAsComplete
                        ? 'bg-accent-teal border-accent-teal'
                        : checkboxIncompleteClass,
                      // The snappy press: a quick scale overshoot the instant completion begins.
                      isCompleting && 'animate-check-pop motion-reduce:animate-none',
                    )}
                  >
                    {showAsComplete && (
                      <Check
                        size={10}
                        // Scale the check with the enlarged mobile box (14px), 10px at md+.
                        className="h-3.5 w-3.5 text-background md:h-2.5 md:w-2.5"
                        strokeWidth={3}
                      />
                    )}
                  </CheckboxButton>
                ) /* Completion checkbox — or, while a task is dropped onto this row, a "+" that
                signals it will become a child here (replaces the checkbox; no animation). */
              ) : (
                <div className={cn(checkboxSizeClass, 'shrink-0')} aria-hidden="true" />
              )}

              {/* Title */}
              {isEditingTitle ? (
                <InlineEditField
                  value={draftTitle}
                  onChange={setDraftTitle}
                  onSubmit={() => {
                    void handleSaveTitle();
                  }}
                  onCancel={() => {
                    setDraftTitle(node.title);
                    closeEditor({ itemId: node.id, kind: 'title' });
                  }}
                  confirmLabel="Confirm title"
                  inputLabel="Edit title"
                  requireValue={false}
                  dissolveIntoGrid
                  inputClassName={titleInputClass}
                  confirmClassName={confirmTitleClass}
                />
              ) : (
                <div
                  // select-none: the whole row is a drag surface, so the title text is no
                  // longer highlightable. Double-click still opens the inline title editor.
                  className="flex-1 flex flex-col min-w-0 select-none"
                  onDoubleClick={() => {
                    // Reset the draft so a previously-abandoned edit doesn't resurface.
                    setDraftTitle(node.title);
                    openEditor({ itemId: node.id, kind: 'title' });
                  }}
                >
                  <span
                    className={cn(
                      // delay-200 keeps the dismissal (fade + collapse) one beat behind the pop.
                      titleTextClass,
                      // Fade to low-contrast as the row completes; a completed row reads
                      // low-contrast; an active row full-contrast.
                      isCompleting
                        ? 'text-muted-foreground/50'
                        : isCompleted
                          ? 'text-muted-foreground'
                          : 'text-foreground',
                    )}
                  >
                    {node.title}
                  </span>
                  {/* Notes preview — a single muted line beneath the title when notes exist,
                    so the row stays scannable without opening the detail (ALF-67 §2). */}
                  {node.notes !== null && node.notes !== '' && (
                    <span className="truncate text-[12.5px] leading-snug text-[#6b7689]">
                      {node.notes}
                    </span>
                  )}
                  {contextLabel !== null && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground/50">
                      <ListCheck size={10} className="shrink-0" />
                      <span className="truncate">{contextLabel}</span>
                    </span>
                  )}
                </div>
              )}

              {/* Metadata cluster (Type → Due → Repeat → Priority → Subtask count):
                display-only here — editing happens on the detail panel's chips. On mobile the
                wrapper wraps this cluster onto a full-width footer line *below* the title (so a
                long title isn't squeezed by the badges); at md+ `display:contents` dissolves the
                wrapper and the badges sit inline to the title's right, exactly as today. Only
                rendered when there's metadata to show, so a bare row has no empty footer line. */}
              {hasMeta && (
                <div className={metaFooterClass}>
                  {/* Type badge — only "Code" earns a row badge now (the "Task" pill was removed
                    in ALF-67 / ALF-65); an unclassified row shows none. */}
                  {showTypeBadge && <TypeBadge itemType={node.item_type} />}

                  {/* Due date — `task`-only. */}
                  {isTask && node.due_date && <DueDateChip dueDate={node.due_date} />}

                  {/* Repeat — top-level recurring tasks only. */}
                  {isTopLevelTask && recurrenceRule !== null && (
                    <RecurrenceChip rule={recurrenceRule} />
                  )}

                  {/* Priority — any task (top-level or subtask) with a level set; symbol-only on
                    the row. Subtasks carry their own priority (set on the detail panel, ranked in
                    the Folder view), so their level must show on the row too (ALF-63). */}
                  {isTask && isPriorityLevel(node.priority) && (
                    <PriorityChip priority={node.priority} symbolOnly />
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
                </div>
              )}

              {/* Row actions — always visible on mobile, hover-revealed on md+ (ALF-88). */}
              <div className={rowActionsClass}>
                {/* Add subtask — `task`-only: subtasks nest only under tasks, so an
                  unclassified/code row exposes no add-subtask affordance. */}
                {isTask && (
                  <IconButton
                    size="md"
                    tone="accent"
                    onMouseDown={(e) => {
                      // Prevent the browser from moving focus away from the CaptureBox input
                      // when the toggle is pressed while the box is open. Without this, `blur`
                      // fires and `onDismiss` closes the box before the `click` handler runs,
                      // making the handler see showAddSubtask=false and re-open instead of close.
                      if (showAddSubtask) e.preventDefault();
                    }}
                    onClick={() => {
                      if (showAddSubtask) {
                        closeEditor({ itemId: node.id, kind: 'subtask' });
                      } else {
                        openEditor({ itemId: node.id, kind: 'subtask' });
                        // The inline add-subtask form renders inside the subtree, so expand it.
                        expandSubtasks(node.id);
                      }
                    }}
                    aria-label="Add subtask"
                  >
                    {/* Enlarged glyph on mobile (16px) for a comfier touch target; today's 12px
                      at md+. */}
                    <Plus size={12} className="h-4 w-4 md:h-3 md:w-3" />
                  </IconButton>
                )}

                {/* More actions dropdown — all visibility conditionals live inside it. */}
                <TaskRowMenu
                  isUnclassified={isUnclassified}
                  isCode={isCode}
                  canConvert={canConvert}
                  folders={folders}
                  onOpenDetails={() => {
                    toggleDetails(node.id);
                  }}
                  onClassify={(itemType) => {
                    void handleClassify(itemType);
                  }}
                  onOpenGate={() => {
                    setShowGate(true);
                  }}
                  onMoveToFolder={(targetFolderId) => {
                    void handleMoveToFolder(targetFolderId);
                  }}
                  onDelete={beginDelete}
                />
              </div>
            </div>

            {/* Inline detail panel ("Open details") — the auto-saving chip row + notes. Sits
              between the row and the subtask list (row → detail → subtasks). */}
            {isDetailOpen && (
              <TaskDetailPanel
                node={node}
                metaLeft={metaIndentLeft}
                isTask={isTask}
                showRepeat={isTopLevelTask}
                recurrence={recurrenceRule}
                onChangeRecurrence={(rule, anchorDate) => {
                  void handleSaveRecurrence(rule, anchorDate);
                }}
                onSelectDueDate={(iso) => {
                  void handleSelectDueDate(iso);
                }}
                onClearDueDate={() => {
                  void handleClearDueDate();
                }}
                onChangePriority={(next) => {
                  void handleSavePriority(next);
                }}
                onCommitNotes={(value) => {
                  void handleCommitNotes(value);
                }}
              />
            )}

            {/* Children — grid-rows trick gives a CSS-only height transition from 0fr→1fr.
              The container stays mounted while the add-subtask field animates out (the lifted
              `addSubtaskRendered` flag), so a childless row's field can finish its exit. */}
            {(hasChildren || addSubtaskRendered) && (
              <AnimatedHeightCollapse
                open={isExpanded}
                className={cn(
                  'transition-opacity motion-reduce:transition-none',
                  isExpanded ? 'opacity-100 duration-200 delay-75' : 'opacity-0 duration-100',
                )}
              >
                <ul aria-label="Subtasks" className={subtreeClass}>
                  {/* Add subtask inline form — grows in and fades, shrinks out on dismiss (ALF-66).
                    Kept mounted through the exit by `addSubtaskRendered`; the reveal's onExited
                    drops it once the collapse animation ends. */}
                  {addSubtaskRendered && (
                    <li
                      className="list-none"
                      style={{ paddingLeft: `${String((depth + 1) * 1.25 + 2.5)}rem` }}
                    >
                      <AnimatedHeightReveal
                        open={showAddSubtask}
                        onExited={() => {
                          setAddSubtaskRendered(false);
                        }}
                        className="py-1"
                      >
                        <CaptureBox
                          parentId={node.id}
                          folderId={node.folder_id}
                          compact
                          onDismiss={() => {
                            closeEditor({ itemId: node.id, kind: 'subtask' });
                          }}
                        />
                      </AnimatedHeightReveal>
                    </li>
                  )}

                  {/* Active child rows */}
                  {activeChildren.map((child) => (
                    <TaskRow
                      key={child.id}
                      node={child}
                      depth={depth + 1}
                      isCompletedView={isCompletedView}
                    />
                  ))}

                  {/* Completed children — revealed by the toggle with the same grid-rows
                    animation as the parent's own expand. The toggle sits at the bottom. */}
                  {completedChildren.length > 0 && (
                    <li className="list-none">
                      <AnimatedHeightCollapse
                        open={showCompleted}
                        className={cn(
                          'transition-opacity motion-reduce:transition-none',
                          showCompleted
                            ? 'opacity-100 duration-200 delay-75'
                            : 'opacity-0 duration-100',
                        )}
                      >
                        <ul aria-label="Completed subtasks">
                          {completedChildren.map((child) => (
                            <TaskRow
                              key={child.id}
                              node={child}
                              depth={depth + 1}
                              isCompletedView={isCompletedView}
                            />
                          ))}
                        </ul>
                      </AnimatedHeightCollapse>

                      <div
                        className="py-1"
                        style={{ paddingLeft: `${String((depth + 1) * 1.25 + 0.75)}rem` }}
                      >
                        <DisclosureToggle
                          variant="inline"
                          onClick={() => {
                            toggleCompleted(node.id);
                          }}
                          aria-expanded={showCompleted}
                        >
                          {showCompleted
                            ? 'Hide completed'
                            : `Show completed (${String(completedChildren.length)})`}
                        </DisclosureToggle>
                      </div>
                    </li>
                  )}
                </ul>
              </AnimatedHeightCollapse>
            )}
          </div>
        </div>
      </AnimatedHeightEnter>

      {/* Cascade completion modal */}
      <CascadeModal
        open={showCascadeModal}
        onOpenChange={setShowCascadeModal}
        taskTitle={node.title}
        subtaskCount={descendantCount}
        onConfirm={() => {
          handleCascadeConfirm();
        }}
        isPending={false}
      />

      {/* The gate — Send to Code module / Convert to Code Story. On success the item
          has left task_items, so drop it from the store and toast its new ref. */}
      <GateDialog
        open={showGate}
        onOpenChange={setShowGate}
        items={[
          {
            id: node.id,
            title: node.title,
            notes: node.notes,
            source_url: node.source_url,
          },
        ]}
        onComplete={(stories) => {
          removeGatedItem(node.id);
          // The reconciled story always carries its allocated ref + project_id by now (`?? ''`
          // only satisfies the all-nullable view row type). Deep-link the toast to the new
          // story's board modal so a click jumps straight there (see board.tsx's `?story=` seam).
          const story = stories[0];
          const ref = story?.ref ?? '';
          const href =
            story?.project_id != null && ref !== ''
              ? `/code/${story.project_id}?story=${ref}`
              : undefined;
          showToast(`Created ${ref}`, 'default', href);
        }}
      />
    </li>
  );
}
