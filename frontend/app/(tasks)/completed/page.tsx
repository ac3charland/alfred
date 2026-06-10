import * as React from 'react';

import { TaskList } from '@/components/tasks/task-list';
import { getFolders } from '@/lib/data/folders';
import { getCompletedItems } from '@/lib/data/items';
import { getDescendantIds } from '@/lib/tree';

/**
 * Completed view — shows all completed tasks across inbox and folders.
 * Read-only: no capture box here (completed tasks are done).
 */
export default async function CompletedPage() {
  const [tree, folders] = await Promise.all([getCompletedItems(), getFolders()]);

  // Total completed tasks = every node in the forest (roots + all descendants).
  let count = 0;
  for (const root of tree) count += 1 + getDescendantIds(root).length;

  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
          Completed
        </span>
      </div>

      <div className="mb-8">
        <p className="text-sm text-muted-foreground">
          {count} completed task{count === 1 ? '' : 's'}
        </p>
      </div>

      <TaskList nodes={tree} folders={folders} emptyMessage="Nothing completed yet" isCompleted />
    </>
  );
}
