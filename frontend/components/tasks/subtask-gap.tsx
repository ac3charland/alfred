'use client';

import { useDroppable } from '@dnd-kit/core';

import { useTaskDrag } from '@/components/tasks/task-dnd-provider';
import { reorderGapId } from '@/lib/dnd/reorder-subtask';
import { useIndentation } from '@/lib/hooks/use-indentation';
import { cn } from '@/lib/utils';

/**
 * A thin, layout-neutral drop strip at a subtask boundary (ALF-117). One sits above every active
 * subtask row (at its top edge), plus one below the last row — one more gap than rows. Dropping a
 * dragged subtask into a gap positions it at that slot (a fractional `sort_order` at the midpoint
 * of its neighbours); dropping onto a row body keeps its re-parent meaning.
 *
 * Rendered as an **absolutely-positioned child of the row's `<li>`**, NOT as its own list item, so
 * it never becomes a child of the subtask `<ul>` — that keeps it out of the list's mobile
 * `divide-y` hairlines (Tailwind v4's `divide-y` borders every `:not(:last-child)`, so an extra
 * flow child would disturb the separators) and stops it reflowing the list when the insertion line
 * reveals. It only participates in a drag while a *subtask* is being dragged (`disabled` otherwise,
 * so a root drag or a plain re-parent reads the row body underneath) and lights up teal only while
 * hovered.
 */
export function SubtaskGap({
  parentId,
  index,
  depth,
  edge,
}: {
  parentId: string;
  index: number;
  /** The depth of the rows this gap sits among — aligns the insertion line under their text. */
  depth: number;
  /** Which edge of the host row the strip straddles: `top` (above the row) or `bottom` (below it). */
  edge: 'top' | 'bottom';
}) {
  const { activeDragIsChild } = useTaskDrag();
  const { setNodeRef, isOver } = useDroppable({
    id: reorderGapId(parentId, index),
    disabled: !activeDragIsChild,
  });
  const { rowLeft } = useIndentation(depth);
  const active = activeDragIsChild && isOver;

  return (
    <div
      ref={setNodeRef}
      aria-hidden
      data-reorder-gap=""
      data-drop-over={active ? 'true' : undefined}
      // Straddle the row edge (~16px hit band centred on the boundary), leaving the middle of the
      // row body uncovered for the re-parent gesture. Absolute → zero flow height, never reflows.
      className={cn(
        'pointer-events-none absolute inset-x-0 z-10 h-4',
        edge === 'top' ? '-top-2' : '-bottom-2',
      )}
    >
      <div
        className={cn(
          'absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent-teal',
          // A soft teal glow so the line reads clearly even where the translucent drag ghost
          // overlaps it (the drop slot must be legible under the dragged row).
          'shadow-[0_0_8px_1px_var(--color-accent-teal)]',
          'transition-opacity motion-reduce:transition-none',
          active ? 'opacity-100' : 'opacity-0',
        )}
        style={{ marginLeft: rowLeft, marginRight: '0.75rem' }}
      />
    </div>
  );
}
