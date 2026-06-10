'use client';

import * as React from 'react';

import { TaskRow } from '@/components/tasks/task-row';
import { useTasks } from '@/lib/stores/tasks-store';
import { cn } from '@/lib/utils';

interface TaskListProperties {
  emptyMessage?: string;
  isCompleted?: boolean;
}

/**
 * Renders the top-level task list from the TasksProvider store. Each TaskRow handles
 * its own recursive subtree rendering and reads folders from the FoldersProvider.
 */
export function TaskList({
  emptyMessage = 'No tasks yet',
  isCompleted = false,
}: TaskListProperties) {
  const nodes = useTasks();

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="font-serif text-2xl text-muted-foreground/50">{emptyMessage}</p>
        <p className="mt-2 text-sm text-muted-foreground/40">Capture something above.</p>
      </div>
    );
  }

  return (
    <ul
      aria-label="Tasks"
      className={cn(
        'rounded-2xl border border-border bg-surface',
        'divide-y divide-border/50',
        'overflow-hidden',
      )}
    >
      {nodes.map((node) => (
        <TaskRow key={node.id} node={node} isCompleted={isCompleted} />
      ))}
    </ul>
  );
}
