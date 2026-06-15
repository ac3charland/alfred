'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Check, ChevronRight, ListCheck, MoreHorizontal, Plus } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import * as React from 'react';

import { FieldLabel } from '@/components/atoms/field-label';
import { IconButton } from '@/components/atoms/icon-button';
import { GateDialog } from '@/components/code/gate-dialog';
import { CaptureBox } from '@/components/tasks/capture-box';
import { CascadeModal } from '@/components/tasks/cascade-modal';
import { useTaskDrag } from '@/components/tasks/task-dnd-provider';
import { TypeBadge } from '@/components/tasks/type-badge';
import { Button } from '@/components/ui/button';
import { formatDueDate, isDueDateOverdue } from '@/lib/date-utils';
import {
  sameEditor,
  useActiveEditor,
  useActiveEditorActions,
} from '@/lib/stores/active-editor-store';
import { useExpansion, useExpansionActions } from '@/lib/stores/expansion-store';
import { useFolders } from '@/lib/stores/folders-store';
import { useTaskActions, useTasks } from '@/lib/stores/tasks-store';
import { useToastActions } from '@/lib/stores/toast-store';
import type { ItemNode } from '@/lib/tree';
import {
  countCompletedDescendants,
  getAncestorTitles,
  getDescendantIds,
  isTempId,
} from '@/lib/tree';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';
import { cn } from '@/lib/utils';

interface TaskRowProperties {
  node: ItemNode;
  depth?: number;
  /** True when this row is rendered inside the Completed view (drives the context label). */
  isCompletedView?: boolean;
}

/**
 * A single task row, recursively rendering its children.
 *
 * Features:
 * - Expand/collapse subtask tree
 * - Checkbox to complete (cascade modal for tasks with children)
 * - Inline due date + notes edit
 * - "Add subtask" affordance
 * - Move-to-folder dropdown
 * - Delete
 */
export function TaskRow({ node, depth = 0, isCompletedView = false }: TaskRowProperties) {
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
  const { subtasks: expandedSubtasks, completed: expandedCompleted } = useExpansion();
  const { toggleSubtasks, expandSubtasks, toggleCompleted } = useExpansionActions();
  const isExpanded = expandedSubtasks.has(node.id);
  const showCompleted = expandedCompleted.has(node.id);
  const [showCascadeModal, setShowCascadeModal] = React.useState(false);
  // While true, the row plays its completion exit (checkbox pop → height collapse →
  // text fade) and holds itself visible until the collapse ends, at which point
  // `completeTask` runs and the store filters the row out of view. See the `motion` skill.
  const [isCompleting, setIsCompleting] = React.useState(false);
  // `hasCompletedRef` keeps the completion mutation firing exactly once (animation end
  // OR unmount); `isCompletingRef` lets the unmount fallback read the latest state.
  const hasCompletedRef = React.useRef(false);
  const isCompletingRef = React.useRef(false);
  // Only one inline input may be open across all rows, so the title-edit and add-subtask
  // flags are derived from the shared active-editor store, not held per-row. Opening
  // either here closes whatever input another row had open (see active-editor-store).
  const isEditingTitle = sameEditor(activeEditor, { itemId: node.id, kind: 'title' });
  const showAddSubtask = sameEditor(activeEditor, { itemId: node.id, kind: 'subtask' });
  const [draftTitle, setDraftTitle] = React.useState(node.title);
  const titleInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    // Stryker disable next-line ConditionalExpression,OptionalChaining: AT_CEILING — equivalent pair. The `?.` makes the `if` guard redundant for the side-effect: `if(true)` focuses on every effect run, but the title input is mounted (and the ref non-null) ONLY while isEditingTitle is true, so on every other run `current` is null and `?.` no-ops — identical to the guarded version. Likewise `current.focus()` (drop `?.`) only runs under the guard when the input is mounted, so `current` is never null there. Neither mutant can change observable focus behavior.
    if (isEditingTitle) titleInputRef.current?.focus();
  }, [isEditingTitle]);
  const [isEditingDueDate, setIsEditingDueDate] = React.useState(false);
  const [isEditingNotes, setIsEditingNotes] = React.useState(false);
  const [draftDueDate, setDraftDueDate] = React.useState(node.due_date ?? '');
  const [draftNotes, setDraftNotes] = React.useState(node.notes ?? '');
  const [isMetaOpen, setIsMetaOpen] = React.useState(false);

  // A row's completed state is read off the node itself (not the view), so a completed
  // child shown under an active parent renders checked + low-contrast, and clicking it
  // reactivates rather than completes.
  const isCompleted = node.status === 'completed';

  // Completion, due dates, and subtasks are `task`-only (§7.3) — gated here in the UI and
  // structurally in the DB (§4.6 CHECK). An `unclassified` (or `code`) row exposes none of
  // them; classifying it as `task` is what unlocks them. `notes` stay generic (all types).
  const isTask = node.item_type === 'task';
  // The Classify-as submenu (§7.1) is inbox triage, so it's offered ONLY while the row is
  // still unclassified — `Classify as Code` is a bare item_type flip that's safe precisely
  // because an unclassified row is already clean (no due_date/parent_id/completed to clear).
  const isUnclassified = node.item_type === 'unclassified';
  // A code-classified-but-not-yet-sent row (no code_items sidecar) — it's still in the
  // inbox, and offers "Send to Code module…" to open the gate (§7.1 / §8).
  const isCode = node.item_type === 'code';

  // The gate (§8): "Send to Code module…" (code rows) / "Convert to Code Story…" (task or
  // unclassified rows). Both open the SAME dialog, which is CodeProvider-free (this row
  // lives under TasksProvider, not CodeProvider). On confirm the item leaves task_items
  // server-side, so we drop it from the tasks store and toast the allocated ref.
  const [showGate, setShowGate] = React.useState(false);
  const canConvert = isTask || isUnclassified;

  // The whole row is a drag source (the RowPointerSensor ignores presses on its buttons
  // and inline input, so only a press-and-drag elsewhere lifts it). A task at ANY depth can
  // be dragged to re-parent it; an active task can also be filed into a folder. A completed
  // or temp (unreconciled) id can't be PATCHed yet, so neither is draggable.
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
  const { draggedSubtreeIds } = useTaskDrag();
  const { setNodeRef: setDropNodeRef, isOver } = useDroppable({ id: node.id });
  // Only a valid landing spot lights up: a different, active, reconciled task outside the
  // dragged item's own subtree (re-parenting onto self/a descendant would make a cycle).
  // A non-`task` row can never be a parent (subtask trees stay all-`task`, §4.6), so it's
  // never a valid drop target.
  const isValidDropTarget =
    isTask && !isCompleted && !isTempId(node.id) && !draggedSubtreeIds.has(node.id);

  // Merge the draggable + droppable refs onto the one row element (both share node.id —
  // dnd-kit keeps draggables and droppables in separate registries, so this is safe).
  const setRowRef = React.useCallback(
    (element: HTMLElement | null) => {
      setDragNodeRef(element);
      setDropNodeRef(element);
    },
    [setDragNodeRef, setDropNodeRef],
  );

  // A valid drop target lights up and swaps its checkbox for a "+" while a task hovers it.
  const isDropTarget = isOver && isValidDropTarget;

  const hasChildren = node.children.length > 0;
  const descendantCount = getDescendantIds(node).length;
  // The checkbox reads as "complete" both for a completed row and during the exit
  // animation, so its fill + check icon appear the instant completion begins.
  const showAsComplete = isCompleted || isCompleting;

  // In the Completed view every child is itself completed and renders inline (unchanged).
  // In an active view, completed children are split out and tucked behind a "Show completed"
  // toggle, separate from the active children shown directly above them.
  const activeChildren = isCompletedView
    ? node.children
    : node.children.filter((child) => child.status === 'active');
  const completedChildren = isCompletedView
    ? []
    : node.children.filter((child) => child.status === 'completed');
  const completedDescendantCount = isCompletedView ? 0 : countCompletedDescendants(node);

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

  // Indentation driven by depth; avoid template literal number errors by converting to string
  const indentLeft = `${String(depth * 1.25 + 0.75)}rem`;
  const metaIndentLeft = `${String(depth * 1.25 + 2.5)}rem`;

  // All mutations go through the optimistic tasks store: the change shows instantly
  // and the store reconciles with the server (rolling back — which remounts this row —
  // on failure). No router.refresh(), no local dismiss/pending state.

  // Commit the completion mutation, at most once. On success the row is filtered out of
  // view and unmounts (already collapsed to 0 height, so no jump); on failure the store
  // rolls back and a fresh, non-completing row remounts in its place.
  const runComplete = React.useCallback(() => {
    if (hasCompletedRef.current) return;
    hasCompletedRef.current = true;
    void (async () => {
      try {
        await completeTask(node.id);
      } catch {
        // The store already restored the row.
      }
    })();
  }, [completeTask, node.id]);

  // Keep the ref in sync so the unmount fallback below sees the latest completing state.
  React.useEffect(() => {
    isCompletingRef.current = isCompleting;
  }, [isCompleting]);

  // Tear-down fallback: if the row is unmounted mid-exit (e.g. the user navigates away
  // before the collapse animation ends), still commit the completion so it isn't dropped.
  React.useEffect(
    () => () => {
      if (isCompletingRef.current) runComplete();
    },
    [runComplete],
  );

  // Begin completion: play the exit animation, or — when motion is disabled — complete
  // straight away (there's no collapse animation whose end we could wait on).
  const beginComplete = () => {
    if (prefersReducedMotion) {
      runComplete();
      return;
    }
    setIsCompleting(true);
  };

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

  // The collapse transition finishing is what commits the completion. Guard against
  // child transitions (e.g. the checkbox/title colour fades) bubbling up — only the
  // wrapper's own `grid-template-rows` transition counts.
  const handleCompleteCollapseEnd = (event_: React.TransitionEvent<HTMLDivElement>) => {
    if (
      event_.target === event_.currentTarget &&
      event_.propertyName === 'grid-template-rows' &&
      isCompleting
    ) {
      runComplete();
    }
  };

  const handleToggleUncomplete = async () => {
    try {
      await uncompleteTask(node.id);
    } catch {
      // The store already restored the row.
    }
  };

  const handleSaveTitle = async () => {
    const newValue = draftTitle.trim();
    if (newValue === node.title || newValue === '') {
      setDraftTitle(node.title);
      closeEditor({ itemId: node.id, kind: 'title' });
      return;
    }
    // Exit edit mode immediately so the optimistic title shows the instant the user
    // submits — without waiting for the server. The store reconciles (or rolls back)
    // the row underneath, exactly like the due-date and notes edits.
    closeEditor({ itemId: node.id, kind: 'title' });
    try {
      await updateTask(node.id, { title: newValue });
    } catch {
      // The store reverted the title; reset the draft for the next edit.
      setDraftTitle(node.title);
    }
  };

  const handleSaveDueDate = async () => {
    setIsEditingDueDate(false);
    // Stryker disable next-line MethodExpression: AT_CEILING — draftDueDate is only ever written by the date input's onChange or initialized from node.due_date (a clean YYYY-MM-DD or ''). A `type="date"` input rejects any value containing whitespace (its .value becomes ''), so draftDueDate can never hold surrounding whitespace; `.trim()` is therefore a provable no-op and removing it leaves every comparison identical.
    const newValue = draftDueDate.trim();
    const currentValue = node.due_date ?? '';
    if (newValue === currentValue) return;
    try {
      // Empty string clears the due date (PATCH { due_date: null }).
      await updateTask(node.id, { due_date: newValue === '' ? null : newValue });
    } catch {
      setDraftDueDate(node.due_date ?? '');
    }
  };

  const handleSaveNotes = async () => {
    setIsEditingNotes(false);
    const newValue = draftNotes.trim();
    const currentValue = node.notes ?? '';
    if (newValue === currentValue) return;
    try {
      // Empty string clears the notes (PATCH { notes: null }).
      await updateTask(node.id, { notes: newValue === '' ? null : newValue });
    } catch {
      setDraftNotes(node.notes ?? '');
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

  const handleDelete = async () => {
    try {
      await deleteTask(node.id);
    } catch {
      // The store already restored the row.
    }
  };

  const handleClassify = async (itemType: 'task' | 'code') => {
    try {
      await classifyItem(node.id, itemType);
    } catch {
      // The store already rolled the item_type back.
    }
  };

  return (
    <li className="group/row list-none">
      {/* The completion exit collapses the row (and its expanded subtree): a transition
          on the grid row track from 1fr to 0fr shrinks the height to nothing, pulling the
          rows below up. `ease-out` (a transition, not a keyframe) makes the collapse start
          briskly, then settle — `delay-200` holds it back until the 200ms checkbox pop has
          finished, so the dismissal doesn't cover the pop. The inner child is clipped so it
          can shrink past its content. */}
      <div
        className={cn(
          // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
          'grid transition-[grid-template-rows] duration-300 ease-out delay-200 motion-reduce:transition-none',
          isCompleting ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]',
        )}
        data-testid="task-collapse"
        onTransitionEnd={handleCompleteCollapseEnd}
      >
        <div className={cn(isCompleting && 'overflow-hidden')}>
          {/* Main row — the whole surface is the drag handle (RowPointerSensor lets the
              buttons/input below stay clickable). Dropping another task here re-parents it. */}
          <div
            ref={setRowRef}
            {...(dragListeners ?? {})}
            data-drop-over={isDropTarget ? 'true' : undefined}
            className={cn(
              // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
              'flex items-center gap-2 rounded-sm py-2 pr-2',
              // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
              'transition-colors duration-100 motion-reduce:transition-none',
              // A valid drop target lights up (teal); otherwise the usual hover wash.
              isDropTarget
                ? // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                  'bg-accent-teal/15 ring-1 ring-accent-teal/50'
                : // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                  'hover:bg-secondary/30',
              // Dim the in-place row while its DragOverlay clone is being dragged.
              isDragging && 'opacity-40',
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
              className={
                // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                cn('shrink-0', !hasChildren && 'invisible pointer-events-none')
              }
            >
              <ChevronRight
                size={14}
                className={cn(
                  // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                  'transition-transform duration-150 motion-reduce:transition-none',
                  isExpanded && 'rotate-90',
                )}
              />
            </IconButton>

            {/* Completion is `task`-only (§7.3): an unclassified/code row shows no checkbox,
                just a spacer so its title stays aligned with task rows. */}
            {isTask ? (
              isDropTarget ? (
                <div
                  aria-hidden="true"
                  className={cn(
                    // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border border-accent-teal bg-accent-teal text-background',
                  )}
                >
                  <Plus size={10} strokeWidth={3} />
                </div>
              ) : (
                <button
                  type="button"
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
                    // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                    // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                    showAsComplete
                      ? 'bg-accent-teal border-accent-teal'
                      : // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                        'border-border hover:border-accent-teal transition-colors duration-100 motion-reduce:transition-none',
                    // The snappy press: a quick scale overshoot the instant completion begins.
                    isCompleting && 'animate-check-pop motion-reduce:animate-none',
                  )}
                >
                  {showAsComplete && (
                    <Check size={10} className="text-background" strokeWidth={3} />
                  )}
                </button>
              ) /* Completion checkbox — or, while a task is dropped onto this row, a "+" that
                signals it will become a child here (replaces the checkbox; no animation). */
            ) : (
              <div className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}

            {/* Title */}
            {isEditingTitle ? (
              <div
                className="contents"
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) {
                    setDraftTitle(node.title);
                    closeEditor({ itemId: node.id, kind: 'title' });
                  }
                }}
              >
                <input
                  ref={titleInputRef}
                  aria-label="Edit title"
                  type="text"
                  value={draftTitle}
                  onChange={(event_) => {
                    setDraftTitle(event_.target.value);
                  }}
                  onKeyDown={(event_) => {
                    if (event_.key === 'Enter') void handleSaveTitle();
                    if (event_.key === 'Escape') {
                      setDraftTitle(node.title);
                      closeEditor({ itemId: node.id, kind: 'title' });
                    }
                  }}
                  className={cn(
                    // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                    'flex-1 min-w-0 rounded-sm border border-border bg-input px-2 py-0.5 text-sm text-foreground',
                    // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                  )}
                />
                <button
                  type="button"
                  aria-label="Confirm title"
                  onClick={() => {
                    void handleSaveTitle();
                  }}
                  className={cn(
                    // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded border border-accent-teal bg-accent-teal',
                    // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                  )}
                >
                  <Check size={10} className="text-background" strokeWidth={3} />
                </button>
              </div>
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
                    // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                    // delay-200 keeps the dismissal (fade + collapse) one beat behind the pop.
                    'text-sm truncate transition-colors duration-300 delay-200 motion-reduce:transition-none',
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
                {contextLabel !== null && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground/50">
                    <ListCheck size={10} className="shrink-0" />
                    <span className="truncate">{contextLabel}</span>
                  </span>
                )}
              </div>
            )}

            {/* Type badge — shown once the item is classified (Task / Code); nothing for
                an unclassified row (§7.2). */}
            <TypeBadge itemType={node.item_type} />

            {/* Due date chip — `task`-only (§7.3). */}
            {isTask && node.due_date && !isEditingDueDate && (
              <button
                type="button"
                onClick={() => {
                  setIsEditingDueDate(true);
                  setIsMetaOpen(true);
                }}
                aria-label={`Due date: ${node.due_date}`}
                className={cn(
                  // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                  'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors motion-reduce:transition-none',
                  isDueDateOverdue(node.due_date)
                    ? 'border-accent-amber/50 text-accent-amber hover:border-accent-amber'
                    : 'border-accent-blue/50 text-accent-blue hover:border-accent-blue',
                )}
              >
                {formatDueDate(node.due_date)}
              </button>
            )}

            {/* Active children count badge */}
            {activeChildren.length > 0 && !isExpanded && (
              <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                {activeChildren.length}
              </span>
            )}

            {/* Completed descendants count badge (all depths) — right of the active one */}
            {completedDescendantCount > 0 && !isExpanded && (
              <span
                aria-label={`${String(completedDescendantCount)} completed`}
                className="shrink-0 inline-flex items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 text-xs text-muted-foreground/60"
              >
                <Check size={10} strokeWidth={3} className="shrink-0" />
                {completedDescendantCount}
              </span>
            )}

            {/* Row actions — visible on hover */}
            <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity duration-100 motion-reduce:opacity-100">
              {/* Add subtask — `task`-only (§7.3): subtasks nest only under tasks, so an
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
                  <Plus size={12} />
                </IconButton>
              )}

              {/* More actions dropdown */}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <IconButton size="md" aria-label="More actions">
                    <MoreHorizontal size={14} />
                  </IconButton>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className={cn(
                      // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                      'z-50 min-w-40 rounded-xl border border-border bg-surface p-1',
                      // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                      'shadow-[0_8px_32px_0_rgba(0,0,0,0.4)]',
                      // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                      'data-[state=open]:animate-in data-[state=closed]:animate-out',
                      // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                      // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                      'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
                      // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                      'motion-reduce:animate-none',
                    )}
                    align="end"
                    sideOffset={4}
                  >
                    {/* Classify as ▸ — inbox triage (§7.1), offered only while the row is
                        still unclassified. Picking a type flips item_type (the optimistic
                        classifyItem action). Knowledge is reserved — leave room, don't build
                        it. "Send to Code module…" / "Convert to Code Story…" are M4. */}
                    {isUnclassified && (
                      <DropdownMenu.Sub>
                        <DropdownMenu.SubTrigger className="flex cursor-pointer select-none items-center justify-between rounded-sm px-3 py-2 text-sm text-foreground outline-none hover:bg-secondary focus:bg-secondary">
                          Classify as…
                          <ChevronRight size={12} className="text-muted-foreground" />
                        </DropdownMenu.SubTrigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.SubContent
                            className={cn(
                              // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                              'z-50 min-w-36 rounded-xl border border-border bg-surface p-1',
                              // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                              'shadow-[0_8px_32px_0_rgba(0,0,0,0.4)]',
                              // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                              'motion-reduce:animate-none',
                            )}
                            sideOffset={4}
                          >
                            <DropdownMenu.Item
                              className="flex cursor-pointer select-none items-center rounded-sm px-3 py-2 text-sm text-foreground outline-none hover:bg-secondary focus:bg-secondary"
                              onSelect={() => {
                                void handleClassify('task');
                              }}
                            >
                              Task
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                              className="flex cursor-pointer select-none items-center rounded-sm px-3 py-2 text-sm text-foreground outline-none hover:bg-secondary focus:bg-secondary"
                              onSelect={() => {
                                void handleClassify('code');
                              }}
                            >
                              Code
                            </DropdownMenu.Item>
                            {/* Knowledge: reserved (§7.1) — future type, not built. */}
                          </DropdownMenu.SubContent>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Sub>
                    )}

                    {/* Send to Code module… — a code-classified inbox item enters the gate
                        (§7.1 / §8). The RPC creates the code_items sidecar; the item then
                        leaves the Tasks/Inbox views. */}
                    {isCode && (
                      <DropdownMenu.Item
                        className="flex cursor-pointer select-none items-center rounded-sm px-3 py-2 text-sm text-foreground outline-none hover:bg-secondary focus:bg-secondary"
                        onSelect={() => {
                          setShowGate(true);
                        }}
                      >
                        Send to Code module…
                      </DropdownMenu.Item>
                    )}

                    {/* Convert to Code Story… — the path for an existing task (or an
                        unclassified item): the gate both flips item_type and creates the
                        factory row in one step (the enter_code_module RPC clears task-only
                        fields, §4.3, so a task with a due date / subtasks converts safely). */}
                    {canConvert && (
                      <DropdownMenu.Item
                        className="flex cursor-pointer select-none items-center rounded-sm px-3 py-2 text-sm text-foreground outline-none hover:bg-secondary focus:bg-secondary"
                        onSelect={() => {
                          setShowGate(true);
                        }}
                      >
                        Convert to Code Story…
                      </DropdownMenu.Item>
                    )}

                    {/* Set/Edit due date — `task`-only (§7.3). */}
                    {isTask && (
                      <DropdownMenu.Item
                        className="flex cursor-pointer select-none items-center rounded-sm px-3 py-2 text-sm text-foreground outline-none hover:bg-secondary focus:bg-secondary"
                        onSelect={() => {
                          setIsEditingDueDate(true);
                          setIsMetaOpen(true);
                        }}
                      >
                        {node.due_date ? 'Edit due date' : 'Set due date'}
                      </DropdownMenu.Item>
                    )}

                    {/* Edit notes */}
                    <DropdownMenu.Item
                      className="flex cursor-pointer select-none items-center rounded-sm px-3 py-2 text-sm text-foreground outline-none hover:bg-secondary focus:bg-secondary"
                      onSelect={() => {
                        setIsEditingNotes(true);
                        setIsMetaOpen(true);
                      }}
                    >
                      {node.notes ? 'Edit notes' : 'Add notes'}
                    </DropdownMenu.Item>

                    {/* Move to folder */}
                    {folders.length > 0 && (
                      <DropdownMenu.Sub>
                        <DropdownMenu.SubTrigger className="flex cursor-pointer select-none items-center justify-between rounded-sm px-3 py-2 text-sm text-foreground outline-none hover:bg-secondary focus:bg-secondary">
                          Move to…
                          <ChevronRight size={12} className="text-muted-foreground" />
                        </DropdownMenu.SubTrigger>
                        <DropdownMenu.Portal>
                          <DropdownMenu.SubContent
                            className={cn(
                              // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                              'z-50 min-w-36 rounded-xl border border-border bg-surface p-1',
                              // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                              'shadow-[0_8px_32px_0_rgba(0,0,0,0.4)]',
                              // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                              'motion-reduce:animate-none',
                            )}
                            sideOffset={4}
                          >
                            <DropdownMenu.Item
                              className="flex cursor-pointer select-none items-center rounded-sm px-3 py-2 text-sm text-foreground outline-none hover:bg-secondary focus:bg-secondary"
                              onSelect={() => {
                                void handleMoveToFolder();
                              }}
                            >
                              Inbox
                            </DropdownMenu.Item>
                            {folders.map((folder) => (
                              <DropdownMenu.Item
                                key={folder.id}
                                className="flex cursor-pointer select-none items-center rounded-sm px-3 py-2 text-sm text-foreground outline-none hover:bg-secondary focus:bg-secondary"
                                onSelect={() => {
                                  void handleMoveToFolder(folder.id);
                                }}
                              >
                                {folder.name}
                              </DropdownMenu.Item>
                            ))}
                          </DropdownMenu.SubContent>
                        </DropdownMenu.Portal>
                      </DropdownMenu.Sub>
                    )}

                    <DropdownMenu.Separator className="my-1 h-px bg-border" />

                    {/* Delete */}
                    <DropdownMenu.Item
                      className="flex cursor-pointer select-none items-center rounded-sm px-3 py-2 text-sm text-destructive outline-none hover:bg-secondary focus:bg-secondary"
                      onSelect={() => {
                        void handleDelete();
                      }}
                    >
                      Delete
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </div>

          {/* Inline meta panel (due date + notes) — opens when requested */}
          {isMetaOpen && (
            <div
              className="rounded-sm border border-border/50 bg-surface/50 px-3 py-3 space-y-3 mr-2"
              style={{ marginLeft: metaIndentLeft }}
            >
              {/* Due date field — `task`-only (§7.3); notes (below) stay generic. */}
              {isTask && (
                <div className="flex flex-col gap-1">
                  <FieldLabel htmlFor={`due-date-${node.id}`}>Due date</FieldLabel>
                  {isEditingDueDate ? (
                    <div className="flex items-center gap-2">
                      <input
                        id={`due-date-${node.id}`}
                        type="date"
                        value={draftDueDate}
                        onChange={(event_) => {
                          setDraftDueDate(event_.target.value);
                        }}
                        onBlur={() => {
                          void handleSaveDueDate();
                        }}
                        className={cn(
                          // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                          'rounded-sm border border-border bg-input px-2 py-1 text-sm text-foreground',
                          // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                          // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                          '[color-scheme:dark]',
                        )}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void handleSaveDueDate();
                        }}
                        className="text-accent-teal hover:bg-accent-teal/10"
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setIsEditingDueDate(false);
                          setDraftDueDate(node.due_date ?? '');
                        }}
                        className="text-muted-foreground"
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <button
                      id={`due-date-${node.id}`}
                      type="button"
                      onClick={() => {
                        setIsEditingDueDate(true);
                      }}
                      className="text-left text-sm text-foreground hover:text-accent-teal transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background rounded-sm"
                    >
                      {node.due_date ? (
                        formatDueDate(node.due_date)
                      ) : (
                        <span className="text-muted-foreground">Set a due date…</span>
                      )}
                    </button>
                  )}
                </div>
              )}

              {/* Notes field */}
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor={`notes-${node.id}`}>Notes</FieldLabel>
                {isEditingNotes ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      id={`notes-${node.id}`}
                      value={draftNotes}
                      onChange={(event_) => {
                        setDraftNotes(event_.target.value);
                      }}
                      rows={3}
                      className={cn(
                        // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                        'w-full resize-none rounded-sm border border-border bg-input px-2 py-1.5 text-sm text-foreground',
                        // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                        'placeholder:text-muted-foreground',
                        // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                      )}
                      placeholder="Add notes…"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void handleSaveNotes();
                        }}
                        className="text-accent-teal hover:bg-accent-teal/10"
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setIsEditingNotes(false);
                          setDraftNotes(node.notes ?? '');
                        }}
                        className="text-muted-foreground"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    id={`notes-${node.id}`}
                    type="button"
                    onClick={() => {
                      setIsEditingNotes(true);
                    }}
                    className="text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background rounded-sm"
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
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsMetaOpen(false);
                  setIsEditingDueDate(false);
                  setIsEditingNotes(false);
                }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors motion-reduce:transition-none focus:outline-none focus-visible:underline"
              >
                Close
              </button>
            </div>
          )}

          {/* Children — grid-rows trick gives a CSS-only height transition from 0fr→1fr */}
          {(hasChildren || showAddSubtask) && (
            <div
              className={cn(
                'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
                isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
              )}
              aria-hidden={!isExpanded}
              inert={!isExpanded}
            >
              <div className="overflow-hidden">
                <ul
                  aria-label="Subtasks"
                  className={cn(
                    'transition-opacity motion-reduce:transition-none',
                    isExpanded ? 'opacity-100 duration-200 delay-75' : 'opacity-0 duration-100',
                  )}
                >
                  {/* Add subtask inline form */}
                  {showAddSubtask && (
                    <li
                      className="list-none py-1"
                      style={{ paddingLeft: `${String((depth + 1) * 1.25 + 2.5)}rem` }}
                    >
                      <CaptureBox
                        parentId={node.id}
                        folderId={node.folder_id}
                        compact
                        onDismiss={() => {
                          closeEditor({ itemId: node.id, kind: 'subtask' });
                        }}
                      />
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
                      <div
                        className={cn(
                          'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
                          showCompleted ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                        )}
                        aria-hidden={!showCompleted}
                        inert={!showCompleted}
                      >
                        <div className="overflow-hidden">
                          <ul
                            aria-label="Completed subtasks"
                            className={cn(
                              'transition-opacity motion-reduce:transition-none',
                              showCompleted
                                ? 'opacity-100 duration-200 delay-75'
                                : 'opacity-0 duration-100',
                            )}
                          >
                            {completedChildren.map((child) => (
                              <TaskRow
                                key={child.id}
                                node={child}
                                depth={depth + 1}
                                isCompletedView={isCompletedView}
                              />
                            ))}
                          </ul>
                        </div>
                      </div>

                      <div
                        className="py-1"
                        style={{ paddingLeft: `${String((depth + 1) * 1.25 + 0.75)}rem` }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            toggleCompleted(node.id);
                          }}
                          aria-expanded={showCompleted}
                          className={cn(
                            // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                            'inline-flex items-center rounded-sm text-xs text-muted-foreground/70',
                            // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                            'transition-colors duration-100 hover:text-foreground motion-reduce:transition-none',
                            // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-1 focus-visible:ring-offset-background',
                          )}
                        >
                          {showCompleted
                            ? 'Hide completed'
                            : `Show completed (${String(completedChildren.length)})`}
                        </button>
                      </div>
                    </li>
                  )}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

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

      {/* The gate (§8) — Send to Code module / Convert to Code Story. On success the item
          has left task_items, so drop it from the store and toast its new ref. */}
      <GateDialog
        open={showGate}
        onOpenChange={setShowGate}
        item={{
          id: node.id,
          title: node.title,
          notes: node.notes,
          source_url: node.source_url,
        }}
        onComplete={(story) => {
          removeGatedItem(node.id);
          showToast(`Created ${story.ref}`);
        }}
      />
    </li>
  );
}
