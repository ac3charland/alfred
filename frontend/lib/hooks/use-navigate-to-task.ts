'use client';

import * as React from 'react';

import { navigateToTaskAndFocus } from '@/components/tasks/navigate-to-task';
import { useExpansionActions } from '@/lib/stores/expansion-store';
import { useTasks } from '@/lib/stores/tasks-store';
import { getAncestorIds } from '@/lib/tree';

/**
 * The "go to this task" jump every affordance shares (global search, the By-Priority list): open
 * each ancestor's disclosures down to the target, then {@link navigateToTaskAndFocus}. A subtask's
 * row sits inside its ancestors' collapsed (0-height, aria-hidden) lists, so without the expand the
 * jump lands on the right view but the ring plays where no one can see it (ALF-361). In an active
 * view a completed child also hides behind its parent's "Show completed" panel, so that opens too
 * (harmless in the Completed view, which renders completed children inline and ignores the flag).
 * The expansion store lives in the layout, so the opened flags survive the view switch.
 */
export function useNavigateToTask(): (id: string, href: string) => void {
  const tasks = useTasks();
  const { expandSubtasks, expandCompleted } = useExpansionActions();
  return React.useCallback(
    (id, href) => {
      const byId = new Map(tasks.map((task) => [task.id, task] as const));
      const ancestorIds = getAncestorIds(tasks, byId.get(id)?.parent_id ?? null);
      // Walk root → target, opening each ancestor on the way down to its next step.
      let parentId: string | undefined;
      for (const stepId of [...ancestorIds, id]) {
        if (parentId !== undefined) {
          expandSubtasks(parentId);
          if (byId.get(stepId)?.status === 'completed') expandCompleted(parentId);
        }
        parentId = stepId;
      }
      navigateToTaskAndFocus(id, href);
    },
    [tasks, expandSubtasks, expandCompleted],
  );
}
