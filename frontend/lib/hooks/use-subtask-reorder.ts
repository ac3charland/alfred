'use client';

import * as React from 'react';

import { computeInsertOrder } from '@/lib/dnd/reorder-subtask';
import { stableSorted } from '@/lib/sort';
import { useTaskActions, useTasks } from '@/lib/stores/tasks-store';
import type { ItemNode } from '@/lib/tree';

/** The "Move up" / "Move down" reorder affordance for a row, or its absence. */
export interface SubtaskReorder {
  /** True when the row is an active subtask in an active view — the only rows that reorder. */
  isActiveSubtask: boolean;
  /** True when the row can move up (an active subtask not already first in its group). */
  canMoveUp: boolean;
  /** True when the row can move down (an active subtask not already last in its group). */
  canMoveDown: boolean;
  /** Move the row up one slot among its active siblings. */
  moveUp: () => void;
  /** Move the row down one slot among its active siblings. */
  moveDown: () => void;
}

/**
 * The keyboard/screen-reader-friendly subtask reorder path (ALF-117): "Move up" / "Move down".
 * Offered on active subtask rows only — roots aren't reorderable, and the Completed view has no
 * reorder gesture. Each move computes the fractional `sort_order` of the slot it swaps past (the
 * same midpoint math as a gap drop) and calls `reorderSubtask`, hidden at the ends of the group.
 */
export function useSubtaskReorder(
  node: ItemNode,
  isCompleted: boolean,
  isCompletedView: boolean,
): SubtaskReorder {
  const allTasks = useTasks();
  const { reorderSubtask } = useTaskActions();

  const isActiveSubtask = node.parent_id !== null && !isCompleted && !isCompletedView;

  const orderedActiveSiblings = React.useMemo(
    () =>
      isActiveSubtask && node.parent_id !== null
        ? stableSorted(
            allTasks.filter(
              (task) => task.parent_id === node.parent_id && task.status === 'active',
            ),
            (a, b) => a.sort_order - b.sort_order,
          )
        : [],
    [isActiveSubtask, node.parent_id, allTasks],
  );
  const siblingIndex = orderedActiveSiblings.findIndex((sibling) => sibling.id === node.id);

  const reorderTo = (sortOrder: number) => {
    if (node.parent_id === null) return;
    const parentId = node.parent_id;
    void (async () => {
      try {
        await reorderSubtask(node.id, { parentId, sortOrder });
      } catch {
        // The store already rolled the row back.
      }
    })();
  };

  return {
    isActiveSubtask,
    canMoveUp: siblingIndex > 0,
    canMoveDown: siblingIndex >= 0 && siblingIndex < orderedActiveSiblings.length - 1,
    moveUp: () => {
      // Land between the sibling two above (or the top edge) and the sibling one above.
      const prev = orderedActiveSiblings[siblingIndex - 2]?.sort_order ?? null;
      const next = orderedActiveSiblings[siblingIndex - 1]?.sort_order ?? null;
      if (next === null) return;
      reorderTo(computeInsertOrder(prev, next));
    },
    moveDown: () => {
      // Land between the sibling one below and the sibling two below (or the bottom edge).
      const prev = orderedActiveSiblings[siblingIndex + 1]?.sort_order ?? null;
      const next = orderedActiveSiblings[siblingIndex + 2]?.sort_order ?? null;
      if (prev === null) return;
      reorderTo(computeInsertOrder(prev, next));
    },
  };
}
