'use client';

import { useDroppable } from '@dnd-kit/core';
import * as React from 'react';

import { useTaskDrag } from '@/components/tasks/task-dnd-provider';
import { cn } from '@/lib/utils';

import { dropZoneActiveClass, dropZoneBaseClass } from './folder-drop-zone.styles';

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
 *
 * The zone stays registered during a FOLDER drag (a disabled droppable drops out of collision
 * detection and lets a stale target win the drop — see the dnd-kit skill), but it doesn't
 * highlight: that drag reorders the list through the gap strips, and "file it here" is not on
 * offer.
 */
export function FolderDropZone({ id, children }: FolderDropZoneProperties) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const { activeDragFolderId } = useTaskDrag();
  const active = isOver && activeDragFolderId === null;
  return (
    <div
      ref={setNodeRef}
      data-drop-over={active ? 'true' : undefined}
      className={cn(dropZoneBaseClass, active && dropZoneActiveClass)}
    >
      {children}
    </div>
  );
}
