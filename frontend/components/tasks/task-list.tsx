'use client';

import * as React from 'react';

import { TaskRow } from '@/components/tasks/task-row';
import type { TaskScope } from '@/lib/stores/tasks-store';
import { useScopedTasks } from '@/lib/stores/tasks-store';
import { cn } from '@/lib/utils';

interface TaskListProperties {
  /** Which view to render (inbox / a folder / completed) — filters the shared store. */
  scope: TaskScope;
  emptyMessage?: string;
}

/**
 * Renders one view's task forest, derived from the shared TasksProvider store by `scope`.
 * Each TaskRow handles its own recursive subtree rendering and reads folders from the
 * FoldersProvider.
 */
export function TaskList({ scope, emptyMessage = 'No tasks yet' }: TaskListProperties) {
  const nodes = useScopedTasks(scope);
  const isCompleted = scope.type === 'completed';

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
