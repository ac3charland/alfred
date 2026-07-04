'use client';

import { ListOrdered } from 'lucide-react';
import * as React from 'react';

import { ToggleButton } from '@/components/atoms/toggle-button';
import { DueDateChip } from '@/components/tasks/due-date-chip';
import { PriorityChip } from '@/components/tasks/priority-chip';
import type { TaskPriority } from '@/lib/priority';
import { useFolders } from '@/lib/stores/folders-store';
import { useTaskActions, useTasksByPriority } from '@/lib/stores/tasks-store';
import type { Item } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * One By-Priority row: title, the folder it lives in (or "Inbox"), a due-date chip when present,
 * and the {@link PriorityChip} — showing the level when set, or a muted "Set priority" prompt
 * otherwise. The chip opens its own picker so the owner can re-prioritise in place, writing
 * through the optimistic `updateTask` path.
 */
function PriorityRow({ task, folderName }: { task: Item; folderName: string }) {
  const { updateTask } = useTaskActions();
  const isCompleted = task.status === 'completed';

  const handleChange = (next: TaskPriority | null) => {
    void (async () => {
      try {
        await updateTask(task.id, { priority: next });
      } catch {
        // The store already rolled the row back.
      }
    })();
  };

  return (
    <li className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 transition-colors duration-100 hover:border-accent-teal/50 motion-reduce:transition-none">
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-sm',
          isCompleted ? 'text-muted-foreground line-through' : 'text-foreground',
        )}
      >
        {task.title}
      </span>

      {task.due_date && <DueDateChip dueDate={task.due_date} />}

      <PriorityChip
        priority={task.priority}
        emptyLabel="Set priority"
        menuAlign="end"
        onChange={handleChange}
      />

      <span className="w-20 shrink-0 truncate text-right text-xs text-muted-foreground">
        {folderName}
      </span>
    </li>
  );
}

/**
 * The **By-Priority** view (ALF-37): a flat, cross-cutting list of every top-level task across
 * Inbox and every folder, ranked by `useTasksByPriority` (best priority / urgency across each
 * task's active subtree). Spiritually the Tasks counterpart of the Code Backlog — same header +
 * Show-completed toggle scaffold — but ordered by a discrete priority level, not a manual rank.
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
            <PriorityRow key={task.id} task={task} folderName={folderName(task.folder_id)} />
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
