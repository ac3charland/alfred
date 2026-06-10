'use client';

import * as React from 'react';

import { useTasks } from '@/lib/stores/tasks-store';

/** The "N completed tasks" summary line, derived from the shared store. */
export function CompletedCount() {
  const count = useTasks().filter((item) => item.status === 'completed').length;
  return (
    <p className="text-sm text-muted-foreground">
      {count} completed task{count === 1 ? '' : 's'}
    </p>
  );
}
