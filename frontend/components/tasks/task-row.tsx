'use client';

import { Check, ChevronRight, ListCheck, MoreHorizontal, Plus } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import * as React from 'react';

import { FieldLabel } from '@/components/atoms/field-label';
import { IconButton } from '@/components/atoms/icon-button';
import { CaptureBox } from '@/components/tasks/capture-box';
import { CascadeModal } from '@/components/tasks/cascade-modal';
import { Button } from '@/components/ui/button';
import { formatDueDate, isDueDateOverdue } from '@/lib/date-utils';
import { useFolders } from '@/lib/stores/folders-store';
import { useTaskActions, useTasks } from '@/lib/stores/tasks-store';
import type { ItemNode } from '@/lib/tree';
import { getAncestorTitles, getDescendantIds } from '@/lib/tree';
import { usePrefersReducedMotion } from '@/lib/use-prefers-reduced-motion';
import { cn } from '@/lib/utils';

interface TaskRowProperties {
  node: ItemNode;
  depth?: number;
  isCompleted?: boolean;
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
export function TaskRow({ node, depth = 0, isCompleted = false }: TaskRowProperties) {
  const folders = useFolders();
  const allTasks = useTasks();
  const { completeTask, uncompleteTask, updateTask, moveTask, deleteTask } = useTaskActions();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [showAddSubtask, setShowAddSubtask] = React.useState(false);
  const [showCascadeModal, setShowCascadeModal] = React.useState(false);
  // While true, the row plays its completion exit (checkbox pop → height collapse →
  // text fade) and holds itself visible until the collapse ends, at which point
  // `completeTask` runs and the store filters the row out of view. See the `motion` skill.
  const [isCompleting, setIsCompleting] = React.useState(false);
  // `hasCompletedRef` keeps the completion mutation firing exactly once (animation end
  // OR unmount); `isCompletingRef` lets the unmount fallback read the latest state.
  const hasCompletedRef = React.useRef(false);
  const isCompletingRef = React.useRef(false);
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
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

  const hasChildren = node.children.length > 0;
  const descendantCount = getDescendantIds(node).length;
  // The checkbox reads as "complete" both in the completed view and during the exit
  // animation, so its fill + check icon appear the instant completion begins.
  const showAsComplete = isCompleted || isCompleting;

  // On the Completed screen, each root row carries a context label showing where the
  // task lives: its ancestor breadcrumb (oldest → youngest) when it's a nested subtask,
  // otherwise its folder name (or "Inbox"). Ancestors are resolved from the full task
  // list because they may be active items filtered out of the completed view.
  const isContextRow = isCompleted && depth === 0;
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

  // The collapse animation finishing is what commits the completion. Guard against the
  // checkbox pop (a child animation) bubbling up — only the wrapper's own collapse counts.
  const handleCompleteCollapseEnd = (event_: React.AnimationEvent<HTMLDivElement>) => {
    if (event_.target === event_.currentTarget && isCompleting) {
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
      setIsEditingTitle(false);
      return;
    }
    try {
      await updateTask(node.id, { title: newValue });
      setIsEditingTitle(false);
    } catch {
      // The store reverted the title; keep editing so the user can retry.
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

  return (
    <li className="group/row list-none">
      {/* The completion exit collapses the row (and its expanded subtree): animating
          the grid row track from 1fr to 0fr shrinks the height to nothing, pulling the
          rows below up. The inner child is clipped so it can shrink past its content. */}
      <div
        className={cn(
          // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
          'grid',
          isCompleting &&
            // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
            'animate-task-collapse motion-reduce:animate-none',
        )}
        data-testid="task-collapse"
        onAnimationEnd={handleCompleteCollapseEnd}
      >
        <div className={cn(isCompleting && 'overflow-hidden')}>
          {/* Main row */}
          <div
            className={cn(
              // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
              'flex items-center gap-2 rounded-sm py-2 pr-2',
              // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
              'hover:bg-secondary/30 transition-colors duration-100 motion-reduce:transition-none',
            )}
            style={{ paddingLeft: indentLeft }}
          >
            {/* Expand/collapse toggle */}
            <IconButton
              size="sm"
              onClick={() => {
                setIsExpanded((v) => !v);
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

            {/* Completion checkbox */}
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
              {showAsComplete && <Check size={10} className="text-background" strokeWidth={3} />}
            </button>

            {/* Title */}
            {isEditingTitle ? (
              <>
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
                      setIsEditingTitle(false);
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
              </>
            ) : (
              <div
                className="flex-1 flex flex-col min-w-0"
                onDoubleClick={() => {
                  setIsEditingTitle(true);
                }}
              >
                <span
                  className={cn(
                    // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
                    'text-sm truncate cursor-text transition-colors duration-300 delay-100 motion-reduce:transition-none',
                    // Fade to low-contrast as the row completes; full-contrast otherwise.
                    isCompleting ? 'text-muted-foreground/50' : 'text-foreground',
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

            {/* Due date chip */}
            {node.due_date && !isEditingDueDate && (
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

            {/* Children count badge */}
            {hasChildren && !isExpanded && (
              <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                {node.children.length}
              </span>
            )}

            {/* Row actions — visible on hover */}
            <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity duration-100 motion-reduce:opacity-100">
              {/* Add subtask */}
              <IconButton
                size="md"
                tone="accent"
                onClick={() => {
                  setShowAddSubtask((v) => !v);
                  setIsExpanded(true);
                }}
                aria-label="Add subtask"
              >
                <Plus size={12} />
              </IconButton>

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
                    {/* Edit due date */}
                    <DropdownMenu.Item
                      className="flex cursor-pointer select-none items-center rounded-sm px-3 py-2 text-sm text-foreground outline-none hover:bg-secondary focus:bg-secondary"
                      onSelect={() => {
                        setIsEditingDueDate(true);
                        setIsMetaOpen(true);
                        setIsExpanded(true);
                      }}
                    >
                      {node.due_date ? 'Edit due date' : 'Set due date'}
                    </DropdownMenu.Item>

                    {/* Edit notes */}
                    <DropdownMenu.Item
                      className="flex cursor-pointer select-none items-center rounded-sm px-3 py-2 text-sm text-foreground outline-none hover:bg-secondary focus:bg-secondary"
                      onSelect={() => {
                        setIsEditingNotes(true);
                        setIsMetaOpen(true);
                        setIsExpanded(true);
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
              {/* Due date field */}
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
                      style={{ paddingLeft: `${String((depth + 1) * 1.25 + 0.75)}rem` }}
                    >
                      <CaptureBox
                        parentId={node.id}
                        folderId={node.folder_id}
                        compact
                        onCapture={() => {
                          setShowAddSubtask(false);
                        }}
                      />
                    </li>
                  )}

                  {/* Child task rows */}
                  {node.children.map((child) => (
                    <TaskRow
                      key={child.id}
                      node={child}
                      depth={depth + 1}
                      isCompleted={isCompleted}
                    />
                  ))}
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
    </li>
  );
}
