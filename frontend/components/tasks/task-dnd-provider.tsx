'use client';

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import * as React from 'react';

import { resolveFolderDrop } from '@/lib/dnd/drag-to-folder';
import { useTaskActions, useTasks } from '@/lib/stores/tasks-store';

/**
 * Drag-and-drop context for the Tasks module: top-level task rows are drag sources and the
 * sidebar folders (+ Inbox) are drop targets. A drop routes through the optimistic
 * `moveTask` store action (see the data-flow + dnd-kit skills), so the move shows instantly
 * and reconciles/rolls back on its own.
 *
 * Wraps the whole module (sidebar + content) so both the draggables and the droppables share
 * one context. Mouse and keyboard are both supported; a `DragOverlay` shows the dragged
 * task's title floating under the cursor.
 */
export function TaskDndProvider({ children }: { children: React.ReactNode }) {
  const tasks = useTasks();
  const { moveTask } = useTaskActions();
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const sensors = useSensors(
    // 8px threshold so a plain click on a row's buttons isn't read as the start of a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const activeTask = activeId === null ? undefined : tasks.find((item) => item.id === activeId);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    const dragged = tasks.find((item) => item.id === active.id);
    if (dragged === undefined) return;
    const move = resolveFolderDrop(
      String(active.id),
      over === null ? null : String(over.id),
      dragged.folder_id,
    );
    if (move === null) return;
    void (async () => {
      try {
        await moveTask(move.itemId, move.folderId);
      } catch {
        // The optimistic store already rolled the subtree back.
      }
    })();
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setActiveId(null);
      }}
    >
      {children}
      <DragOverlay>
        {activeTask ? (
          <div className="cursor-grabbing rounded-md border border-accent-teal bg-surface px-3 py-2 text-sm text-foreground shadow-[0_8px_32px_0_rgba(0,0,0,0.4)]">
            {activeTask.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
