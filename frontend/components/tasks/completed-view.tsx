'use client';

import * as React from 'react';

import { CollapseAllButton } from '@/components/tasks/collapse-all-button';
import { CompletedCount } from '@/components/tasks/completed-count';
import { TaskList } from '@/components/tasks/task-list';

/**
 * The Completed view — all completed tasks across inbox and folders, filtered from the
 * shared store. Read-only: no capture box here (completed tasks are done).
 */
export function CompletedView() {
  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
          Completed
        </span>
        <CollapseAllButton scope={{ type: 'completed' }} />
      </div>

      <div className="mb-8">
        <CompletedCount />
      </div>

      <TaskList scope={{ type: 'completed' }} emptyMessage="Nothing completed yet" />
    </>
  );
}
