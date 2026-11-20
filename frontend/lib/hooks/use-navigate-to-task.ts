'use client';

import * as React from 'react';

import { navigateToTaskAndFocus } from '@/components/tasks/navigate-to-task';
import { useExpansionActions } from '@/lib/stores/expansion-store';
import { useTasks } from '@/lib/stores/tasks-store';
import { getAncestorIds } from '@/lib/tree';

/**
 * The "go to this task" jump every affordance shares (global search, the By-Priority list): open
 * each ancestor's subtask tree, then {@link navigateToTaskAndFocus}. A subtask's row sits inside
 * its ancestors' collapsed (0-height, aria-hidden) lists, so without the expand the jump lands on
 * the right view but the ring plays where no one can see it (ALF-361). The expansion store lives
 * in the layout, so the opened flags survive the view switch.
 */
export function useNavigateToTask(): (id: string, href: string) => void {
  const tasks = useTasks();
  const { expandSubtasks } = useExpansionActions();
  return React.useCallback(
    (id, href) => {
      const parentId = tasks.find((task) => task.id === id)?.parent_id ?? null;
      for (const ancestorId of getAncestorIds(tasks, parentId)) expandSubtasks(ancestorId);
      navigateToTaskAndFocus(id, href);
    },
    [tasks, expandSubtasks],
  );
}
