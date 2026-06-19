'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Check, ChevronRight, ListCheck, Plus } from 'lucide-react';
import * as React from 'react';

import { AnimatedHeightCollapse } from '@/components/atoms/animated-height-collapse';
import { Badge } from '@/components/atoms/badge';
import { CheckboxButton } from '@/components/atoms/checkbox-button';
import { DisclosureToggle } from '@/components/atoms/disclosure-toggle';
import { DueDateChip } from '@/components/atoms/due-date-chip';
import { IconButton } from '@/components/atoms/icon-button';
import { TextField } from '@/components/atoms/text-field';
import { GateDialog } from '@/components/code/gate-dialog';
import { CaptureBox } from '@/components/tasks/capture-box';
import { CascadeModal } from '@/components/tasks/cascade-modal';
import { useTaskDrag } from '@/components/tasks/task-dnd-provider';
import { TaskMetaPanel } from '@/components/tasks/task-row/task-meta-panel';
import { TaskRowMenu } from '@/components/tasks/task-row/task-row-menu';
import { TypeBadge } from '@/components/tasks/type-badge';
import { useAnimatedCompletion } from '@/lib/hooks/use-animated-completion';
import { useIndentation } from '@/lib/hooks/use-indentation';
import { useInlineEdit } from '@/lib/hooks/use-inline-edit';
import { useTaskRowFlags } from '@/lib/hooks/use-task-row-flags';
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
 * A single task row, recursively rendering its children — the composition root for the row:
 * layout + the recursive subtree, with cohesive pieces pulled into their own units. The
 * item-type flags (`useTaskRowFlags`), the indentation math (`useIndentation`), and the
 * delicate completion exit (`useAnimatedCompletion`) are hooks; the actions dropdown
 * (`TaskRowMenu`) and the due-date/notes card (`TaskMetaPanel`) are sub-components. The
 * subtask + completed-children reveals use the shared `AnimatedHeightCollapse`; the
 * completion-collapse stays bespoke (its 300ms + `delay-200` timing and the once-only commit
 * differ from the plain 200ms reveal).
 *
 * Features:
 * - Expand/collapse subtask tree
 * - Checkbox to complete (cascade modal for tasks with children)
 * - Inline title edit + due date + notes edit
 * - "Add subtask" affordance
 * - Move-to-folder dropdown + classify / gate entries
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

  // The completion exit: the once-only mutation fire, the navigate-away fallback, and the
  // collapse-end commit, encapsulated. Begin plays the animation (or commits immediately under
  // reduced motion); the collapse wrapper's onTransitionEnd commits.
  const {
    isCompleting,
    begin: beginComplete,
    onCollapseEnd: handleCompleteCollapseEnd,
  } = useAnimatedCompletion(() => completeTask(node.id), prefersReducedMotion);

  // Only one inline input may be open across all rows, so the title-edit and add-subtask
  // flags are derived from the shared active-editor store, not held per-row. Opening
  // either here closes whatever input another row had open (see active-editor-store).
  const isEditingTitle = sameEditor(activeEditor, { itemId: node.id, kind: 'title' });
  const showAddSubtask = sameEditor(activeEditor, { itemId: node.id, kind: 'subtask' });
  // The title's draft + trim/no-op/rollback save run through the shared useInlineEdit machine;
  // the EDIT-MODE flag stays in the cross-row active-editor store (so opening one row's title
  // closes any other's — the single-open-editor invariant). We therefore drive only the draft
  // and `save()` from the hook and ignore its own isEditing/begin/cancel. selectAllOnEdit is
  // false to preserve the existing focus-without-select behavior (the focus effect below, keyed
  // on the store flag, is what focuses the input).
  const titleEdit = useInlineEdit(node.title, (next) => updateTask(node.id, { title: next }), {
    selectAllOnEdit: false,
  });
  const { draft: draftTitle, setDraft: setDraftTitle, inputRef: titleInputRef } = titleEdit;

  React.useEffect(() => {
    // Stryker disable next-line ConditionalExpression,OptionalChaining: AT_CEILING — equivalent pair. The `?.` makes the `if` guard redundant for the side-effect: `if(true)` focuses on every effect run, but the title input is mounted (and the ref non-null) ONLY while isEditingTitle is true, so on every other run `current` is null and `?.` no-ops — identical to the guarded version. Likewise `current.focus()` (drop `?.`) only runs under the guard when the input is mounted, so `current` is never null there. Neither mutant can change observable focus behavior.
    if (isEditingTitle) titleInputRef.current?.focus();
  }, [isEditingTitle, titleInputRef]);

  const [isEditingDueDate, setIsEditingDueDate] = React.useState(false);
  const [isEditingNotes, setIsEditingNotes] = React.useState(false);
  const [draftDueDate, setDraftDueDate] = React.useState(node.due_date ?? '');
  const [draftNotes, setDraftNotes] = React.useState(node.notes ?? '');
  const [isMetaOpen, setIsMetaOpen] = React.useState(false);

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

  // Opening the meta panel for a due-date / notes edit. These are sync, fire-and-forget
  // entry points the row and the menu both use.
  const handleOpenDueDateEditor = () => {
    setIsEditingDueDate(true);
    setIsMetaOpen(true);
  };

  const handleOpenNotesEditor = () => {
    setIsEditingNotes(true);
    setIsMetaOpen(true);
  };

  const handleCloseMeta = () => {
    setIsMetaOpen(false);
    setIsEditingDueDate(false);
    setIsEditingNotes(false);
  };

  return (
    <li className="group/row list-none">
      {/* The completion exit collapses the row (and its expanded subtree): a transition
          on the grid row track from 1fr to 0fr shrinks the height to nothing, pulling the
          rows below up. `ease-out` (a transition, not a keyframe) makes the collapse start
          briskly, then settle — `delay-200` holds it back until the 200ms checkbox pop has
          finished, so the dismissal doesn't cover the pop. The inner child is clipped so it
          can shrink past its content. Kept bespoke (not AnimatedHeightCollapse) for the
          300ms + delay-200 timing and the commit-on-end contract. */}
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

            {/* Completion is `task`-only: an unclassified/code row shows no checkbox,
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
                    // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                    'h-4 w-4',
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
                </CheckboxButton>
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
                <TextField
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
                  // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                  className="flex-1 min-w-0 py-0.5"
                />
                <CheckboxButton
                  aria-label="Confirm title"
                  onClick={() => {
                    void handleSaveTitle();
                  }}
                  // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                  className="h-5 w-5 border-accent-teal bg-accent-teal"
                >
                  <Check size={10} className="text-background" strokeWidth={3} />
                </CheckboxButton>
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
                an unclassified row. */}
            <TypeBadge itemType={node.item_type} />

            {/* Due date chip — `task`-only. */}
            {isTask && node.due_date && !isEditingDueDate && (
              <DueDateChip dueDate={node.due_date} onClick={handleOpenDueDateEditor} />
            )}

            {/* Active children count badge */}
            {activeChildren.length > 0 && !isExpanded && (
              <Badge variant="secondary">{activeChildren.length}</Badge>
            )}

            {/* Completed descendants count badge (all depths) — right of the active one */}
            {completedDescendantCount > 0 && !isExpanded && (
              <Badge
                variant="muted"
                aria-label={`${String(completedDescendantCount)} completed`}
                className="inline-flex items-center gap-1 text-muted-foreground/60"
              >
                <Check size={10} strokeWidth={3} className="shrink-0" />
                {completedDescendantCount}
              </Badge>
            )}

            {/* Row actions — visible on hover */}
            <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity duration-100 motion-reduce:opacity-100">
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
                  <Plus size={12} />
                </IconButton>
              )}

              {/* More actions dropdown — all visibility conditionals live inside it. */}
              <TaskRowMenu
                isUnclassified={isUnclassified}
                isCode={isCode}
                canConvert={canConvert}
                isTask={isTask}
                hasDueDate={node.due_date !== null}
                hasNotes={node.notes !== null}
                folders={folders}
                onClassify={(itemType) => {
                  void handleClassify(itemType);
                }}
                onOpenGate={() => {
                  setShowGate(true);
                }}
                onSetDueDate={handleOpenDueDateEditor}
                onEditNotes={handleOpenNotesEditor}
                onMoveToFolder={(targetFolderId) => {
                  void handleMoveToFolder(targetFolderId);
                }}
                onDelete={() => {
                  void handleDelete();
                }}
              />
            </div>
          </div>

          {/* Inline meta panel (due date + notes) — opens when requested */}
          {isMetaOpen && (
            <TaskMetaPanel
              node={node}
              isTask={isTask}
              metaLeft={metaIndentLeft}
              isEditingDueDate={isEditingDueDate}
              draftDueDate={draftDueDate}
              onDraftDueDateChange={setDraftDueDate}
              onSaveDueDate={() => {
                void handleSaveDueDate();
              }}
              onBeginEditDueDate={() => {
                setIsEditingDueDate(true);
              }}
              onCancelDueDate={() => {
                setIsEditingDueDate(false);
                setDraftDueDate(node.due_date ?? '');
              }}
              isEditingNotes={isEditingNotes}
              draftNotes={draftNotes}
              onDraftNotesChange={setDraftNotes}
              onSaveNotes={() => {
                void handleSaveNotes();
              }}
              onBeginEditNotes={() => {
                setIsEditingNotes(true);
              }}
              onCancelNotes={() => {
                setIsEditingNotes(false);
                setDraftNotes(node.notes ?? '');
              }}
              onClose={handleCloseMeta}
            />
          )}

          {/* Children — grid-rows trick gives a CSS-only height transition from 0fr→1fr */}
          {(hasChildren || showAddSubtask) && (
            <AnimatedHeightCollapse
              open={isExpanded}
              className={cn(
                'transition-opacity motion-reduce:transition-none',
                isExpanded ? 'opacity-100 duration-200 delay-75' : 'opacity-0 duration-100',
              )}
            >
              <ul aria-label="Subtasks">
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
        item={{
          id: node.id,
          title: node.title,
          notes: node.notes,
          source_url: node.source_url,
        }}
        onComplete={(story) => {
          removeGatedItem(node.id);
          // The reconciled story always carries its allocated ref by now (`?? ''` only
          // satisfies the all-nullable view row type).
          showToast(`Created ${story.ref ?? ''}`);
        }}
      />
    </li>
  );
}
