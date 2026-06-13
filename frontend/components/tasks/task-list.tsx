'use client';

import { useDroppable } from '@dnd-kit/core';

import { useTaskDrag } from '@/components/tasks/task-dnd-provider';
import { TaskRow } from '@/components/tasks/task-row';
import { LIST_BOTTOM_DROP_ID, LIST_TOP_DROP_ID } from '@/lib/dnd/promote-to-root';
import type { TaskScope } from '@/lib/stores/tasks-store';
import { useScopedTasks } from '@/lib/stores/tasks-store';
import { cn } from '@/lib/utils';

interface TaskListProperties {
  /** Which view to render (inbox / a folder / completed) — filters the shared store. */
  scope: TaskScope;
  emptyMessage?: string;
}

/**
 * A drop zone at the top/bottom edge of the list that pulls a dragged CHILD out to the top
 * level. Its border + label only appear while a child is being dragged, lighting up teal
 * while hovered; a top-level drag never reveals it (nothing to pull out), so it can't get in
 * the way of a normal re-parent. The drop itself is handled in TaskDndProvider's onDragEnd.
 *
 * Crucially, revealing the zones must NOT shift the rows you might drop onto. The BOTTOM
 * zone can grow on demand because it expands into the empty space below the list; the TOP
 * zone, which would otherwise push the whole list down, instead reserves its height at all
 * times (staying invisible until a child drag), so the list never jumps.
 */
function PromoteRootZone({ position }: { position: 'top' | 'bottom' }) {
  const id = position === 'top' ? LIST_TOP_DROP_ID : LIST_BOTTOM_DROP_ID;
  const { activeDragIsChild } = useTaskDrag();
  const { setNodeRef, isOver } = useDroppable({ id });
  const active = activeDragIsChild && isOver;
  // Top is always reserved; bottom only takes up space while a child is being dragged.
  const reserveSpace = position === 'top' || activeDragIsChild;

  return (
    <div
      ref={setNodeRef}
      aria-hidden
      data-promote-zone={position}
      data-promote-over={active ? 'true' : undefined}
      className={cn(
        'flex items-center justify-center overflow-hidden text-xs',
        'transition-colors duration-100 motion-reduce:transition-none',
        reserveSpace ? cn('h-8', position === 'top' ? 'mb-1.5' : 'mt-1.5') : 'h-0',
        // Border + label show only during a child drag; otherwise the (reserved) zone is blank.
        activeDragIsChild
          ? cn(
              'rounded-md border border-dashed',
              active
                ? 'border-accent-teal bg-accent-teal/15 text-accent-teal'
                : 'border-border/50 text-muted-foreground/60',
            )
          : 'border-0 text-transparent',
      )}
    >
      Pull out to top level
    </div>
  );
}

/**
 * Renders one view's task forest, derived from the shared TasksProvider store by `scope`.
 * Each TaskRow handles its own recursive subtree rendering and reads folders from the
 * FoldersProvider. The list is bracketed by promote-to-root drop zones (see PromoteRootZone).
 */
export function TaskList({ scope, emptyMessage = 'No tasks yet' }: TaskListProperties) {
  const nodes = useScopedTasks(scope);
  const isCompletedView = scope.type === 'completed';

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="font-serif text-2xl text-muted-foreground/50">{emptyMessage}</p>
        <p className="mt-2 text-sm text-muted-foreground/40">Capture something above.</p>
      </div>
    );
  }

  return (
    <div>
      <PromoteRootZone position="top" />
      <ul
        aria-label="Tasks"
        className={cn(
          'rounded-2xl border border-border bg-surface',
          'divide-y divide-border/50',
          'overflow-hidden',
        )}
      >
        {nodes.map((node) => (
          <TaskRow key={node.id} node={node} isCompletedView={isCompletedView} />
        ))}
      </ul>
      <PromoteRootZone position="bottom" />
    </div>
  );
}
