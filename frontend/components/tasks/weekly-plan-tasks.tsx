'use client';

import * as React from 'react';

import { TriageRow } from '@/components/tasks/triage-row';
import { useBucketName } from '@/lib/hooks/use-bucket-name';
import { useWeeklyPlanTasks } from '@/lib/stores/tasks-store';
import { planProgress } from '@/lib/tasks/weekly-plan-tasks';

/** The section's heading, doubling as the list's accessible name. */
const PLANNED_TASKS = 'Planned tasks';

/**
 * The work a week plan produced (ALF-235): every top-level item the weekly review created against
 * `planId`, in the order the review wrote them, under an "N of M tasks done" tally.
 *
 * Rows are {@link TriageRow}s, like the other cross-cutting lists: a checkbox to tick work off,
 * a chevron for subtasks, the folder the row lives in. Unlike Today and By Priority there is no
 * Show-completed toggle — finished work stays in view, struck through, because this list is a
 * record of the week rather than a queue to empty.
 *
 * Must be mounted under a `TasksProvider` / `FoldersProvider` (the shell-seeded stores).
 */
export function WeeklyPlanTasks({ planId }: { planId: string }) {
  const tasks = useWeeklyPlanTasks(planId);
  const bucketName = useBucketName();
  const headingId = React.useId();
  const { done, total } = planProgress(tasks);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={headingId} className="text-sm font-semibold text-foreground">
          {PLANNED_TASKS}
        </h3>
        {total > 0 && (
          <p className="text-xs text-muted-foreground">
            {`${String(done)} of ${String(total)} tasks done`}
          </p>
        )}
      </div>

      {tasks.length > 0 ? (
        <ul aria-label={PLANNED_TASKS} className="flex flex-col gap-2">
          {tasks.map((task) => (
            <TriageRow
              key={task.id}
              node={task}
              depth={0}
              folderName={bucketName(task)}
              showCompleted
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nothing has been created from this plan yet. Items the weekly review creates against it
          show up here.
        </p>
      )}
    </section>
  );
}
