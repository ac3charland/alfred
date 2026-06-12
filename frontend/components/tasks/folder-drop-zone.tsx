'use client';

import { useDroppable } from '@dnd-kit/core';
import * as React from 'react';

import { cn } from '@/lib/utils';

interface FolderDropZoneProperties {
  /** The droppable id: a folder id, or INBOX_DROP_ID for the Inbox target. */
  id: string;
  children: React.ReactNode;
}

/**
 * Wraps a sidebar nav target (Inbox or a folder) as a dnd-kit drop zone, highlighting
 * while a dragged task hovers it. The drop itself is handled by the TaskDndProvider's
 * onDragEnd (→ the optimistic moveTask action). Outside a DndContext (unit tests,
 * stories) useDroppable is inert, so this just renders its children.
 */
export function FolderDropZone({ id, children }: FolderDropZoneProperties) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      data-drop-over={isOver ? 'true' : undefined}
      className={cn(
        // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic highlight, no behavioral effect
        'rounded-sm transition-colors duration-100 motion-reduce:transition-none',
        isOver && 'bg-accent-teal/15 ring-1 ring-accent-teal/50',
      )}
    >
      {children}
    </div>
  );
}
