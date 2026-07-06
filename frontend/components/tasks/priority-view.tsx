'use client';

import { Check, ChevronRight, ListOrdered } from 'lucide-react';
import * as React from 'react';

import { AnimatedHeightCollapse } from '@/components/atoms/animated-height-collapse';
import { CheckboxButton } from '@/components/atoms/checkbox-button';
import { IconButton } from '@/components/atoms/icon-button';
import { ToggleButton } from '@/components/atoms/toggle-button';
import { CascadeModal } from '@/components/tasks/cascade-modal';
import { DueDateChip } from '@/components/tasks/due-date-chip';
import { navigateToTaskAndFocus } from '@/components/tasks/navigate-to-task';
import { PriorityChip } from '@/components/tasks/priority-chip';
import {
  checkboxIncompleteClass,
  checkboxSizeClass,
  chevronButtonClass,
  chevronIconClass,
} from '@/components/tasks/task-row.styles';
import { useIndentation } from '@/lib/hooks/use-indentation';
import type { TaskPriority } from '@/lib/priority';
import { useFolders } from '@/lib/stores/folders-store';
import { useTaskActions, useTasks, useTasksByPriority } from '@/lib/stores/tasks-store';
import { taskDestination } from '@/lib/tasks/task-location';
import type { ItemNode } from '@/lib/tree';
import { getDescendantIds, hasActiveDescendant } from '@/lib/tree';
import { isPlainLeftClick } from '@/lib/ui/plain-click';
import { cn } from '@/lib/utils';

/**
 * One By-Priority row (ALF-101): a normal, actionable task component rather than a read-only
 * index entry. It carries a completion checkbox (opening the cascade modal when the task hides
 * active subtasks) and — when it has subtasks — an expand chevron that reveals them, recursively,
 * each rendered by this same component. The right-hand task-row affordances (add-subtask, the
 * ⋯ menu) are deliberately omitted here: the By-Priority list is for triaging and ticking off,
 * not for restructuring.
 *
 * The title stays a real `<a href>` that jumps to the task in its containing view and rings it
 * there (ALF-96) via {@link navigateToTaskAndFocus}, so ⌘/middle-clicks still open a new tab.
 * The priority chip (level, or a muted "Set priority" prompt) opens its own picker to
 * re-prioritise in place. Only a depth-0 row shows the folder/Inbox label — subtasks share their
 * root's bucket.
 */
function PriorityRow({
  node,
  depth,
  folderName,
  showCompleted,
}: {
  node: ItemNode;
  depth: number;
  /** The containing folder/Inbox label — only supplied (and shown) at the top level. */
  folderName?: string;
  showCompleted: boolean;
}) {
  const { completeTask, uncompleteTask, updateTask } = useTaskActions();
  const allTasks = useTasks();
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [showCascadeModal, setShowCascadeModal] = React.useState(false);

  const isTask = node.item_type === 'task';
  const isCompleted = node.status === 'completed';
  const { rowLeft } = useIndentation(depth);

  // Completed subtasks are hidden alongside completed top-level tasks (the view-wide toggle), so
  // a parent whose only children are done shows no chevron until "Show completed" is on.
  const visibleChildren = showCompleted
    ? node.children
    : node.children.filter((child) => child.status === 'active');
  const hasChildren = visibleChildren.length > 0;

  const href = React.useMemo(() => taskDestination(node, allTasks), [node, allTasks]);

  const handlePriorityChange = (next: TaskPriority | null) => {
    void updateTask(node.id, { priority: next }).catch(() => {
      // The store already rolled the row back.
    });
  };

  const handleToggleComplete = () => {
    if (isCompleted) {
      void uncompleteTask(node.id).catch(() => {
        // The store already restored the row.
      });
      return;
    }
    // Warn before sweeping still-active subtasks complete (spec §3.6); skip the modal when the
    // cascade would change nothing (no subtasks, or every descendant already done — ALF-73).
    if (hasActiveDescendant(node)) {
      setShowCascadeModal(true);
      return;
    }
    void completeTask(node.id).catch(() => {
      // The store already restored the row.
    });
  };

  const handleCascadeConfirm = () => {
    setShowCascadeModal(false);
    void completeTask(node.id).catch(() => {
      // The store already restored the row.
    });
  };

  return (
    <li className={depth === 0 ? 'rounded-lg border border-border bg-surface' : 'list-none'}>
      <div
        className="flex items-center gap-2 rounded-lg py-2 pr-3 transition-colors duration-100 hover:bg-secondary/30 motion-reduce:transition-none"
        style={{ paddingLeft: rowLeft }}
      >
        {/* Expand/collapse — only for a row that actually has visible subtasks; otherwise an
            invisible spacer keeps every title aligned down the list. */}
        {hasChildren ? (
          <IconButton
            size="sm"
            onClick={() => {
              setIsExpanded((open) => !open);
            }}
            aria-label={isExpanded ? 'Collapse subtasks' : 'Expand subtasks'}
            aria-expanded={isExpanded}
            className={chevronButtonClass}
          >
            <ChevronRight
              size={14}
              className={cn(chevronIconClass, 'h-3.5 w-3.5', isExpanded && 'rotate-90')}
            />
          </IconButton>
        ) : (
          <span className="h-5 w-5 shrink-0" aria-hidden="true" />
        )}

        {/* Completion checkbox — task-only; a non-task row keeps a spacer so titles stay aligned. */}
        {isTask ? (
          <CheckboxButton
            onClick={handleToggleComplete}
            aria-label={
              isCompleted ? `Mark "${node.title}" active` : `Mark "${node.title}" complete`
            }
            className={cn(
              checkboxSizeClass,
              isCompleted ? 'bg-accent-teal border-accent-teal' : checkboxIncompleteClass,
            )}
          >
            {isCompleted && (
              <Check size={10} className="h-2.5 w-2.5 text-background" strokeWidth={3} />
            )}
          </CheckboxButton>
        ) : (
          <span className={cn(checkboxSizeClass, 'shrink-0')} aria-hidden="true" />
        )}

        <a
          href={href}
          onClick={(event_) => {
            // Let the browser handle a modified/middle click (new tab); hijack only a plain click.
            if (!isPlainLeftClick(event_)) return;
            event_.preventDefault();
            navigateToTaskAndFocus(node.id, href);
          }}
          className={cn(
            'min-w-0 flex-1 truncate rounded-sm text-sm transition-colors duration-100',
            'hover:text-accent-teal focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal motion-reduce:transition-none',
            isCompleted ? 'text-muted-foreground line-through' : 'text-foreground',
          )}
        >
          {node.title}
        </a>

        {isTask && node.due_date && <DueDateChip dueDate={node.due_date} />}

        {isTask && (
          <PriorityChip
            priority={node.priority}
            emptyLabel="Set priority"
            menuAlign="end"
            onChange={handlePriorityChange}
          />
        )}

        {folderName !== undefined && (
          <span className="w-20 shrink-0 truncate text-right text-xs text-muted-foreground">
            {folderName}
          </span>
        )}
      </div>

      {hasChildren && (
        <AnimatedHeightCollapse open={isExpanded}>
          <ul aria-label="Subtasks" className="pb-1">
            {visibleChildren.map((child) => (
              <PriorityRow
                key={child.id}
                node={child}
                depth={depth + 1}
                showCompleted={showCompleted}
              />
            ))}
          </ul>
        </AnimatedHeightCollapse>
      )}

      <CascadeModal
        open={showCascadeModal}
        onOpenChange={setShowCascadeModal}
        taskTitle={node.title}
        subtaskCount={getDescendantIds(node).length}
        onConfirm={handleCascadeConfirm}
        isPending={false}
      />
    </li>
  );
}

/**
 * The **By-Priority** view (ALF-37): a flat, cross-cutting list of every top-level task across
 * Inbox and every folder, ranked by `useTasksByPriority` (best priority / urgency across each
 * task's active subtree). Spiritually the Tasks counterpart of the Code Backlog — same header +
 * Show-completed toggle scaffold — but ordered by a discrete priority level, not a manual rank.
 * Since ALF-101 each row is a normal task component (checkbox + expandable subtasks).
 *
 * Must be mounted under a `TasksProvider` / `FoldersProvider` (the shell-seeded stores).
 */
export function PriorityView() {
  const [showCompleted, setShowCompleted] = React.useState(false);
  const tasks = useTasksByPriority({ showCompleted });
  const folders = useFolders();

  const folderName = (folderId: string | null): string =>
    folderId === null
      ? 'Inbox'
      : (folders.find((folder) => folder.id === folderId)?.name ?? 'Unknown');

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-accent-teal">
            <ListOrdered size={20} />
          </div>
          <div className="flex flex-col">
            <h2 className="font-serif text-2xl text-foreground">By Priority</h2>
            <p className="text-sm text-muted-foreground">
              Every task across Inbox and your folders, ranked by priority.
            </p>
          </div>
        </div>
        <ToggleButton
          pressed={showCompleted}
          onToggle={() => {
            setShowCompleted((on) => !on);
          }}
        >
          Show completed
        </ToggleButton>
      </div>

      {tasks.length > 0 ? (
        <ul aria-label="Tasks by priority" className="flex flex-col gap-2">
          {tasks.map((task) => (
            <PriorityRow
              key={task.id}
              node={task}
              depth={0}
              folderName={folderName(task.folder_id)}
              showCompleted={showCompleted}
            />
          ))}
        </ul>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border p-10">
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            No tasks yet. Capture a task and give it a priority to see it ranked here.
          </p>
        </div>
      )}
    </>
  );
}
