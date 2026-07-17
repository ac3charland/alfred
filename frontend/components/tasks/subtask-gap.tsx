'use client';

import { useDroppable } from '@dnd-kit/core';

import { useTaskDrag } from '@/components/tasks/task-dnd-provider';
import { reorderGapId } from '@/lib/dnd/reorder-subtask';
import { useIndentation } from '@/lib/hooks/use-indentation';
import { cn } from '@/lib/utils';

/**
 * A thin, layout-neutral drop strip at a subtask boundary (ALF-117). One sits at the top of,
 * between, and at the bottom of each rendered active subtask group — one more gap than rows.
 * Dropping a dragged subtask into a gap positions it at that slot (a fractional `sort_order` at
 * the midpoint of its neighbours); dropping onto a row body keeps its re-parent meaning.
 *
 * The strip is **layout-neutral**: its `<li>` takes zero flow height and the hit area + teal
 * insertion line are absolutely positioned over the boundary, so revealing the line on hover
 * never reflows the list (the reflow pitfall the dnd-kit skill calls out). It only participates
 * in a drag while a *subtask* is being dragged (`disabled` otherwise, so a root drag or a plain
 * re-parent reads the row body underneath, never a gap) and lights up teal only while hovered.
 */
export function SubtaskGap({
  parentId,
  index,
  depth,
}: {
  parentId: string;
  index: number;
  /** The depth of the rows this gap sits among — aligns the insertion line under their text. */
  depth: number;
}) {
  const { activeDragIsChild } = useTaskDrag();
  const { setNodeRef, isOver } = useDroppable({
    id: reorderGapId(parentId, index),
    disabled: !activeDragIsChild,
  });
  const { rowLeft } = useIndentation(depth);
  const active = activeDragIsChild && isOver;

  return (
    <li aria-hidden className="relative z-10 h-0 list-none">
      <div
        ref={setNodeRef}
        data-reorder-gap=""
        data-drop-over={active ? 'true' : undefined}
        // Straddle the boundary (zero flow height): a ~16px hit band centred on the row edge, with
        // ~24px of row body left uncovered in the middle for the re-parent gesture.
        className="pointer-events-none absolute inset-x-0 -top-2 h-4"
      >
        <div
          className={cn(
            'absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-accent-teal',
            'transition-opacity motion-reduce:transition-none',
            active ? 'opacity-100' : 'opacity-0',
          )}
          style={{ marginLeft: rowLeft, marginRight: '0.75rem' }}
        />
      </div>
    </li>
  );
}
