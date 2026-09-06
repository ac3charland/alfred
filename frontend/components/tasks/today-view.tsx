'use client';

import { Sun } from 'lucide-react';
import * as React from 'react';

import { TriageList } from '@/components/tasks/triage-list';
import { useTasksDueToday } from '@/lib/stores/tasks-store';

/**
 * The **Today** view (ALF-106): the day's actual worklist — every top-level task that is due
 * today or already overdue, across Inbox and every folder, most overdue first. Its sibling By
 * Priority answers "what matters most?"; this one answers "what is due now?", so it leads with
 * the deadline and lets the priority level break a same-day tie.
 *
 * An undated task with a subtask due today floats in on that subtask (the row expands to reveal
 * it), which is what keeps a deadline from hiding inside a collapsed parent.
 *
 * Must be mounted under a `TasksProvider` / `FoldersProvider` (the shell-seeded stores).
 */
export function TodayView() {
  const [showCompleted, setShowCompleted] = React.useState(false);
  const tasks = useTasksDueToday({ showCompleted });

  return (
    <TriageList
      icon={Sun}
      title="Today"
      description="Everything due today or already overdue, most overdue first."
      listLabel="Tasks due today"
      emptyMessage="Nothing is due today. Give a task a due date and it will show up here on the day."
      tasks={tasks}
      showCompleted={showCompleted}
      onToggleCompleted={() => {
        setShowCompleted((on) => !on);
      }}
    />
  );
}
