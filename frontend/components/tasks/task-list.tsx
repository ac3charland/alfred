'use client';

import * as React from 'react';

import { TaskRow } from '@/components/tasks/task-row';
import type { ItemNode } from '@/lib/tree';
import type { Folder } from '@/lib/types';
import { cn } from '@/lib/utils';

interface TaskListProperties {
  nodes: ItemNode[];
  folders: Folder[];
  emptyMessage?: string;
  isCompleted?: boolean;
}

/**
 * Renders the top-level task list. Each TaskRow handles its own recursive
 * subtree rendering.
 */
export function TaskList({
  nodes,
  folders,
  emptyMessage = 'No tasks yet',
  isCompleted = false,
}: TaskListProperties) {
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
        <TaskRow key={node.id} node={node} folders={folders} isCompleted={isCompleted} />
      ))}
    </ul>
  );
}
