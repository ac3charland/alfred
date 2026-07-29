'use client';

import { useDroppable } from '@dnd-kit/core';

import { useTaskDrag } from '@/components/tasks/task-dnd-provider';
import { folderGapId } from '@/lib/dnd/reorder-folder';
import { cn } from '@/lib/utils';

/**
 * A thin, layout-neutral drop strip at a folder boundary (ALF-153). One sits above every folder
 * row (at its top edge), plus one below the last row — one more gap than rows. Dropping a
 * dragged folder into a gap moves it to that slot (a fractional `sort_order` at the midpoint of
 * its neighbours); the folder row itself keeps its meaning as a drop target for tasks.
 *
 * Rendered as an **absolutely-positioned child of the folder row**, so it adds no flow height
 * and never reflows the sidebar when the insertion line reveals — the same shape the subtask
 * gaps use. It only participates in a drag while a *folder* is being dragged (`disabled`
 * otherwise, so dragging a task onto a folder still reads the row's drop zone underneath) and
 * lights up teal only while hovered.
 */
export function FolderGap({
  index,
  edge,
}: {
  /** The slot this gap represents: 0 = above the first folder, `folders.length` = below the last. */
  index: number;
  /** Which edge of the host row the strip straddles: `top` (above the row) or `bottom` (below it). */
  edge: 'top' | 'bottom';
}) {
  const { activeDragFolderId } = useTaskDrag();
  const { setNodeRef, isOver } = useDroppable({
    id: folderGapId(index),
    disabled: activeDragFolderId === null,
  });
  const active = activeDragFolderId !== null && isOver;

  return (
    <div
      ref={setNodeRef}
      aria-hidden
      data-folder-gap=""
      data-drop-over={active ? 'true' : undefined}
      // Straddle the row edge (~12px hit band centred on the boundary). Absolute → zero flow
      // height, so revealing the line never moves the folder list under the cursor.
      className={cn(
        'pointer-events-none absolute inset-x-0 z-10 h-3',
        edge === 'top' ? '-top-1.5' : '-bottom-1.5',
      )}
    >
      <div
        className={cn(
          'absolute inset-x-1 top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent-teal',
          // A soft teal glow so the line reads clearly under the translucent drag ghost.
          'shadow-[0_0_8px_1px_var(--color-accent-teal)]',
          'transition-opacity motion-reduce:transition-none',
          active ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
}
