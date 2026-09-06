'use client';

import { ListOrdered } from 'lucide-react';
import * as React from 'react';

import { TriageList } from '@/components/tasks/triage-list';
import { useTasksByPriority } from '@/lib/stores/tasks-store';

/**
 * The **By-Priority** view (ALF-37): a flat, cross-cutting list of every top-level task across
 * Inbox and every folder, ranked by `useTasksByPriority` (best priority / urgency across each
 * task's active subtree). Spiritually the Tasks counterpart of the Code Backlog — same header +
 * Show-completed toggle scaffold — but ordered by a discrete priority level, not a manual rank.
 * Since ALF-101 each row is a normal task component (checkbox + expandable subtasks).
 *
 * The chrome around the list is the shared `TriageList`, which its sibling Today also renders;
 * what belongs to this view is the ranking it selects — importance first.
 *
 * Must be mounted under a `TasksProvider` / `FoldersProvider` (the shell-seeded stores).
 */
export function PriorityView() {
  const [showCompleted, setShowCompleted] = React.useState(false);
  const tasks = useTasksByPriority({ showCompleted });

  return (
    <TriageList
      icon={ListOrdered}
      title="By Priority"
      description="Every task across Inbox and your folders, ranked by priority."
      listLabel="Tasks by priority"
      emptyMessage="No tasks yet. Capture a task and give it a priority to see it ranked here."
      tasks={tasks}
      showCompleted={showCompleted}
      onToggleCompleted={() => {
        setShowCompleted((on) => !on);
      }}
    />
  );
}
